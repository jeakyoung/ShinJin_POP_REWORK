import { useEffect, useRef, useState } from 'react'

const roles = ['document', 'shipment', 'label'] as const
const roleLabels = { document: '일반 문서', shipment: '출하 문서', label: '라벨' }
type Role = typeof roles[number]
type Values = { process: string; warehouse: string; outputs: Record<Role, string> }
type Configuration = { version: number; values: Values }
type View = {
  terminalId: string
  canEdit: boolean
  catalog: { processes: string[]; warehouses: string[]; outputs: { id: string; role: Role }[] }
  saved: Configuration
  applied: Configuration
}
type Reply = { code: string; view: View | null }
type Props = { terminalId: string; onSessionExpired: () => void }

export default function TerminalSettingsDemo(props: Props) {
  return <TerminalSettingsPanel key={props.terminalId} {...props} />
}

function TerminalSettingsPanel({ terminalId, onSessionExpired }: Props) {
  const [view, setView] = useState<View>()
  const [draft, setDraft] = useState<Values>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(true)
  const active = useRef<AbortController | null>(null)
  const url = '/api/pop/admin/terminal-settings/' + encodeURIComponent(terminalId)

  useEffect(() => {
    const request = new AbortController()
    fetch(url, { signal: request.signal, cache: 'no-store' }).then(async (response) => {
      if (response.status === 401) { if (!request.signal.aborted) onSessionExpired(); return }
      const reply: Reply = await response.json()
      if (request.signal.aborted) return
      if (!response.ok || !reply.view) throw new Error('settings unavailable')
      setView(reply.view)
      setDraft(reply.view.saved.values)
    }).catch(() => {
      if (!request.signal.aborted) setNotice('단말 설정을 불러오지 못했습니다.')
    }).finally(() => { if (!request.signal.aborted) setBusy(false) })
    return () => { request.abort(); active.current?.abort() }
  }, [url, onSessionExpired])

  async function send(method: 'PUT' | 'POST') {
    if (active.current || !view || !draft || (method === 'PUT' && !view.canEdit)) return
    const request = new AbortController()
    active.current = request
    setBusy(true)
    setNotice('')
    try {
      const response = await fetch(method === 'POST' ? url + '/refresh' : url, {
        method, signal: request.signal,
        ...(method === 'PUT' ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedVersion: view.saved.version, values: draft }),
        } : {}),
      })
      if (response.status === 401) { if (!request.signal.aborted) onSessionExpired(); return }
      const reply: Reply = await response.json()
      if (request.signal.aborted) return
      if (reply.view) {
        setView(reply.view)
        setDraft(reply.view.saved.values)
      }
      setNotice(reply.code === 'SAVED' ? '저장했습니다. 현재 세션에 적용하려면 새로고침을 선택하세요.'
        : reply.code === 'APPLIED' ? '이 세션에 설정을 적용했습니다.'
        : reply.code === 'STALE_VERSION' ? '다른 세션에서 변경했습니다. 최신 저장값을 표시합니다.'
        : '설정을 변경하지 못했습니다.')
    } catch {
      if (!request.signal.aborted) setNotice('응답을 확인하지 못했습니다.')
    } finally {
      active.current = null
      if (!request.signal.aborted) setBusy(false)
    }
  }

  return (
    <section aria-label="단말 설정">
      <h2>단말 설정</h2>
      {notice && <p role="status">{notice}</p>}
      {view && draft && <>
        <p>단말 {view.terminalId} · 저장 버전 {view.saved.version} · 적용 버전 {view.applied.version}</p>
        <p>적용 설정 {view.applied.values.process} / {view.applied.values.warehouse}</p>
        <ul aria-label="적용 출력 역할">{roles.map((role) =>
          <li key={role}>{roleLabels[role]} {view.applied.values.outputs[role]}</li>)}</ul>
        <fieldset disabled={busy || !view.canEdit}>
          <legend>저장 설정</legend>
          <label>공정<select value={draft.process} onChange={(e) => setDraft({ ...draft, process: e.target.value })}>
            {view.catalog.processes.map((value) => <option key={value}>{value}</option>)}
          </select></label>
          <label>창고<select value={draft.warehouse} onChange={(e) => setDraft({ ...draft, warehouse: e.target.value })}>
            {view.catalog.warehouses.map((value) => <option key={value}>{value}</option>)}
          </select></label>
          {roles.map((role) => <label key={role}>{roleLabels[role]}
            <select value={draft.outputs[role]} onChange={(e) => setDraft({
              ...draft, outputs: { ...draft.outputs, [role]: e.target.value },
            })}>{view.catalog.outputs.filter((entry) => entry.role === role).map(({ id }) =>
              <option key={id}>{id}</option>)}</select>
          </label>)}
          <button type="button" onClick={() => void send('PUT')}>설정 저장</button>
          <button type="button" onClick={() => setDraft(view.saved.values)}>편집 취소</button>
        </fieldset>
        <button type="button" disabled={busy} onClick={() => void send('POST')}>세션 설정 새로고침</button>
      </>}
      {busy && <p>단말 설정 처리 중</p>}
    </section>
  )
}
