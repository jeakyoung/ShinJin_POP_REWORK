import { useEffect, useState } from 'react'
import { SessionExpired } from './workHistoryApi'
import { loadWorkOrder, loadWorkOrders } from './workOrdersApi'
import type { OrderStatus, WorkOrder, WorkOrderDetail } from './workOrdersApi'

type Load<T> = { state: 'loading' | 'error' } | { state: 'ready'; data: T }

const labels: Record<OrderStatus, string> = { WAITING: '대기', IN_PROGRESS: '진행 중', COMPLETE: '완료' }
const quantity = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 })

export default function WorkOrders({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [status, setStatus] = useState<OrderStatus | ''>('')
  const [attempt, setAttempt] = useState(0)
  const [orders, setOrders] = useState<Load<WorkOrder[]>>({ state: 'loading' })
  const [selected, setSelected] = useState<WorkOrder>()
  const [detail, setDetail] = useState<Load<WorkOrderDetail>>({ state: 'loading' })
  const [detailAttempt, setDetailAttempt] = useState(0)

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
    setOrders({ state: 'loading' })
    setAttempt((value) => value + 1)
  }

  function selectOrder(order: WorkOrder) {
    setDetail({ state: 'loading' })
    setSelected(order)
    setDetailAttempt((value) => value + 1)
  }

  return (
    <>
      <section aria-labelledby="orders-title">
        <h2 id="orders-title">작업지시 목록</h2>
        <div className="work-order-controls">
          <label>진행 상태
            <select value={status} onChange={(event) => {
              setStatus(event.target.value as OrderStatus | '')
              refresh()
            }}>
              <option value="">전체</option>
              <option value="WAITING">대기</option>
              <option value="IN_PROGRESS">진행 중</option>
              <option value="COMPLETE">완료</option>
            </select>
          </label>
          <button type="button" onClick={refresh}>새로 조회</button>
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
                  <td><button type="button" className="order-link" onClick={() => selectOrder(order)}>
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
            <ol className="process-steps">
              {detail.data.steps.map((step) => <li key={step.name}>{step.name} · {labels[step.status]}</li>)}
            </ol>
          )}
        </section>
      )}
    </>
  )
}
