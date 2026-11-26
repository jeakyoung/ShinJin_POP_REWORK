import { Fragment, useEffect, useRef, useState } from 'react'
import { SessionExpired } from '../workHistoryApi'
import { applyEsco, applyPurchaseDay, loadEsco, loadPurchaseDay, ProcurementError, receive } from './procurementApi'
import type { EscoRow, PurchaseRow, SourceType } from './procurementApi'
import { actorScope, recoverPending, storePending } from './procurementRetry'
import type { ProcurementActor } from './procurementRetry'
import HistoryDate from '../history/HistoryDate'
import '../history/workHistory.css'
import './ReceivingForms.css'

const errors: Record<string, string> = {
  PO_AUTO_FAILED: 'SP_POP_DZ_PO_AUTO : ERROR',
  ESCO_CREATE_FAILED: 'UP_CZ_SINJINSM_CRT_PU_IN_AUTO_ESCO : ERROR',
  ESCO_ADJUST_FAILED: 'CZ_SINJINSM_UP_PU_MM_OHSLINVM_UPDATE_YM : ERROR',
  DOCUMENT_MISMATCH: '조회한 출하번호와 입력한 출하번호가 일치하지 않습니다.',
  REQUEST_ID_REUSED: '다른 요청에 사용된 입고 요청입니다.',
}
const purchaseWidths = [75, 110, 200, 220, 100, 190, 220, 118]
const escoWidths = [75, 110, 186, 210, 172, 262, 220]
function ColumnWidths({ widths }: { widths: number[] }) {
  const total = widths.reduce((sum, width) => sum + width, 0)
  return <colgroup>{widths.map((width, index) => <col key={index} style={{ width: (100 * width / total) + '%' }} />)}</colgroup>
}
const columns = ['No','입고일자','입고번호','입고품목','입고수량','입고일시','입고창고','반영여부']
function formatDate(value: string | null) {
  if (!value) return ''
  return value.replace(/^(\d{4})(\d\d)(\d\d)(?:(\d\d)(\d\d)(\d\d))?$/, (_,y,m,d,h,min,s) =>
    y + '-' + m + '-' + d + (h ? ' ' + h + ':' + min + ':' + s : ''))
}
export default function ProcurementReceiving({ sourceType, actor, onSessionExpired }: {
  sourceType: SourceType; actor: ProcurementActor; onSessionExpired: () => void
}) {
  const scope = actorScope(actor)
  return <ReceivingForm key={scope + sourceType} purchase={sourceType === 'PURCHASE_ORDER'} scope={scope} onSessionExpired={onSessionExpired} />
}
function ReceivingForm({ purchase, scope, onSessionExpired }: { purchase: boolean; scope: string; onSessionExpired: () => void }) {
  const key = 'receiving-form-' + (purchase ? 'purchase:' : 'esco:') + scope
  const [date, setDate] = useState('')
  const [number, setNumber] = useState('')
  const [displayed, setDisplayed] = useState('')
  const [po, setPo] = useState<PurchaseRow[]>([])
  const [esco, setEsco] = useState<EscoRow[]>([])
  const [selection, setSelection] = useState<number>()
  const [busy, setBusy] = useState(purchase ? '조회 중' : '')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(() => {
    try { return sessionStorage.getItem(key) } catch { return null }
  })
  const [legacy, setLegacy] = useState(() => recoverPending(scope))
  const old = legacy?.source.type === (purchase ? 'PURCHASE_ORDER' : 'ESCO_SHIPMENT') ? legacy : undefined
  const input = useRef<HTMLInputElement>(null)
  const active = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    if (purchase) loadPurchaseDay('', controller.signal).then(result => {
      if (!controller.signal.aborted) { setDate(result.date); setPo(result.rows) }
    }).catch(error => {
      if (!controller.signal.aborted) {
        if (error instanceof SessionExpired) onSessionExpired()
        else setNotice('발주입고 내역을 조회하지 못했습니다.')
      }
    }).finally(() => { if (!controller.signal.aborted) setBusy('') })
    return () => { controller.abort(); active.current?.abort() }
  }, [purchase, onSessionExpired])
  async function run(label: string, fn: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller; setBusy(label); setNotice('')
    try { await fn(controller.signal) } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else if (error instanceof ProcurementError) setNotice(errors[error.code] ?? '입고를 처리하지 못했습니다.')
      else setNotice('서버 응답을 확인하지 못했습니다.')
    } finally { active.current = null; if (!controller.signal.aborted) setBusy('') }
  }
  function refreshDate(value: string) {
    setDate(value); setSelection(undefined); setPo([])
    if (value) void run('조회 중', async signal => {
      const result = await loadPurchaseDay(value, signal)
      if (!signal.aborted) setPo(result.rows)
    })
  }
  function scan() {
    if (!number) return
    void run('조회 중', async signal => {
      const result = await loadEsco(number, signal)
      if (!signal.aborted && result.rows.length) {
        setEsco(result.rows); setDisplayed(result.number); setSelection(undefined)
      }
    })
  }
  function save(body: string) {
    void run('저장 중', async signal => {
      try { sessionStorage.setItem(key, body) } catch { setNotice('입고 요청을 보존할 수 없습니다.'); return }
      setPending(body)
      const clear = () => { if (sessionStorage.getItem(key) === body) sessionStorage.removeItem(key); setPending(sessionStorage.getItem(key)) }
      try {
        if (purchase) {
          const result = await applyPurchaseDay(body, signal)
          if (signal.aborted) return
          clear()
          setDate(result.date); setPo(result.rows); setSelection(undefined)
          const refreshed = await loadPurchaseDay(result.date, signal)
          if (signal.aborted) return
          setPo(refreshed.rows); setNotice('저장 되었습니다.')
        } else {
          const result = await applyEsco(body, signal)
          if (signal.aborted) return
          clear(); setNumber('')
          if (result.rows.length) {
            setEsco(result.rows); setDisplayed(result.number); setSelection(undefined); setNotice('ESCO 입고처리가 완료 되었습니다.')
          }
          input.current?.focus()
        }
      } catch (error) {
        if (!signal.aborted && error instanceof ProcurementError && error.status < 500 && error.status !== 408 && error.status !== 429) {
          clear()
          if (!purchase) setNumber('')
        }
        throw error
      }
    })
  }
  function createCommand() {
    if (purchase && !date) return
    if (!purchase && number.length !== 14) { setNumber(''); return }
    const args = purchase ? { date } : { number, displayedNumber: displayed }
    save(JSON.stringify({ requestId: crypto.randomUUID(), ...args }))
  }
  const disabled = !!busy || !!pending || !!old
  return <section className="receiving-form" data-purchase={purchase} aria-label={purchase ? '발주입고' : 'ESCO 입고'}>
    <form onSubmit={event => { event.preventDefault(); if (!purchase && !disabled) scan() }}>
      {purchase ? <><label htmlFor="po-receiving-date">날짜</label>
        <HistoryDate id="po-receiving-date" className="receiving-date" label="날짜" value={date}
          disabled={disabled} onChange={refreshDate} /></> : <>
        <input ref={input} aria-label="에스코 출하번호" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}shipping/zoom.svg)` }} placeholder="에스코 출하번호 스캔" value={number}
          autoComplete="off" disabled={disabled} onChange={event => setNumber(event.target.value.toUpperCase())} />
        <button type="submit" hidden>조회</button><button type="button" disabled={disabled} onClick={() => {
          setNumber(''); setEsco([]); setDisplayed(''); setSelection(undefined); setNotice(''); input.current?.focus()
        }}>Clear</button></>}
      <button type="button" disabled={disabled || (purchase && !date)} onClick={createCommand}>저장</button>
    </form>
    <div className="receiving-grid">
      {purchase ? <table aria-label="발주입고 내역"><ColumnWidths widths={purchaseWidths} /><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{po.map(row => <tr key={row.index} tabIndex={0} className={selection === row.index ? 'selected' : undefined}
          onClick={() => setSelection(row.index)} onFocus={() => setSelection(row.index)}>
          {[row.index,row.date,row.number,row.item,row.quantity,row.timestamp,row.warehouse,row.reflected].map((v,i) => <td key={columns[i]}>{v}</td>)}
        </tr>)}</tbody></table> :
        <table aria-label="ESCO 입고 내역"><ColumnWidths widths={escoWidths} /><thead><tr><th rowSpan={2}>No</th>
          {['출하일자','출하번호','출하품목','출하수량','출하일시'].map(c => <th key={c}>{c}</th>)}<th rowSpan={2}>입고창고</th></tr>
          <tr>{['입고일자','입고번호','입고품목','입고수량','입고일시'].map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{esco.map(row => <Fragment key={row.index}><tr className={selection === row.index ? 'selected' : undefined}
            tabIndex={0} onFocus={() => setSelection(row.index)} onClick={() => setSelection(row.index)}>
            <td rowSpan={2}>{row.index}</td><td>{formatDate(row.shipDate)}</td><td>{row.shipNumber}</td><td>{row.shipItem}</td>
            <td>{row.shipQty}</td><td>{formatDate(row.shipTime)}</td><td rowSpan={2}>{row.warehouse}</td>
          </tr><tr className={selection === row.index ? 'selected' : undefined} onClick={() => setSelection(row.index)}>
            <td>{formatDate(row.inputDate)}</td><td>{row.inputNumber}</td><td>{row.inputItem}</td><td>{row.inputQty}</td>
            <td>{formatDate(row.inputTime)}</td>
          </tr></Fragment>)}</tbody></table>}
    </div>
    {pending && <button disabled={!!busy} onClick={() => save(pending)}>동일 입고 요청 재시도</button>}
    {old && <button disabled={!!busy} onClick={() => void run('저장 중', async signal => {
      try { await receive(old.source, old.body, signal) } catch (error) {
        if (signal.aborted || !(error instanceof ProcurementError) || error.status >= 500 || error.status === 408 || error.status === 429) throw error
        storePending(scope, undefined); setLegacy(undefined); throw error
      }
      if (!signal.aborted) { storePending(scope, undefined); setLegacy(undefined); setNotice('기존 입고 요청이 처리되었습니다.') }
    })}>기존 입고 요청 재시도</button>}
    <p role="status">{busy || notice}</p>
  </section>
}
