import { SessionExpired } from '../workHistoryApi'

export type Actor = { terminalId: string; workerId: string }
export type StockKey = { item: string; lot: string; warehouse: string; location: string }
export type Stock = { key: StockKey; name: string; available: number }
export type PriorLine = { request: string; stock: StockKey; name: string; issued: number; available: number }
export type Selection = { origin: 'CATALOG' | 'RECENT'; priorRequest: string | null; stock: StockKey; quantity: string }
export type Issue = { number: string; revision: number; actor: { worker: string }; lines: {
  movementId: string; stock: StockKey; quantity: number; origin: Selection['origin']
}[] }
export type RepairStatus = 'ALL' | 'COMPLETE' | 'OPEN'
export type Repair = { issue: string; equipment: string; reason: string; opened: string; closed: string | null; result: string | null
  detail?: { sequence: number; equipmentName: string; reporter: string; resolver: string | null; openedTime: string
    closedTime: string | null; elapsedHours: string } | null }
type RepairView = { from: string; to: string; rows: Repair[] }

const root = '/api/pop/management'
export class ManagementError extends Error {
  readonly status: number
  constructor(status: number, code: string) {
    super(code)
    this.status = status
  }
}

async function request<T>(url: string, signal: AbortSignal, body?: string): Promise<T> {
  const response = await fetch(root + url, {
    signal, cache: 'no-store', method: body === undefined ? 'GET' : 'POST', body,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  })
  if (response.status === 401) throw new SessionExpired()
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    throw new ManagementError(response.status, failure?.code ?? 'REQUEST_FAILED')
  }
  return response.json()
}

type ItemDetail = { name: string; specification: string; quality: string; partNumber: string }
export type SupplyScreen = {
  revision: number
  masters: { materialFlags: Record<string, string>; kind1: Record<string, string>; kind2: Record<string, Record<string, string>> }
  items: Record<string, ItemDetail>
  catalog: Stock[]
  recent: PriorLine[]
  held: ReturnView['rows']
}

export function loadExpendables(filters: Record<string, string>, signal: AbortSignal) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim())
  return request<SupplyScreen>('/expendables/screen?' + params, signal)
}
export function issueExpendables(body: string, signal: AbortSignal) {
  return request<Issue>('/expendables/issues', signal, body)
}
export function loadRepairs(from: string, to: string, status: RepairStatus, signal: AbortSignal) {
  const params = new URLSearchParams({ status })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return request<RepairView>('/repairs?' + params, signal)
}


export type ReturnView = {
  revision: number
  rows: { issue: string; movementId: string; stock: StockKey; issued: number; returned: number; remaining: number }[]
  history: ReturnReceipt[]
}
type ReturnReceipt = { number: string; revision: number;
  lines: { issue: string; movementId: string; stock: StockKey; quantity: number }[]
}
export const loadReturns = (signal: AbortSignal) => request<ReturnView>('/expendables/returns', signal)
export const returnExpendables = (body: string, signal: AbortSignal) =>
  request<ReturnReceipt>('/expendables/returns', signal, body)
