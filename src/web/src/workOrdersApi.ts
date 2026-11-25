import { getSessionData } from './workHistoryApi'

export type OrderStatus = 'WAITING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETE'
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

export type StockLocation = { warehouse: string; location: string }
export type MaterialAction = 'ISSUE_MATERIAL' | 'RETURN_MATERIAL'

export type WorkOrderDetail = {
  plan: WorkOrder
  steps: { name: string; status: OrderStatus }[]
  actualQuantity: number | null
  startedBy: string | null
  completedBy: string | null
  revision: number
  materials: {
    lotCode: string
    issuedQuantity: number
    positions: { position: StockLocation; availableQuantity: number }[]
  }[]
  returnPosition: StockLocation
  materialEvents: { action: MaterialAction; lotCode: string; quantity: number; position: StockLocation; workerId: string; revision: number }[]
}

export function loadWorkOrders(status: OrderStatus | '', signal: AbortSignal) {
  const query = status ? `?${new URLSearchParams({ status })}` : ''
  return getSessionData<WorkOrder[]>(`/api/pop/work-orders${query}`, signal)
}

export function loadWorkOrder(plan: WorkOrder, signal: AbortSignal) {
  const date = encodeURIComponent(plan.planDate)
  return getSessionData<WorkOrderDetail>(`/api/pop/work-orders/${date}/${plan.planSequence}`, signal)
}

export type WorkOrderAction =
  | { action: 'START' | 'PAUSE' | 'RESUME' | 'CANCEL_START' }
  | { action: 'COMPLETE'; actualQuantity: number }
  | ({ action: 'ISSUE_MATERIAL'; lotCode: string; quantity: number } & StockLocation)
  | { action: 'RETURN_MATERIAL'; lotCode: string; quantity: number }

export function applyWorkOrderAction(detail: WorkOrderDetail, action: WorkOrderAction, signal: AbortSignal) {
  const { plan, revision } = detail
  const date = encodeURIComponent(plan.planDate)
  return getSessionData<WorkOrderDetail>(`/api/pop/work-orders/${date}/${plan.planSequence}/actions`, signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...action, expectedRevision: revision }),
  })
}
