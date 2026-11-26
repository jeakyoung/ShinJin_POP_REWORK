import './pop-form-frame.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BoxPhoto, Field } from './RfidControls'
import RfidPhotos from './RfidPhotos'
import './rfid-forms.css'

type Tag = { id: string; code: string; enabled: boolean; worker: string; registeredAt: string }
type Master = { type: string; status: string; made: string; statusDate: string; note: string; registeredBy: string; registeredAt: string }
export type Pallet = { number: string; tag: string; tagCode: string; master: Master | null }
type Entry = { eventId: string; date: string; time: string; customer: string; direction: string; pallet: string; tagCode: string; box: string }
export type Forms = { factory: string; operator: string; today: string; from: string; nextCode: string;
  tags: Tag[]; pallets: Pallet[]; customers: { code: string; name: string; plan: string }[]; history: Entry[] }
type Page = 'rfid' | 'rfidMatch' | 'rfidHistory'
type Mutation = { url: string; body: Record<string, unknown> }
const errors: Record<string, string> = { ALREADY_REGISTERED: '이미 등록된 RFID 태그입니다.',
  TAG_CODE_CONFLICT: '태그 관리번호가 변경되었습니다. 다시 스캔해 주세요.', TAG_NOT_FOUND: '태그를 찾지 못했습니다.',
  ALREADY_MATCHED: '이미 매칭된 RFID 태그 번호입니다.', STALE_MATCH: '현재 매칭 정보를 확인해 주세요.',
  PALLET_NOT_FOUND: '등록된 파렛트를 찾지 못했습니다.', INVALID_INPUT: '입력 내용을 확인해 주세요.' }

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (s: string) => void }) {
  return <Field label={label}><select value={value} onChange={e => onChange(e.target.value)}>
    {options.map(o => <option key={o}>{o}</option>)}</select></Field>
}
export function Grid({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <div className="rf-grid"><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{children}</tbody></table></div>
}
function saved(key: string): Mutation | null {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') } catch { return null }
}

export default function RfidForms({ entry, actor, onSessionExpired, onManual }: {
  entry: Page; actor: string; onSessionExpired: () => void; onManual: () => void
}) {
  const [forms, setForms] = useState<Forms>()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [plant, setPlant] = useState('')
  const [notice, setNotice] = useState('')
  const [observed, setObserved] = useState<Forms>()
  const [auto, setAuto] = useState(false)
  const [modal, setModal] = useState<'tag' | 'match' | 'reverse' | 'number' | 'photo'>()
  const [scan, setScan] = useState('')
  const [photo, setPhoto] = useState('')
  const [tags, setTags] = useState<(Tag & { checked: boolean })[]>([])
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState('')
  const [id, setId] = useState('')
  const [filters, setFilters] = useState({ kind: '전체', status: '전체', match: '전체' })
  const [listFilters, setListFilters] = useState(filters)
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const lock = useRef(false)
  const requestKey = 'rfid-form:' + actor + entry
  const [pending, setPending] = useState(() => saved(requestKey))
  const dialog = useRef<HTMLDialogElement>(null)
  const pull = useCallback(async (signal: AbortSignal) => {
    const r = await fetch('/api/pop/rfid/forms', { signal, cache: 'no-store' })
    if (r.status === 401) { onSessionExpired(); throw Error() }
    if (!r.ok) throw Error()
    return await r.json() as Forms
  }, [onSessionExpired])
  useEffect(() => {
    const c = new AbortController()
    controller.current = c
    pull(c.signal).then(data => {
      if (c.signal.aborted) return
      setForms(data); setFrom(data.from); setTo(data.today); setPlant(entry === 'rfid' ? '전체' : data.factory)
    }).catch(() => { if (!c.signal.aborted) setNotice('RFID 정보를 조회하지 못했습니다.') })
    return () => c.abort()
  }, [pull, entry])
  useEffect(() => { if (modal) dialog.current?.showModal() }, [modal])
  const query = useCallback(async () => {
    const signal = controller.current?.signal
    if (!signal || lock.current) return
    if (entry !== 'rfidMatch' && (!from || !to || from > to)) { setNotice('시작일은 종료일보다 이전이거나 같아야 합니다.'); return }
    lock.current = true
    try {
      const data = await pull(signal)
      if (signal.aborted) return
      setForms(data)
      const inRange = (stamp: string) => stamp >= from + 'T00:00:01' && stamp <= to + 'T23:59:59'
      setObserved({ ...data, history: data.history.filter(row => inRange(row.date + 'T' + row.time)) })
      if (entry === 'rfid') {
        const rows = data.tags.filter(row => inRange(row.registeredAt)).map(row => ({ ...row, checked: false }))
        setEditing(rows.length > 0); setTags(rows)
      }
      if (entry === 'rfidMatch') { setSelected(''); setId(''); setListFilters(filters) }
      setNotice('')
    } catch { if (!signal.aborted) setNotice('조회에 실패했습니다.') }
    finally { lock.current = false }
  }, [from, to, entry, filters, pull])
  useEffect(() => {
    if (!auto || entry !== 'rfidHistory') return
    const timer = window.setInterval(() => { void query() }, 4000)
    return () => window.clearInterval(timer)
  }, [auto, entry, query])
  function open(kind: typeof modal) {
    if (kind === 'tag' && editing) { setTags([]); setEditing(false) }
    setNotice(''); setScan(''); setModal(kind)
  }
  function close() { dialog.current?.close(); setModal(undefined) }
  const current = forms?.pallets.find(row => row.number === selected)
  function select(row: Pallet) { setSelected(row.number); setId(row.tag); setNotice('') }
  function scanValue() {
    if (!forms) return
    const value = scan.trim()
    if (!value) return
    if (modal === 'tag') {
      if (tags.some(row => row.id === value) || forms.tags.some(row => row.id === value)) {
        setNotice('이미 등록된 RFID 태그입니다.'); setScan(''); return
      }
      const code = String(Number(forms.nextCode) + tags.length)
      if (!forms.nextCode || code.slice(0, 4) !== forms.nextCode.slice(0, 4)) { setNotice(errors.TAG_CODE_CONFLICT); return }
      setTags([...tags, { id: value, code, checked: true, enabled: true, worker: forms.operator,
        registeredAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T') }])
      setScan(''); setNotice(''); return
    }
    if (modal === 'match') { setId(value); close(); return }
    const row = forms.pallets.find(p => modal === 'number' ? p.number === value : p.tag === value)
    if (!row) { setNotice('등록된 파렛트를 찾지 못했습니다.'); return }
    select(row); setObserved(forms); close()
  }
  async function write(op: Mutation) {
    const signal = controller.current?.signal
    if (!signal || lock.current) return
    lock.current = true; setBusy(true)
    try {
      sessionStorage.setItem(requestKey, JSON.stringify(op)); setPending(op)
      const r = await fetch('/api/pop/rfid/' + op.url, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op.body) })
      if (r.status === 401) { onSessionExpired(); return }
      if (r.status >= 500 || r.status === 408 || r.status === 429) throw Error()
      const result = await r.json() as { code: string }
      if (signal.aborted) return
      sessionStorage.removeItem(requestKey); setPending(null)
      if (!r.ok) { setNotice(errors[result.code] ?? '현재 정보를 확인해 주세요.'); return }
      const data = await pull(signal)
      if (signal.aborted) return
      setForms(data); setObserved(data)
      if (entry === 'rfid') {
        if (op.body.action === 'register') { setTags([]); setEditing(false); setNotice('RFID TAG가 등록 되었습니다.') }
        else { setNotice('수정되었습니다.') }
      } else {
        setSelected(String(op.body.pallet)); setId(data.pallets.find(row => row.number === op.body.pallet)?.tag ?? '')
        setNotice(op.body.action === 'unmatch' ? '매칭이 삭제되었습니다.' : 'RFID & 파렛트 매칭이 저장되었습니다.')
      }
    } catch { if (!signal.aborted) setNotice('처리 결과를 확인하지 못했습니다. 다시 조회해 주세요.') }
    finally { lock.current = false; if (!signal.aborted) setBusy(false) }
  }
  function save() {
    if (entry === 'rfidMatch') {
      if (!current || !id) { setNotice('파렛트와 RFID 태그 번호를 입력해주세요.'); return }
      void write({ url: 'commands', body: { eventId: crypto.randomUUID(), action: 'matchScan', pallet: current.number, tag: id } })
    } else {
      const rows = tags.filter(row => editing ? forms?.tags.find(t => t.id === row.id)?.enabled !== row.enabled : row.checked)
      if (!rows.length) { setNotice(editing ? '변경된 데이터가 없습니다.' : '저장할 데이터가 없습니다.'); return }
      void write({ url: 'tags', body: { requestId: crypto.randomUUID(), action: editing ? 'edit' : 'register',
        rows: rows.map(({ id, code, enabled }) => ({ id, code, enabled })) } })
    }
  }
  const pallets = observed?.pallets.filter(p => (listFilters.kind === '전체' || p.master?.type === listFilters.kind)
    && (listFilters.status === '전체' || p.master?.status === listFilters.status)
    && (listFilters.match === '전체' || (listFilters.match === '매칭완료') === !!p.tag)) ?? []
  const photographed = observed?.history.find(row => row.eventId === photo)
  const status = <p role="status">{notice}</p>
  return <section className={"rf-form rf-mode-" + entry} aria-label={{ rfid: 'TAG 등록', rfidMatch: '파렛트 매칭', rfidHistory: '입출고 현황' }[entry]}>
    <div className="rf-head"><div className="rf-criteria">
      <SelectField label="사업장" value={plant} options={['전체', ...(forms ? [forms.factory] : [])]} onChange={setPlant}/>
      {entry === 'rfid' && <Field label="등록자"><input value={forms?.operator ?? ''} readOnly /></Field>}
      {entry === 'rfidHistory' && <Field label="자동 새로고침"><button type="button" role="switch" aria-checked={auto}
        onClick={() => setAuto(!auto)}>{auto ? 'ON' : 'OFF'}</button></Field>}
      {entry === 'rfidMatch' ? <>
        {(['kind','status','match'] as const).map((key,i) => <SelectField key={key} label={['파렛트 유형','상태구분','RFID 매칭여부'][i]}
          options={['전체', ...(key === 'match' ? ['매칭완료','매칭필요'] : [...new Set(forms?.pallets.map(p => p.master?.[key === 'kind' ? 'type' : 'status']).filter((v): v is string => !!v))])]}
          value={filters[key]} onChange={v => setFilters({ ...filters, [key]: v })}/>)}</> :
        <><Field label="시작일"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="종료일"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field></>}
    </div>{entry === 'rfid' && <button className="rf-scan" aria-label="RFID 태그 스캔" disabled={!forms || !!pending} onClick={() => open('tag')}><img src={import.meta.env.BASE_URL + 'rfid/tag-scan.png'} alt=""/></button>}
    <button className="rf-query" disabled={!forms || busy || !!pending} onClick={() => void query()}>조회</button>
    <button className="rf-save" disabled={!forms || busy || !!pending} onClick={entry === 'rfidHistory' ? onManual : save}>
      {entry === 'rfidHistory' ? '수동 등록' : editing ? '수정' : '저장'}</button></div>
    {entry === 'rfid' && <Grid headers={['선택','RFID태그 관리번호','RFID 태그 ID','등록자','사용유무','등록일시']}>
      {tags.map((row,i) => <tr key={row.id}><td><input type="checkbox" aria-label={row.id + ' 선택'} disabled={editing || busy}
        checked={row.checked} onChange={e => setTags(tags.map((t,j) => j === i ? { ...t, checked: e.target.checked } : t))}/></td>
        <td>{row.code}</td><td>{row.id}</td><td>{forms?.operator || row.worker}</td><td><input type="checkbox" aria-label={row.id + ' 사용유무'} checked={row.enabled}
          disabled={busy} onChange={e => setTags(tags.map((t,j) => j === i ? { ...t, enabled: e.target.checked } : t))}/></td><td>{row.registeredAt.replace('T',' ')}</td></tr>)}</Grid>}
    {entry === 'rfidMatch' && <div className="rf-match"><Grid headers={['파렛트 번호','매칭여부','상태구분','파렛트 유형']}>
      {pallets.map(p => <tr key={p.number} aria-selected={selected === p.number} onClick={() => select(p)}><td><button onClick={() => select(p)}>{p.number}</button></td>
        <td>{p.tag ? '매칭완료' : '매칭필요'}</td><td>{p.master?.status}</td><td>{p.master?.type}</td></tr>)}</Grid>
      <div className="rf-detail"><Field label="파렛트 번호"><button onClick={() => open('number')}>{selected || '파렛트 번호 입력'}</button></Field>
      <Field label="파렛트 유형"><output>{current?.master?.type}</output></Field>
      <div className="rf-pair"><Field label="RFID 태그번호"><output aria-label="RFID 태그번호">{id ? forms?.tags.find(t => t.id === id)?.code ?? forms?.nextCode : ''}</output></Field>
        <button className="rf-delete" disabled={!current?.tag || busy || !!pending} onClick={() => void write({ url: 'commands', body: {
          eventId: crypto.randomUUID(), action: 'unmatch', pallet: selected, tag: current?.tag } })}>삭제</button></div>
      <Field label="RFID 태그ID"><button aria-label="RFID 태그ID" onClick={() => open('match')}>{id || 'RFID TAG ID 입력'}</button></Field>
      <div className="rf-pair"><Field label="제작일"><output>{current?.master?.made}</output></Field>
        <button onClick={() => open('reverse')}>RFID로 파렛트 찾기</button></div>
      <div className="rf-pair"><Field label="상태구분"><output>{current?.master?.status}</output></Field>
        <Field label={current?.master?.status ? current.master.status + '일' : '상태일'}><output>{current?.master?.statusDate}</output></Field></div>
      <Field label="비고"><output>{current?.master?.note}</output></Field>
      <Field label="등록자"><output>{current?.master?.registeredBy}</output></Field>
      <Field label="등록일시"><output>{current?.master?.registeredAt}</output></Field></div></div>}
    {entry === 'rfidHistory' && <Grid headers={['NO','입출일','입출시간','입출처','입출구분','파렛트번호','RFID태그번호']}>
      {observed?.history.map((row,i) => <tr key={row.eventId} onDoubleClick={() => { setPhoto(row.eventId); open('photo') }}>
        <td><button aria-label={row.pallet + ' 사진'} onClick={() => { setPhoto(row.eventId); open('photo') }}>{i + 1}</button></td>
        <td>{row.date}</td><td>{row.time}</td><td>{row.customer}</td><td className={row.direction === 'IN' ? 'rf-in' : 'rf-out'}>{row.direction === 'IN' ? '입고' : '출고'}</td>
        <td>{row.pallet}</td><td>{row.tagCode}</td></tr>)}</Grid>}
    {pending && <button disabled={busy} onClick={() => void write(pending)}>동일 명령 재시도</button>}
    {entry === 'rfidHistory' && new URLSearchParams(location.search).get('demoDiagnostics') === 'rfidPhotos' &&
      <RfidPhotos actor={actor} movementCount={forms?.history.length ?? 0} onSessionExpired={onSessionExpired} />}
    {!modal && status}
    {modal && <dialog ref={dialog} className={"rf-dialog rf-dialog-" + modal} aria-label={modal === 'photo' ? '사진 보기' : modal === 'number' ? '파렛트 번호 입력' : 'RFID 스캔'}
      onClose={() => setModal(undefined)}>
      {modal === 'photo' ? photographed?.box ? <BoxPhoto id={photographed.box} direction={photographed.direction}/> : <RfidPhotos actor={actor} movementCount={forms?.history.length ?? 0} eventId={photo} onSessionExpired={onSessionExpired} /> : <>
      <label>{modal === 'number' ? '파렛트 번호' : 'RFID 태그 ID'}<input autoFocus value={scan} maxLength={modal === 'number' ? 8 : undefined}
        inputMode={modal === 'number' ? 'numeric' : 'text'} onChange={e => setScan(modal === 'number' ? e.target.value.replace(/\D/g,'') : e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); scanValue() } }}/></label>
      {modal === 'number' && <div className="rf-keys">{'1234567890'.split('').map(n => <button key={n} onClick={() => setScan(v => (v+n).slice(0,8))}>{n}</button>)}
        <button className="rf-back" onClick={() => setScan(scan.slice(0,-1))}>←</button><button className="rf-clear" onClick={() => setScan('')}>C</button></div>}
      <button onClick={scanValue} hidden={modal !== 'number' && !scan.trim()} className={modal === 'number' ? 'rf-apply' : 'rf-enter'}>{modal === 'number' ? '적용' : '스캔 확인'}</button>{status}</>}
      <button onClick={close}>{modal === 'number' ? '취소' : '닫기'}</button></dialog>}
  </section>
}