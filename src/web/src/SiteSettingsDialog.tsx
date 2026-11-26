import { useSettingsPrompt } from './settingsPrompt'
import { useEffect, useRef, useState } from 'react'
import type { View } from './equipmentSettingsApi'
import './siteSettings.css'

type Props = { page: 'plant' | 'pop-id'; url: string; terminal: string; onClose: (changed?:boolean) => void; onExpired: () => void }
type Draft = { data: View; settingsVersion: number; plant: string; center: string; pop: string }
const asset = (name: string) => import.meta.env.BASE_URL + 'terminal-settings/' + name + '.png'

export default function SiteSettingsDialog({ page, url, terminal, onClose, onExpired }: Props) {
  const prompt = useSettingsPrompt()
  const dialog = useRef<HTMLDialogElement>(null)
  const write = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState<Draft>()
  const [focus, setFocus] = useState<'plant' | 'center'>()
  const [listed, setListed] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const isPlant = page === 'plant'
  const title = isPlant ? '공장 설정' : 'POP ID 설정'

  useEffect(() => {
    const box = dialog.current
    box?.showModal()
    return () => { box?.close(); write.current?.abort() }
  }, [])
  useEffect(() => {
    const ctrl = new AbortController()
    async function load() {
      const [base, equipment] = await Promise.all([url, url + '/equipment'].map(path => fetch(path, { signal: ctrl.signal, cache: 'no-store' })))
      if (ctrl.signal.aborted) return
      if (base.status === 401 || equipment.status === 401) { onExpired(); return }
      if (!base.ok || !equipment.ok) throw Error()
      const data: View = await equipment.json()
      const settings = await base.json()
      if (ctrl.signal.aborted) return
      if (!isPlant && !settings.view.saved.values.process) {
        setDraft(undefined); setNotice('공정 설정을 진행하십시오.'); return
      }
      setDraft({ data, settingsVersion: settings.view.saved.version, plant: data.site.plant, center: data.site.center,
        pop: data.popRows.find(row => row.owner === terminal)?.code ?? '' })
      setListed(''); setFocus(undefined)
    }
    load().catch(() => { if (!ctrl.signal.aborted) setNotice('설정을 불러오지 못했습니다.') })
    return () => ctrl.abort()
  }, [url, terminal, attempt, isPlant, onExpired])

  async function save() {
    if (!draft || !draft.data.canEdit || write.current) return
    if (isPlant && !draft.plant) return prompt('상단 공장이 선택되지 않았습니다.')
    if (isPlant && !draft.center) return prompt('상단 작업장이 선택되지 않았습니다.')
    if (!isPlant && !draft.pop) return prompt('적용할 설비를 선택하여주십시오.')
    const row = draft.data.popRows.find(r => r.code === draft.pop)
    if (!isPlant && row?.owner && row.owner !== terminal && !await prompt('해당 설비는 타설비에서 POP IP를 설정했습니다.\n확인하십시오.')) return
    if (!await prompt(isPlant ? '공장 설정을 저장 하시겠습니까?' : '해당 설비에 POP ID를 저장 하시겠습니까?', true)) return
    const ctrl = new AbortController()
    write.current = ctrl
    setSaving(true)
    try {
      const response = await fetch(url + (isPlant ? '/plant' : '/equipment/pop-id'), {
        method: 'PUT', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isPlant ? { expectedVersion: draft.settingsVersion, equipmentVersion: draft.data.version,
          plant: draft.plant, center: draft.center } : { expectedVersion: draft.data.version, number: draft.pop, ...(draft.data.siteRevision==null?{}:{siteRevision:draft.data.siteRevision,scopePlant:draft.data.site.plant,scopeCenter:draft.data.site.center}) }),
      })
      if (ctrl.signal.aborted) return
      if (response.status === 401) { onExpired(); return }
      if (response.status === 409 || response.status === 422) {
        setDraft(undefined); setNotice('설정이 변경되었거나 선택값을 적용할 수 없습니다. 최신 목록을 확인하십시오.')
        setAttempt(n => n + 1); return
      }
      if (!response.ok) throw Error()
      onClose(true)
    } catch { if (!ctrl.signal.aborted) setNotice('저장 결과를 확인하지 못했습니다. 닫고 다시 조회하십시오.') }
    finally { write.current = null; if (!ctrl.signal.aborted) setSaving(false) }
  }
  const locked = saving || !draft?.data.canEdit
  const sites = draft?.data.sites ?? []
  const plants = sites.filter((site, index) => sites.findIndex(row => row.plant === site.plant) === index)
  const selected = sites.find(s => s.plant === draft?.plant && s.center === draft.center)
  function choosePlant(code: string) {
    if (locked || !draft) return
    if (focus !== 'plant') return prompt('상단 공장을 터치해 주세요.')
    setDraft({ ...draft, plant: code, center: '' }); setListed(code)
  }
  function chooseCenter(code: string) {
    if (locked || !draft) return
    if (focus !== 'center') return prompt('상단 작업장을 터치해 주세요.')
    setDraft({ ...draft, center: code })
  }
  function close() { if (!write.current) onClose() }
  return <dialog ref={dialog} aria-label={title} className={'eq-dialog ' + (isPlant ? 'site-dialog' : 'popid-dialog')}
    onCancel={e => { e.preventDefault(); close() }}>
    <header><img src={asset(isPlant ? 'plant-title' : 'pop-title')} alt="" /><h2>{title}</h2>
      <button type="button" aria-label="닫기" disabled={saving} onClick={close}><img src={asset('printer-close')} alt="" /></button></header>
    {draft && (isPlant ? <>
      <div className="site-fields">{(['plant', 'center'] as const).map(field => <button type="button" key={field}
        disabled={locked} aria-pressed={focus === field} onClick={() => setFocus(field)}><strong>{field === 'plant' ? '공장' : '작업장'}</strong>
        <span>{field === 'plant' ? plants.find(p => p.plant === draft.plant)?.plantName || 'NONE' : selected?.centerName || 'NONE'}</span></button>)}</div>
      <div className="site-tables"><div className="eq-grid"><table><thead><tr><th>순번</th><th>사업장 목록</th></tr></thead><tbody>
        {plants.map((p,i) => <tr key={p.plant} aria-current={focus === 'plant' && draft.plant === p.plant} onClick={() => choosePlant(p.plant)}>
          <td>{i + 1}</td><td><button type="button" disabled={locked}>{p.plantName}</button></td></tr>)}</tbody></table></div>
        <div className="eq-grid"><table><thead><tr><th>작업장 목록</th></tr></thead><tbody>{sites.filter(p => p.plant === listed).map(site =>
          <tr key={site.center} aria-current={focus === 'center' && draft.center === site.center} onClick={() => chooseCenter(site.center)}>
            <td><button type="button" disabled={locked}>{site.centerName}</button></td></tr>)}</tbody></table></div></div>
    </> : <><div className="eq-info"><strong>POP ID</strong>{terminal}</div>
      <p className="popid-instruction">POP ID : 해당 PC의 메인보드 고유 번호입니다.</p>
      <div className="eq-grid"><table><thead><tr><th>사용</th><th>순번</th><th>설비명</th><th>POP ID</th></tr></thead>
        <tbody>{draft.data.popRows.map((r,i) => <tr key={r.code} aria-current={r.code === draft.pop}
          onClick={() => { if (!locked) setDraft({ ...draft, pop: r.code }) }}><td>
          <input type="checkbox" aria-label={r.name} checked={r.code === draft.pop} disabled={locked}
            onChange={() => setDraft({ ...draft, pop: r.code })} /></td><td>{i + 1}</td><td>{r.name}</td><td>{r.owner}</td></tr>)}</tbody></table></div></>)}
    {notice && <p role="status">{notice}</p>}
    <footer><button type="button" disabled={locked} onClick={() => void save()}>저장</button>
      <button type="button" disabled={saving} onClick={close}>{isPlant ? '취소' : '닫기'}</button></footer>
  </dialog>
}
