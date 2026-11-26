import { SessionExpired } from './workHistoryApi'

export type DrawingMaterial = { lot: string; warehouse: string; item: string; qty: number }
export type DrawingGoodPlace = { warehouse:string; warehouseName:string; location:string; locationName:string; workStatus:string; etc:string }
export type DrawingState = 'CUT_READY' | 'PACK1_ACTIVE' | 'DRAW_READY' | 'DRAW_ACTIVE' | 'DRAW_PAUSED' | 'PACK2_READY' | 'PACK2_ACTIVE' | 'STANDARD_PACK_ACTIVE' | 'STANDARD_PACK_PAUSED' | 'SHIP_READY'
export type DrawingDetail = {
  goodPlace?:DrawingGoodPlace|null
  productionGroupNo: string | null
  activeGroupId: string | null
  state: DrawingState; plateFlag: string | null; version: number; ownerTerminalId: string | null; bypassedPack1: boolean
  shipPlanId: string | null; shipment: { material: DrawingMaterial; deferred: boolean } | null
}

export const drawingApi = '/api/drawing-008'
export const drawingStates: Record<DrawingState, string> = {
  CUT_READY: '절단 완료', PACK1_ACTIVE: '1차 포장 중', DRAW_READY: '도면가공 대기', DRAW_ACTIVE: '도면가공 중', DRAW_PAUSED: '도면가공 일시 중단',
  PACK2_READY: '2차 포장 대기', PACK2_ACTIVE: '2차 포장 중', STANDARD_PACK_ACTIVE: '일반 포장 중', STANDARD_PACK_PAUSED: '일반 포장 일시 중단', SHIP_READY: '출하 준비',
}

export class DrawingError extends Error {}

export async function drawingRequest<T>(path: string, signal: AbortSignal, body?: object | string): Promise<T> {
  const response = await fetch(path, {
    signal, cache: 'no-store', method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  signal.throwIfAborted()
  if (response.status === 401) throw new SessionExpired()
  // A timeout or gateway failure can arrive after the command was committed.
  if (response.status === 408 || response.status >= 500) {
    throw new Error(`Drawing response unavailable (HTTP ${response.status})`)
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    signal.throwIfAborted()
    throw new DrawingError(data?.error ?? 'HTTP_' + response.status)
  }
  const data = await response.json()
  signal.throwIfAborted()
  return data
}
