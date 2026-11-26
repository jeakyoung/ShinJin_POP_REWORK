import { TouchInput } from '../TouchFields'
import '../adminTouch.css'
import { useLayoutEffect, useRef, useState } from 'react'
import { SessionExpired } from '../workHistoryApi'
import { loadReturns, ManagementError, returnExpendables } from './managementApi'
import type { Actor, ReturnView } from './managementApi'

const messages: Record<string, string> = {
  RETURN_EXCEEDS_REMAINING: '반납 수량이 남은 반납 가능량을 초과합니다.',
  STALE_REVISION: '재고가 바뀌었습니다. 최신 반납 가능량을 확인하세요.',
  ISSUE_NOT_FOUND: '현재 작업장에서 볼 수 없는 출고입니다.',
  ISSUE_LINE_NOT_FOUND: '출고 항번을 찾을 수 없습니다.',
}
const positive = (value: string) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2_147_483_647

export default function ExpendableReturns({ actor, onSessionExpired }: { actor: Actor; onSessionExpired: () => void }) {
  const scope = 'synthetic-expendables-return:' + JSON.stringify([actor.terminalId, actor.workerId])
  return <ReturnScreen key={scope} scope={scope} onSessionExpired={onSessionExpired} />
}

function stored(scope: string) {
  try { return sessionStorage.getItem(scope) } catch { return null }
}
function ReturnScreen({ scope, onSessionExpired }: { scope: string; onSessionExpired: () => void }) {
  const [view, setView] = useState<ReturnView>()
  const [pending, setPending] = useState(() => stored(scope))
  const [confirmation, setConfirmation] = useState<string>()
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef<AbortController | null>(null)

  function finish(body: string) {
    const current = stored(scope)
    if (current === body) {
      sessionStorage.removeItem(scope)
      setPending(null)
    } else setPending(current)
  }

  async function refresh(signal: AbortSignal) {
    const data = await loadReturns(signal)
    if (!signal.aborted) {
      setView(data)
      setAmounts({})
    }
  }

  useLayoutEffect(() => {
    const request = new AbortController()
    void loadReturns(request.signal).then((data) => {
      if (!request.signal.aborted) setView(data)
    }).catch((error: unknown) => {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setNotice('반납 내역을 조회하지 못했습니다.')
    })
    return () => { request.abort(); active.current?.abort() }
  }, [onSessionExpired])

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    const request = new AbortController()
    active.current = request
    setBusy(true)
    setNotice('')
    try { await task(request.signal) } catch (error) {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else if (error instanceof ManagementError) setNotice(messages[error.message] ?? '반납을 처리하지 못했습니다.')
      else setNotice('서버 응답을 확인하지 못했습니다.')
    } finally {
      active.current = null
      if (!request.signal.aborted) setBusy(false)
    }
  }

  function send(body: string) {
    void run(async (signal) => {
      try { sessionStorage.setItem(scope, body) } catch {
        setNotice('반납 요청을 보존할 수 없습니다.')
        return
      }
      setPending(body)
      setConfirmation(undefined)
      let receipt
      try {
        receipt = await returnExpendables(body, signal)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof ManagementError && error.status < 500 && error.status !== 408 && error.status !== 429) {
          finish(body)
          if (error.status === 409) await refresh(signal)
        }
        throw error
      }
      if (signal.aborted) return
      finish(body)
      setNotice('반납이 저장됐습니다. ' + receipt.number)
      setView(undefined)
      await refresh(signal)
    })
  }

  const locked = busy || !!pending || !!confirmation
  const lines = view?.rows.flatMap((row) => {
    const quantity = amounts[row.movementId]
    return quantity ? [{ issue: row.issue, movementId: row.movementId, quantity }] : []
  }) ?? []
  const canSubmit = !!view && lines.length > 0 && lines.every(({ movementId, quantity }) =>
    positive(quantity) && Number(quantity) <= (view.rows.find((row) => row.movementId === movementId)?.remaining ?? 0))
  return (
    <section className="pop-touch-form" aria-label="소모품 반납">
      <h2>소모품 반납</h2>
      <button type="button" disabled={locked} onClick={() => void run(refresh)}>반납 가능량 조회</button>
      {view && <p>재고 버전 {view.revision}</p>}
      {view && !view.rows.length && <p>반납할 원 출고 내역이 없습니다.</p>}
      {!!view?.rows.length && <div className="table-scroll"><table aria-label="원 출고 항번">
        <thead><tr><th scope="col">원 출고</th><th scope="col">항번</th><th scope="col">품목·LOT·위치</th>
          <th scope="col">출고량</th><th scope="col">반납 누계</th><th scope="col">반납 가능량</th><th scope="col">수량</th></tr></thead>
        <tbody>{view.rows.map((row) => (
          <tr key={row.movementId}><td>{row.issue}</td><th scope="row">{row.movementId}</th>
            <td>{[row.stock.item, row.stock.lot, row.stock.warehouse, row.stock.location].join(' / ')}</td>
            <td>{row.issued}</td><td>{row.returned}</td><td>{row.remaining}</td>
            <td><TouchInput inputMode="numeric" aria-label={row.movementId + ' 반납 수량'} disabled={locked || row.remaining === 0}
              value={amounts[row.movementId] ?? ''} onValue={next =>
                setAmounts({ ...amounts, [row.movementId]: next })} /></td></tr>
        ))}</tbody>
      </table></div>}
      <button type="button" disabled={locked || !canSubmit} onClick={() => {
        if (view && canSubmit) setConfirmation(JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: view.revision, lines }))
      }}>선택 행 반납</button>
      {confirmation && <div role="group" aria-label="반납 확인">
        <p>선택한 {lines.length}개 항번을 반납하시겠습니까?</p>
        <button type="button" onClick={() => send(confirmation)}>반납 확인</button>
        <button type="button" onClick={() => setConfirmation(undefined)}>돌아가기</button>
      </div>}
      {pending && <button type="button" disabled={busy} onClick={() => send(pending)}>동일 반납 요청 재시도</button>}
      <p role="status">{busy ? '처리 중입니다.' : notice}</p>
      <h3>반납 이력</h3>
      {view && !view.history.length && <p>반납 이력이 없습니다.</p>}
      {!!view?.history.length && <ul aria-label="반납 영수증">{view.history.map((receipt) => (
        <li key={receipt.number}>{receipt.number}
          <ul>{receipt.lines.map((line) => <li key={line.movementId}>{line.issue} · {line.movementId} · {line.quantity}개</li>)}</ul>
        </li>
      ))}</ul>}
    </section>
  )
}
