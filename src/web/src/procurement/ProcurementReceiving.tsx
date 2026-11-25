import { useEffect, useRef, useState } from 'react'
import { SessionExpired } from '../workHistoryApi'
import { listSources, loadSource, ProcurementError, receive } from './procurementApi'
import type { Source, SourceKey, SourceType } from './procurementApi'
import { actorScope, createPending, recoverPending, storePending } from './procurementRetry'
import type { PendingReceipt, ProcurementActor } from './procurementRetry'

const types: Record<SourceType, string> = { ESCO_SHIPMENT: 'ESCO 입고', PURCHASE_ORDER: '발주입고' }
const statuses: Record<Source['status'], string> = {
  OPEN: '입고 대기', PARTIALLY_RECEIVED: '부분 입고', RECEIVED: '입고 완료',
}
const messages: Record<string, string> = {
  STALE_REVISION: '다른 요청이 먼저 반영되었습니다. 갱신한 잔량을 확인하세요.',
  LINE_ALREADY_RECEIVED: '이미 입고가 끝난 행입니다.',
  QUANTITY_EXCEEDS_REMAINING: '입력한 수량이 원문서 행의 잔량을 초과합니다.',
  SOURCE_NOT_FOUND: '현재 단말에서 조회할 수 없는 원문서입니다.',
  REQUEST_ID_REUSED: '이미 다른 입고에 사용된 요청입니다.',
  REQUEST_ACTOR_MISMATCH: '최초 입고를 실행한 작업자만 같은 요청을 재시도할 수 있습니다.',
}
const quantity = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 })
const validAmount = (value: string) => /^\d+(?:\.\d{1,3})?$/.test(value) && Number(value) > 0 && Number.isFinite(Number(value))

export default function ProcurementReceiving({ actor, onSessionExpired }: {
  actor: ProcurementActor; onSessionExpired: () => void
}) {
  const scope = actorScope(actor)
  return <ReceivingScreen key={scope} scope={scope} onSessionExpired={onSessionExpired} />
}

function ReceivingScreen({ scope, onSessionExpired }: { scope: string; onSessionExpired: () => void }) {
  const [type, setType] = useState<SourceType>('ESCO_SHIPMENT')
  const [number, setNumber] = useState('')
  const [date, setDate] = useState('')
  const [sources, setSources] = useState<Source[]>()
  const [selected, setSelected] = useState<SourceKey>()
  const [detail, setDetail] = useState<Source>()
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [retry, setRetry] = useState(() => recoverPending(scope))
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef<AbortController | null>(null)

  useEffect(() => () => active.current?.abort(), [])

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setNotice('')
    setBusy(true)
    try {
      await task(controller.signal)
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else if (error instanceof ProcurementError) setNotice(messages[error.code] ?? '입고 요청을 처리하지 못했습니다.')
      else setNotice('서버 응답을 확인하지 못했습니다.')
    } finally {
      active.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function search() {
    void run(async (signal) => {
      setSelected(undefined)
      setDetail(undefined)
      setAmounts({})
      setSources(undefined)
      setSources(await listSources(type, number.trim(), date, signal))
    })
  }

  async function refresh(key: SourceKey, signal: AbortSignal) {
    const fresh = await loadSource(key, signal)
    setDetail(fresh)
    setSources((rows) => rows?.map((row) => row.source.number === key.number && row.source.type === key.type ? fresh : row))
  }

  function select(key: SourceKey) {
    void run(async (signal) => {
      setSelected(key)
      setDetail(undefined)
      setAmounts({})
      await refresh(key, signal)
    })
  }

  function updatePending(pending?: PendingReceipt) {
    storePending(scope, pending)
    setRetry(pending)
  }

  function send(pending: PendingReceipt) {
    void run(async (signal) => {
      try {
        updatePending(pending)
      } catch {
        setNotice('입고 요청을 보존할 수 없습니다. 브라우저 저장소 설정을 확인하세요.')
        return
      }
      let receipt
      try {
        receipt = await receive(pending.source, pending.body, signal)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof ProcurementError && error.status < 500 && error.status !== 408 && error.status !== 429) {
          updatePending()
          if (error.status === 409) {
            setDetail(undefined)
            setAmounts({})
            setSelected(pending.source)
            await refresh(pending.source, signal)
          }
        }
        throw error
      }
      if (signal.aborted) return
      updatePending()
      setAmounts({})
      setDetail(undefined)
      setSelected(pending.source)
      setNotice('입고를 저장했습니다. ' + receipt.receiptId)
      await refresh(pending.source, signal)
    })
  }

  const locked = busy || !!retry
  const selectedLines = detail?.lines.flatMap(({ lineNo }) => amounts[lineNo] ? [{ lineNo, quantity: amounts[lineNo] }] : []) ?? []
  const validLines = selectedLines.length > 0 && selectedLines.every((line) => {
    const row = detail?.lines.find(({ lineNo }) => lineNo === line.lineNo)
    return validAmount(line.quantity) && !!row && Number(line.quantity) <= row.remaining
  })

  return (
    <section aria-label="합성 입고">
      <h2>합성 입고</h2>
      <form onSubmit={(event) => { event.preventDefault(); search() }}>
        <label>원문서 유형
          <select value={type} disabled={locked} onChange={(event) => {
            setType(event.target.value as SourceType)
            setSources(undefined)
            setSelected(undefined)
            setDetail(undefined)
            setAmounts({})
            setNotice('')
          }}>
            {Object.entries(types).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>원문서 번호
          <input maxLength={40} value={number} disabled={locked} onChange={(event) => setNumber(event.target.value)} />
        </label>
        <label>원문서 일자
          <input type="date" value={date} disabled={locked} onChange={(event) => setDate(event.target.value)} />
        </label>
        <button type="submit" disabled={locked}>원문서 조회</button>
      </form>

      {sources && (sources.length ? (
        <ul aria-label="입고 원문서">{sources.map((row) => (
          <li key={row.source.type + '/' + row.source.number}>
            <button type="button" disabled={locked} onClick={() => select(row.source)}>{row.source.number}</button>
            {' · '}{row.sourceDate} · {statuses[row.status]}
          </li>
        ))}</ul>
      ) : <p>조건에 맞는 원문서가 없습니다.</p>)}

      {selected && <button type="button" disabled={locked} onClick={() => select(selected)}>잔량 새로 조회</button>}
      {detail && (
        <section aria-labelledby="procurement-detail">
          <h3 id="procurement-detail">{types[detail.source.type]} {detail.source.number}</h3>
          <p>{statuses[detail.status]} · 버전 {detail.revision}</p>
          <form onSubmit={(event) => {
            event.preventDefault()
            if (validLines && !locked) send(createPending(detail.source, {
              requestId: crypto.randomUUID(), expectedRevision: detail.revision, lines: selectedLines,
            }))
          }}>
            <div className="table-scroll">
              <table aria-label="원문서 행">
                <thead><tr>
                  <th scope="col">항번</th><th scope="col">품목</th><th scope="col">입고 창고</th>
                  <th scope="col">원수량</th><th scope="col">입고 누계</th><th scope="col">잔량</th><th scope="col">입고 수량</th>
                </tr></thead>
                <tbody>{detail.lines.map((row) => (
                  <tr key={row.lineNo}>
                    <th scope="row">{row.lineNo}</th><td>{row.item}</td><td>{row.warehouse}</td>
                    <td>{quantity.format(row.expected)}</td><td>{quantity.format(row.received)}</td><td>{quantity.format(row.remaining)}</td>
                    <td><input aria-label={row.lineNo + '번 입고 수량'} inputMode="decimal" value={amounts[row.lineNo] ?? ''}
                      disabled={locked || row.remaining === 0}
                      onChange={(event) => setAmounts((values) => ({ ...values, [row.lineNo]: event.target.value }))} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <button type="submit" disabled={locked || !validLines}>선택 행 입고</button>
          </form>
          <h4>입고 이력</h4>
          {detail.receipts.length ? <ul>{detail.receipts.map((receipt) => (
            <li key={receipt.receiptId}>
              {receipt.receiptId} · {receipt.workerId} · {receipt.terminalId}
              <ul>{receipt.lines.map((line) => (
                <li key={line.lineNo}>{line.lineNo}번 · {line.item} · {line.warehouse} · {quantity.format(line.quantity)}</li>
              ))}</ul>
            </li>
          ))}</ul> : <p>입고 이력이 없습니다.</p>}
        </section>
      )}
      {retry && (
        <div>
          <p>보존된 입고 요청 {types[retry.source.type]} {retry.source.number}</p>
          <button type="button" disabled={busy} onClick={() => send(retry)}>동일 입고 요청 재시도</button>
        </div>
      )}
      <p role="status">{busy ? '처리 중입니다.' : notice}</p>
    </section>
  )
}
