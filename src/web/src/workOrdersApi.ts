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
}

export function loadWorkOrders(status: OrderStatus | '', signal: AbortSignal) {
  const query = status ? `?${new URLSearchParams({ status })}` : ''
  return getSessionData<WorkOrder[]>(`/api/pop/work-orders${query}`, signal)
}

export function loadWorkOrder(plan: WorkOrder, signal: AbortSignal) {
  const date = encodeURIComponent(plan.planDate)
  return getSessionData<WorkOrderDetail>(`/api/pop/work-orders/${date}/${plan.planSequence}`, signal)
}
