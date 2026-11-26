import { SessionExpired } from './workHistoryApi'

export type DrawingMaterial = { lot: string; warehouse: string; item: string; qty: number }
export type DrawingState = 'CUT_READY' | 'PACK1_ACTIVE' | 'DRAW_READY' | 'DRAW_ACTIVE' | 'PACK2_READY' | 'PACK2_ACTIVE' | 'STANDARD_PACK_ACTIVE' | 'SHIP_READY'
export type DrawingDetail = {
  activeGroupId: string | null
  state: DrawingState; plateFlag: string | null; version: number; ownerTerminalId: string | null; bypassedPack1: boolean
  shipPlanId: string | null; shipment: { material: DrawingMaterial; deferred: boolean } | null
}

export const drawingApi = '/api/drawing-008'
export const drawingStates: Record<DrawingState, string> = {
  CUT_READY: '절단 완료', PACK1_ACTIVE: '1차 포장 중', DRAW_READY: '도면가공 대기', DRAW_ACTIVE: '도면가공 중',
  PACK2_READY: '2차 포장 대기', PACK2_ACTIVE: '2차 포장 중', STANDARD_PACK_ACTIVE: '일반 포장 중', SHIP_READY: '출하 준비',
}

export class DrawingError extends Error {}

export async function drawingRequest<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch(path, {
    signal, cache: 'no-store', method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 401) throw new SessionExpired()
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new DrawingError(data?.error ?? 'HTTP_' + response.status)
  }
  return response.json()
}
