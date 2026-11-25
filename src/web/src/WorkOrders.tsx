import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { SessionExpired, SessionRequestError } from './workHistoryApi'
import { applyWorkOrderAction, loadWorkOrder, loadWorkOrders } from './workOrdersApi'
import type { OrderStatus, WorkOrder, WorkOrderAction, WorkOrderDetail } from './workOrdersApi'

type Load<T> = { state: 'loading' | 'error' } | { state: 'ready'; data: T }

const labels: Record<OrderStatus, string> = { WAITING: '대기', IN_PROGRESS: '진행 중', PAUSED: '중지', COMPLETE: '완료' }
const actionMessages: Record<WorkOrderAction['action'], string> = {
  START: '작업을 시작했습니다.',
  PAUSE: '작업을 중지했습니다.',
  RESUME: '작업을 재개했습니다.',
  CANCEL_START: '작업 시작을 취소했습니다.',
  COMPLETE: '작업을 완료했습니다.',
}
const quantity = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 })

export default function WorkOrders({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [status, setStatus] = useState<OrderStatus | ''>('')
  const [attempt, setAttempt] = useState(0)
  const [orders, setOrders] = useState<Load<WorkOrder[]>>({ state: 'loading' })
  const [selected, setSelected] = useState<WorkOrder>()
  const [detail, setDetail] = useState<Load<WorkOrderDetail>>({ state: 'loading' })
  const [detailAttempt, setDetailAttempt] = useState(0)

  const [actualQuantity, setActualQuantity] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [applying, setApplying] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const activeAction = useRef<AbortController | null>(null)

  useEffect(() => () => activeAction.current?.abort(), [])

  useEffect(() => {
    const request = new AbortController()
    loadWorkOrders(status, request.signal).then((data) => {
      if (!request.signal.aborted) setOrders({ state: 'ready', data })
    }).catch((error) => {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setOrders({ state: 'error' })
    })
    return () => request.abort()
  }, [status, attempt, onSessionExpired])

  useEffect(() => {
    if (!selected) return
    const request = new AbortController()
    loadWorkOrder(selected, request.signal).then((data) => {
      if (!request.signal.aborted) setDetail({ state: 'ready', data })
    }).catch((error) => {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setDetail({ state: 'error' })
    })
    return () => request.abort()
  }, [selected, detailAttempt, onSessionExpired])

  function refresh() {
    setSelected(undefined)
    setActionNotice('')
    setConfirmCancel(false)
    setOrders({ state: 'loading' })
    setAttempt((value) => value + 1)
  }

  function selectOrder(order: WorkOrder) {
    setActualQuantity('')
    setActionNotice('')
    setConfirmCancel(false)
    setDetail({ state: 'loading' })
    setSelected(order)
    setDetailAttempt((value) => value + 1)
  }

  async function applyAction(current: WorkOrderDetail, action: WorkOrderAction) {
    if (activeAction.current) return
    const request = new AbortController()
    activeAction.current = request
    setApplying(true)
    setActionNotice('')
    setConfirmCancel(false)
    try {
      const data = await applyWorkOrderAction(current, action, request.signal)
      if (request.signal.aborted) return
      setDetail({ state: 'ready', data })
      setActualQuantity('')
      setOrders({ state: 'loading' })
      setAttempt((value) => value + 1)
      setActionNotice(actionMessages[action.action])
    } catch (error) {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) {
        onSessionExpired()
      } else if (error instanceof SessionRequestError && error.status === 409) {
        setActionNotice('다른 요청으로 상태가 바뀌었습니다. 최신 상태를 표시합니다.')
        setDetail({ state: 'loading' })
        setDetailAttempt((value) => value + 1)
        setOrders({ state: 'loading' })
        setAttempt((value) => value + 1)
      } else if (error instanceof SessionRequestError && error.status === 400) {
        setActionNotice(action.action === 'COMPLETE'
          ? '실적수량은 계획수량 이내의 양수로, 소수 셋째 자리까지 입력해 주세요.'
          : '요청을 처리할 수 없습니다. 작업지시 상태를 다시 확인해 주세요.')
      } else {
        setActionNotice('응답을 확인하지 못했습니다. 다시 조회해 상태를 확인해 주세요.')
        setDetail({ state: 'loading' })
        setDetailAttempt((value) => value + 1)
        setOrders({ state: 'loading' })
        setAttempt((value) => value + 1)
      }
    } finally {
      if (activeAction.current === request) activeAction.current = null
      if (!request.signal.aborted) setApplying(false)
    }
  }

  function complete(event: FormEvent<HTMLFormElement>, current: WorkOrderDetail) {
    event.preventDefault()
    const amount = Number(actualQuantity)
    if (!Number.isFinite(amount) || amount <= 0 || amount > current.plan.plannedQuantity) return
    void applyAction(current, { action: 'COMPLETE', actualQuantity: amount })
  }

  return (
    <>
      <section aria-labelledby="orders-title">
        <h2 id="orders-title">작업지시 목록</h2>
        <div className="work-order-controls">
          <label>진행 상태
            <select disabled={applying} value={status} onChange={(event) => {
              setStatus(event.target.value as OrderStatus | '')
              refresh()
            }}>
              <option value="">전체</option>
              <option value="WAITING">대기</option>
              <option value="IN_PROGRESS">진행 중</option>
              <option value="PAUSED">중지</option>
              <option value="COMPLETE">완료</option>
            </select>
          </label>
          <button type="button" disabled={applying} onClick={refresh}>새로 조회</button>
        </div>
        <p role="status">
          {orders.state === 'loading' && '작업지시를 조회 중입니다.'}
          {orders.state === 'error' && '작업지시를 불러오지 못했습니다.'}
          {orders.state === 'ready' && (orders.data.length ? `${orders.data.length}건` : '조건에 맞는 작업지시가 없습니다.')}
        </p>
        {orders.state === 'ready' && orders.data.length > 0 && (
          <div className="table-scroll">
            <table aria-labelledby="orders-title">
              <thead><tr>
                <th scope="col">수주번호</th><th scope="col">생산계획</th><th scope="col">품목</th>
                <th scope="col">공정</th><th scope="col" className="numeric">계획수량</th><th scope="col">상태</th>
              </tr></thead>
              <tbody>{orders.data.map((order) => (
                <tr key={`${order.planDate}/${order.planSequence}`}>
                  <td><button type="button" className="order-link" disabled={applying} onClick={() => selectOrder(order)}>
                    {order.orderNumber} / {order.orderLine}
                  </button></td>
                  <td>{order.planDate} / {order.planSequence}</td><td>{order.itemName}</td><td>{order.process}</td>
                  <td className="numeric">{quantity.format(order.plannedQuantity)}</td><td>{labels[order.status]}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <section aria-labelledby="order-detail-title">
          <h2 id="order-detail-title">{selected.orderNumber} 공정 진행 현황</h2>
          {detail.state === 'loading' && <p role="status">진행 현황을 조회 중입니다.</p>}
          {detail.state === 'error' && <>
            <p role="alert">진행 현황을 불러오지 못했습니다.</p>
            <button type="button" onClick={() => selectOrder(selected)}>상세 다시 조회</button>
          </>}
          {detail.state === 'ready' && (
            <>
              <ol className="process-steps">
                {detail.data.steps.map((step) => <li key={step.name}>{step.name} · {labels[step.status]}</li>)}
              </ol>
              {detail.data.actualQuantity !== null && <p>실적수량 {quantity.format(detail.data.actualQuantity)}</p>}
              {detail.data.plan.status === 'WAITING' && (
                <button type="button" disabled={applying} onClick={() => {
                  void applyAction(detail.data, { action: 'START' })
                }}>작업 시작</button>
              )}
              {(detail.data.plan.status === 'IN_PROGRESS' || detail.data.plan.status === 'PAUSED') && (
                <div className="work-order-controls work-order-transitions">
                  {detail.data.plan.status === 'IN_PROGRESS' ? (
                    <button type="button" disabled={applying || confirmCancel} onClick={() => {
                      void applyAction(detail.data, { action: 'PAUSE' })
                    }}>작업 중지</button>
                  ) : (
                    <button type="button" disabled={applying || confirmCancel} onClick={() => {
                      void applyAction(detail.data, { action: 'RESUME' })
                    }}>작업 재개</button>
                  )}
                  {confirmCancel ? (
                    <>
                      <p>이 작업을 대기 상태로 되돌릴까요?</p>
                      <button type="button" disabled={applying} onClick={() => {
                        void applyAction(detail.data, { action: 'CANCEL_START' })
                      }}>시작 취소 확인</button>
                      <button type="button" disabled={applying} onClick={() => setConfirmCancel(false)}>돌아가기</button>
                    </>
                  ) : (
                    <button type="button" disabled={applying} onClick={() => setConfirmCancel(true)}>작업 시작 취소</button>
                  )}
                </div>
              )}
              {detail.data.plan.status === 'IN_PROGRESS' && !confirmCancel && (
                <form className="work-order-action" onSubmit={(event) => complete(event, detail.data)}>
                  <label>실적수량
                    <input type="number" min="0.001" max={detail.data.plan.plannedQuantity} step="0.001"
                      required disabled={applying} value={actualQuantity}
                      onChange={(event) => setActualQuantity(event.target.value)} />
                  </label>
                  <button disabled={applying}>작업 완료</button>
                </form>
              )}
            </>
          )}
          {(applying || actionNotice) && <p role="status">{applying ? '처리 중입니다.' : actionNotice}</p>}
        </section>
      )}
    </>
  )
}
