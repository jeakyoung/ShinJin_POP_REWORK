import { useEffect, useRef, useState } from 'react'
import { loadShippingForm, queryShipping, sendShippingBatch, ShippingError } from './shippingApi'
import type { ShippingBatch, ShippingFormRow, ShippingFormState } from './shippingApi'
import { ShippingGrid } from './ShippingGrid'
import { ShippingCustomer, ShippingOptions } from './ShippingOptions'
import { optionsFor, readFilters, selectedFor, writeFilter } from './shippingFilterSettings'
import type { FilterType, Option } from './shippingFilterSettings'
import './shippingForm.css'

function localDay(back = 0) {
  const d = new Date()
  d.setDate(d.getDate() - back)
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}
const id = (row: ShippingFormRow) => row.snapshot.handoff.id
const amount = (rows: ShippingFormRow[]) => rows.reduce((sum, row) => sum + row.snapshot.handoff.quantity, 0)
const errors: Record<string,string> = {
  INSUFFICIENT_STOCK:'재고 수량이 부족합니다. 확인하십시오.', PACKING_AFTER_SHIPMENT:'포장일보다 출하일자가 빠릅니다. 확인하십시오.',
  HANDOFF_NOT_FOUND:'포장 데이터를 확인하십시오.', STALE_VERSION:'다른 작업이 반영되었습니다. 다시 조회하십시오.',
  TERMINAL_MISMATCH:'지정된 출하 단말에서 실행해 주세요.', SELECT_WHOLE_DOCUMENT:'같은 출하번호의 행을 모두 선택하십시오.',
  SHIPMENT_ALREADY_RECORDED:'이미 출하 처리되었습니다.', SHIPMENT_NOT_ACTIVE:'확정된 출하를 선택하세요.',
  PRINTER_UNSET:'거래명세서 프린터가 설정되지 않았습니다.', PRINT_ERROR:'거래명세서 출력에 실패했습니다.',
}
function restored(key: string): ShippingBatch | null {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') } catch { return null }
}
function packingPlans(rows: ShippingFormRow[]) {
  const groups = new Map<string, ShippingFormRow[]>()
  for (const row of rows) {
    const key = JSON.stringify([row.info.packingDate,row.info.packingNumber,row.info.order])
    const group = groups.get(key)
    if (group) group.push(row); else groups.set(key,[row])
  }
  return [...groups.values()].map(lots => {
    const first = lots[0]
    if (lots.length === 1) return first
    return { ...first, lots, snapshot: { ...first.snapshot, handoff: {
      ...first.snapshot.handoff, quantity:amount(lots),
    } } }
  })
}
function toggleGroup(selected: string[], ids: string[], clicked: string) {
  return selected.includes(clicked) ? selected.filter(key => !ids.includes(key)) : [...new Set([...selected, ...ids])]
}
type Props = {actor: {terminal: string; worker: string}; disabled: boolean; onSessionExpired: () => void; onPreview: (numbers: string[]) => void}
export default function ShippingForm({ actor, onSessionExpired, disabled, onPreview }: Props) {
  const retryKey = 'pop-shipping-batch:' + JSON.stringify([actor.terminal, actor.worker])
  const [pending, setPending] = useState<ShippingBatch | null>(() => restored(retryKey))
  const [data, setData] = useState<ShippingFormState>()
  const [upper, setUpper] = useState<ShippingFormRow[]>([])
  const [lower, setLower] = useState<ShippingFormRow[]>([])
  const [upperCheck, setUpperCheck] = useState<string[]>([])
  const [lowerCheck, setLowerCheck] = useState<string[]>([])
  const [trouble, setTrouble] = useState<string[]>([])
  const [completed, setCompleted] = useState(false)
  const [searched, setSearched] = useState(false)
  const [lowerSearched, setLowerSearched] = useState(false)
  const [from, setFrom] = useState(() => localDay(3))
  const [to, setTo] = useState(() => localDay())
  const [doneDate, setDoneDate] = useState(() => localDay())
  const [workDate, setWorkDate] = useState(() => localDay(new Date().getHours() < 8 ? 1 : 0))
  const [customer, setCustomer] = useState<Option>()
  const [opman, setOpman] = useState('')
  const [carry, setCarry] = useState(false)
  const [autoPrint, setAutoPrint] = useState(true)
  const [scan, setScan] = useState('')
  const [popup, setPopup] = useState<FilterType | 'customer'>()
  const [filters, setFilters] = useState(() => readFilters(actor.terminal))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef<AbortController | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    loadShippingForm(abort.signal).then(next => { if (!abort.signal.aborted) setData(next) }).catch(e => {
      if (!abort.signal.aborted) { if (e instanceof ShippingError && e.status === 401) onSessionExpired(); else setMessage('출하 데이터를 조회할 수 없습니다.') }
    })
    return () => { abort.abort(); running.current?.abort() }
  }, [onSessionExpired])
  const choices = (type: FilterType | 'customer') => optionsFor(type, data?.options ?? [])
  function search(bottom: boolean, signal: AbortSignal) {
    if (bottom) return queryShipping('completed', {optime:doneDate, customerCode:customer?.code ?? ''}, signal)
    const allowed = (type: FilterType) => selectedFor(type,filters,choices(type))
    return queryShipping('packing', {dateFrom:from,dateTo:to,customerCode:customer?.code ?? '',
      matquality:allowed('material'),itemKind3:allowed('kind'),workcenterCode:allowed('center'),
      opmanName:opman.trim(),carryOverFlag:carry ? '1' : '0'}, signal)
  }
  function showUpper(next: ShippingFormState) {
    setUpper(packingPlans(next.rows)); setUpperCheck([]); setLower([]); setLowerCheck([]); setTrouble([])
    setCompleted(false); setSearched(true); setLowerSearched(true)
  }
  function showLower(next: ShippingFormState) {
    setLower(next.rows)
    setCompleted(true); setLowerSearched(true); setLowerCheck([]); setTrouble([])
  }
  async function request(task: (signal: AbortSignal) => Promise<void>) {
    if (running.current) return
    const abort = new AbortController()
    running.current = abort; setBusy(true); setMessage('')
    try { await task(abort.signal) } catch (e) {
      if (!abort.signal.aborted) {
        if (e instanceof ShippingError && e.status === 401) onSessionExpired()
        else setMessage(e instanceof ShippingError ? errors[e.message] ?? '출하 요청을 처리할 수 없습니다.' : '서버 응답을 확인할 수 없습니다.')
      }
    } finally { if (!abort.signal.aborted) setBusy(false); running.current = null }
  }
  function query(bottom = false) {
    void request(async signal => {
      const next = await search(bottom,signal)
      if (!signal.aborted) { setData(next); if (bottom) showLower(next); else showUpper(next) }
    })
  }
  function apply(order?: string) {
    const base = completed ? [] : lower
    if (completed) { setLower([]); setLowerCheck([]); setCompleted(false) }
    if (!upper.length) { setMessage('포장 데이터가 없습니다. 확인하십시오.'); return }
    const matches = upper.filter(row => order === undefined ? upperCheck.includes(id(row)) : row.info.order === order)
    if (!matches.length && order === undefined) { setMessage('출하 대상을 선택하세요.'); return }
    setLower([...base, ...matches.flatMap(row => row.lots ?? [row]).filter(row => !base.some(previous => id(previous) === id(row)))])
    setLowerSearched(true)
  }
  function submit(command: ShippingBatch) {
    void request(async signal => {
      sessionStorage.setItem(retryKey, JSON.stringify(command)); setPending(command)
      try {
        const result = await sendShippingBatch(command, signal)
        if (signal.aborted) return
        sessionStorage.removeItem(retryKey); setPending(null)
        const next = await search(command.action === 'CANCEL',signal)
        if (signal.aborted) return
        setData(next)
        if (command.action === 'CANCEL') showLower(next); else showUpper(next)
        const problem = Object.values(result.documents).find(print => !['SUBMITTED','NO_PAPER'].includes(print.status))
        setMessage((command.action === 'CONFIRM' ? '저장 되었습니다.' : '출하 취소 되었습니다.') + (problem ? ' ' + (errors[problem.status] ?? '출력 결과를 확인하십시오.') : ''))
      } catch (e) {
        if (e instanceof ShippingError && e.status < 500 && e.status !== 401) {
          sessionStorage.removeItem(retryKey); setPending(null)
        }
        throw e
      }
    })
  }
  function save() {
    if (!lower.length) { setMessage('저장할 출하 데이터가 없습니다.'); return }
    if (completed || lower.some(row => row.snapshot.shipment)) return
    const late = lower.filter(row => row.info.packingDate > workDate)
    const short = lower.filter(row => row.snapshot.handoff.quantity > row.info.stock)
    if (late.length || short.length) { setTrouble(late.length ? [] : short.map(id)); setMessage(errors[late.length ? 'PACKING_AFTER_SHIPMENT' : 'INSUFFICIENT_STOCK']); return }
    if (window.confirm('저장 하시겠습니까?')) submit({ requestId: crypto.randomUUID(), action:'CONFIRM', shippingDate:workDate, printChecked:autoPrint, rows:lower.map(row => ({id:id(row),version:row.snapshot.version})) })
  }
  function remove() {
    const selected = lower.filter(row => lowerCheck.includes(id(row)))
    if (!selected.length) { setMessage('삭제 대상을 선택하십시오.'); return }
    if (!completed) { setLower(lower.filter(row => !lowerCheck.includes(id(row)))); setLowerCheck([]); return }
    if (window.confirm('선택 항목을 삭제 하시겠습니까?')) submit({ requestId:crypto.randomUUID(), action:'CANCEL', rows:selected.map(row => ({id:id(row), version:row.snapshot.version})) })
  }
  function print() {
    const numbers = [...new Set(lower.filter(row => lowerCheck.includes(id(row))).map(row => row.snapshot.shipment?.number).filter((n): n is string => !!n))]
    if (!numbers.length) { setMessage('출력할 출하 내역을 선택하십시오.'); return }
    onPreview(numbers)
  }
  const lock = disabled || busy || !!pending || !data || data.worker !== actor.worker || data.terminal !== actor.terminal
  const selectedRows = upper.filter(row => upperCheck.includes(id(row)))
  return <div className="ship-form">
    <fieldset className="ship-toolbar ship-top" disabled={lock}>
      <span className="ship-tag ship-customer-tag">거래처</span>
      <button className="ship-customer-value" aria-label="거래처 선택" onClick={() => setPopup('customer')}>{customer?.name}</button>
      <button className="ship-clear-customer" onClick={() => setCustomer(undefined)} aria-label="거래처 초기화">{customer ? '×' : ''}</button>
      <label className="ship-tag ship-pack-tag" htmlFor="ship-from">포장일자</label>
      <input id="ship-from" className="ship-from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
      <span className="ship-tilde">~</span><input className="ship-to" aria-label="포장 종료일" type="date" value={to} onChange={e => setTo(e.target.value)} />
      {(['material','kind','center'] as const).map((t,i) => <button key={t} className={'ship-filter ship-filter-' + t} onClick={() => setPopup(t)}>{['재질선택','품목유형','작업반'][i]}</button>)}
      <label className="ship-check ship-carry">이월<input type="checkbox" checked={carry} onChange={e => setCarry(e.target.checked)} /></label>
      <input className="ship-worker" placeholder="수주담당자" aria-label="수주담당자" value={opman} onChange={e => setOpman(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') query() }} />
      <button className="ship-find" aria-label="포장 조회" onClick={() => query()}>조회</button>
    </fieldset>
    <ShippingGrid rows={upper} checked={upperCheck} trouble={[]} all={() => setUpperCheck(upperCheck.length === upper.length ? [] : upper.map(id))}
      toggle={row => setUpperCheck(toggleGroup(upperCheck, upper.filter(r => r.info.order === row.info.order).map(id),id(row)))} />
    <fieldset className="ship-toolbar ship-mid" disabled={lock}>
      <label htmlFor="ship-done" className="ship-tag ship-done-tag">출하 완료일</label><input type="date" id="ship-done" value={doneDate} onChange={e => setDoneDate(e.target.value)} />
      <label htmlFor="ship-day" className="ship-tag ship-day-tag">출하일자</label><input type="date" id="ship-day" value={workDate} onChange={e => setWorkDate(e.target.value)} />
      <input className="ship-scan" aria-label="수주번호 스캔" placeholder="수주번호 스캔" value={scan} onChange={e => setScan(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { apply(scan.length === 16 ? scan.slice(0,12) : scan); setScan('') } }} />
      <button className="ship-apply" onClick={() => apply()}>적용 <img src="/shipping/down.svg" alt="" /></button>
      <span className="ship-count ship-up-count">↑ 선택 :　{selectedRows.length} 건{searched && '(' + amount(selectedRows) + ')'}</span>
      <span className="ship-count ship-down-count">↓ 선택 :　{lower.length} 건{lowerSearched && '(' + amount(lower) + ')'}</span>
      <label className="ship-check ship-auto">자동인쇄<input type="checkbox" checked={autoPrint} onChange={e => setAutoPrint(e.target.checked)} /></label>
      <button className="ship-find" aria-label="출하 완료 조회" onClick={() => query(true)}>조회</button>
      <button className="ship-save" onClick={save}>저장</button><button className="ship-print" onClick={print}>인쇄</button><button className="ship-delete" onClick={remove}>삭제</button>
    </fieldset>
    <ShippingGrid lower rows={lower} checked={lowerCheck} trouble={trouble} all={() => setLowerCheck(lowerCheck.length === lower.length ? [] : lower.map(id))}
      toggle={row => { const related = lower.filter(r => completed ? r.snapshot.shipment?.number === row.snapshot.shipment?.number : r.info.packingNumber === row.info.packingNumber).map(id)
        setLowerCheck(completed ? lowerCheck.includes(id(row)) ? [] : related : toggleGroup(lowerCheck, related,id(row))) }} />
    {popup === 'customer' && <ShippingCustomer options={choices(popup)} onClose={() => setPopup(undefined)} onSave={v => { setCustomer(v); setPopup(undefined) }} />}
    {popup && popup !== 'customer' && <ShippingOptions type={popup} options={choices(popup)} selected={selectedFor(popup, filters, choices(popup))}
      onClose={() => setPopup(undefined)} onSave={selected => { const entry = {selected,known:choices(popup).map(r=>r.code)}
        writeFilter(actor.terminal,popup,entry); setFilters({...filters,[popup]:entry}); setPopup(undefined) }} />}
    {message && <div role="alertdialog" aria-label="출하 알림" className="ship-shade"><div className="ship-alert">{message}<button onClick={() => setMessage('')}>확인</button></div></div>}
    {pending && <button className="ship-retry" disabled={busy} onClick={() => submit(pending)}>동일 요청 재시도</button>}
  </div>
}
