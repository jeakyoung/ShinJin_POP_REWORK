import { getSessionData } from './workHistoryApi'

export type OrderStatus = 'WAITING' | 'IN_PROGRESS' | 'COMPLETE'
export type WorkOrder = {
  planDate: string
  planSequence: number
  orderNumber: string
  orderLine: number
  itemName: string
  process: string
  plannedQuantity: number
  status: OrderStatus
}

export type WorkOrderDetail = {
  plan: WorkOrder
  steps: { name: string; status: OrderStatus }[]
  actualQuantity: number | null
  startedBy: string | null
  completedBy: string | null
}

export function loadWorkOrders(status: OrderStatus | '', signal: AbortSignal) {
  const query = status ? `?${new URLSearchParams({ status })}` : ''
  return getSessionData<WorkOrder[]>(`/api/pop/work-orders${query}`, signal)
}

export function loadWorkOrder(plan: WorkOrder, signal: AbortSignal) {
  const date = encodeURIComponent(plan.planDate)
  return getSessionData<WorkOrderDetail>(`/api/pop/work-orders/${date}/${plan.planSequence}`, signal)
}

export type WorkOrderAction = { action: 'START' } | { action: 'COMPLETE'; actualQuantity: number }

export function applyWorkOrderAction(plan: WorkOrder, action: WorkOrderAction, signal: AbortSignal) {
  const date = encodeURIComponent(plan.planDate)
  return getSessionData<WorkOrderDetail>(`/api/pop/work-orders/${date}/${plan.planSequence}/actions`, signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  })
}
