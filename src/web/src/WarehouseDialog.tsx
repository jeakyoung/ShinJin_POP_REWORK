import { useEffect, useRef, useState } from 'react'
import { useSettingsPrompt } from './settingsPrompt'
import './warehouseSettings.css'

const roles = ['issue', 'returns', 'good', 'bad', 'auxiliary'] as const
type Role = typeof roles[number]
type Rules = Record<Role, string[]>
const labels = { issue: '투입', returns: '반납', good: '양품', bad: '불량', auxiliary: '보조' }
const asset = (name: string) => import.meta.env.BASE_URL + 'terminal-settings/' + name + '.png'
type View = { entry: string; step: 'selection' | 'priority' | 'done'; version: number; plant: string; canEdit: boolean
  rows: { code: string; name: string; idx?: number; plantName?: string }[]; saved: { roles: Rules } }
type Props = { url: string; onClose: (prioritySaved?: boolean) => void; onExpired: () => void; onSelectionSaved?: () => void }

export default function WarehouseDialog({ url, onClose, onExpired, onSelectionSaved }: Props) {
  const prompt = useSettingsPrompt()
  const dialog = useRef<HTMLDialogElement>(null)
  const password = useRef<HTMLInputElement>(null)
  const entry = useRef('')
  const pending = useRef<AbortController | null>(null)
  const [view, setView] = useState<View>()
  const [rules, setRules] = useState<Rules>()
  const [focus, setFocus] = useState<Partial<Record<Role, string>>>({})
  const [busy, setBusy] = useState(false)
  const step = view?.step ?? 'password'
  const title = step === 'password' ? '사용제한' : step === 'selection' ? '창고 설정' : '창고 우선순위 설정'

  useEffect(() => {
    const modal = dialog.current
    modal?.showModal()
    password.current?.focus()
    return () => {
      pending.current?.abort()
      modal?.close()
      if (entry.current) void fetch(url + '/warehouse/close', { method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: entry.current }) }).catch(() => {})
    }
  }, [url])

  async function close() {
    if (pending.current) return
    if (!entry.current) { onClose(); return }
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      const result = await fetch(url + '/warehouse/close', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: entry.current }) })
      if (controller.signal.aborted) return
      if (result.status === 401) { onExpired(); return }
      if (!result.ok) throw new Error()
      entry.current = ''
      onClose()
    } catch {
      if (!controller.signal.aborted) await prompt('닫기 요청을 확인할 수 없습니다. 다시 시도하십시오.')
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  async function send() {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      if (step === 'selection' && !await prompt('창고 정보를 저장 하시겠습니까?', true)) return
      if (controller.signal.aborted) return
      const auth = step === 'password'
      const body = auth ? { password: password.current?.value ?? '' } : { entry: view?.entry, expectedVersion: view?.version, roles: rules }
      if (password.current) password.current.value = ''
      const result = await fetch(url + '/warehouse/' + (auth ? 'entry' : step), {
        method: auth ? 'POST' : 'PUT', signal: controller.signal, cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      if (controller.signal.aborted) return
      if (result.status === 401) { onExpired(); return }
      if (!result.ok) {
        const message = auth && result.status === 403 ? '비밀번호를 다시 입력하십시오.'
          : result.status === 503 ? '설정 암호를 확인할 수 없습니다.'
          : result.status === 409 ? '설정이 변경되었습니다. 창고 설정을 다시 여십시오.'
          : '창고 설정을 처리하지 못했습니다.'
        await prompt(message)
        if (!controller.signal.aborted && !auth && [403,409].includes(result.status)) onClose()
        return
      }
      const next: View = await result.json()
      if (controller.signal.aborted) return
      if (next.step === 'done') { entry.current = ''; onClose(true); return }
      entry.current = next.entry
      setView(next)
      setRules(next.saved.roles)
      if (next.step === 'priority') onSelectionSaved?.()
      if (next.step === 'priority') setFocus(Object.fromEntries(roles.map(role => [role, next.saved.roles[role][0]])))
    } catch {
      if (!controller.signal.aborted) await prompt('응답을 확인할 수 없습니다. 창고 설정을 다시 여십시오.')
    } finally {
      pending.current = null
      if (!controller.signal.aborted) { setBusy(false); requestAnimationFrame(() => password.current?.focus()) }
    }
  }

  function toggle(role: Role, code?: string) {
    if (!view || !rules || !view.canEdit) return
    const list = rules[role]
    const next = code === undefined ? (list.length === view.rows.length ? [] : view.rows.map(row => row.code))
      : list.includes(code) ? list.filter(value => value !== code) : [...list, code]
    setRules({ ...rules, [role]: next })
  }
  function move(role: Role, delta: number) {
    if (!rules || !view?.canEdit) return
    const list = [...rules[role]]
    const at = list.indexOf(focus[role] ?? '')
    const to = at + delta
    if (at < 0 || to < 0 || to >= list.length) return
    list.splice(to, 0, list.splice(at, 1)[0])
    setRules({ ...rules, [role]: list })
  }
  return <dialog ref={dialog} aria-labelledby="warehouse-caption" className={'wh-settings wh-' + step}
    onCancel={e => { e.preventDefault(); if (!busy) void close() }}>
    <header><img alt="" src={asset(step === 'password' ? 'settings-lock' : 'warehouse-title')} />
      <h2 id="warehouse-caption">{title}</h2><button type="button" aria-label="닫기" disabled={busy} onClick={() => void close()}>
        <img alt="" src={asset('printer-close')} /></button></header>
    {step === 'password' ? <div className="wh-auth-body"><label htmlFor="wh-pass">비밀번호 입력</label>
      <input ref={password} id="wh-pass" type="password" autoComplete="off" spellCheck={false} readOnly={busy}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.value) { e.preventDefault(); void send() } }} /></div>
      : view && rules && (step === 'selection' ? <div className="wh-grid"><table aria-label="창고 목록"><colgroup>
        {[50,80,70,135,70,70,70,70,70].map((width,i) => <col key={i} style={{width}} />)}</colgroup>
        <thead><tr><th>순번</th><th>사업장</th><th>창고<br/>코드</th><th>창고명</th>{roles.map(role =>
          <th key={role}><button type="button" aria-label={labels[role] + ' 전체 선택/해제'} disabled={busy || !view.canEdit} onClick={() => toggle(role)}>
            {role === 'auxiliary' ? '투입' : labels[role]}<br/>{role === 'auxiliary' ? '보조' : '창고'}</button></th>)}</tr></thead>
        <tbody>{view.rows.map((row,i) => <tr key={row.code}><td>{row.idx ?? i+1}</td><td>{row.plantName ?? view.plant}</td><td>{row.code}</td><td>{row.name}</td>
          {roles.map(role => <td key={role}><label><input type="checkbox" aria-label={row.code + ' ' + labels[role]} disabled={busy || !view.canEdit}
            checked={rules[role].includes(row.code)} onChange={() => toggle(role,row.code)} /></label></td>)}</tr>)}</tbody></table></div>
      : <div className="wh-priorities">{roles.map(role => <section key={role} aria-label={labels[role] + ' 우선순위'}>
        <div className="wh-order-tools"><h3>{labels[role]}</h3>{[-1,1].map(delta => <button type="button" key={delta} disabled={busy || !view.canEdit}
          aria-label={labels[role] + (delta < 0 ? ' 위로' : ' 아래로')} onClick={() => move(role,delta)}>
          <img src={asset(delta < 0 ? 'group-up' : 'group-down')} alt="" /></button>)}</div>
        <div className="wh-order-grid"><table><colgroup><col style={{width:50}}/><col style={{width:136}}/></colgroup>
          <thead><tr><th>순번</th><th>창고명</th></tr></thead><tbody>{rules[role].map((code,i) =>
            <tr key={code} aria-current={focus[role] === code} onClick={() => setFocus({ ...focus, [role]: code })}><td>{i+1}</td>
              <td><button type="button">{view.rows.find(r => r.code === code)?.name}</button></td></tr>)}</tbody></table></div>
      </section>)}</div>)}
    <footer><button type="button" disabled={busy || (view && !view.canEdit)} onClick={() => void send()}>{step === 'password' ? '확인' : '저장'}</button>
      <button type="button" disabled={busy} onClick={() => void close()}>{step === 'password' ? '닫기' : '취소'}</button></footer>
  </dialog>
}
