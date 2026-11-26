export type Worker = {
  id: string
  name: string
  department: string
}

export type Terminal = {
  id: string
  name: string
  factory: string
  workCenter: string
  workers: Worker[]
}

export type PopContext = {
  sampleDate: string
  terminals: Terminal[]
}

export type WorkEntry = {
  id: string
  orderNumber: string
  itemName: string
  processName: string
  plannedQuantity: number
  actualQuantity: number
  movement: string
  warehouse: string
  startedAt: string
  finishedAt: string
  checked?: string | null
  customer?: string | null
  itemKind?: string | null
  material?: string | null
  partNo?: string | null
  thickness?: number | null
  width?: number | null
  length?: number | null
  productionGroup?: string | null
}

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export function loadContext(signal: AbortSignal) {
  return get<PopContext>('/api/pop/context', signal)
}

export type Identity = { terminal: Omit<Terminal, 'workers'>; worker: Worker; groupWork?: boolean; packingMenu?: boolean; workCenterCode?: string; processSlots?: number[]; workCodes?: Record<number,string>; workNames?: Record<number,string>; initialView?: 'home' | 'orders' | 'basket' | 'drawing' | 'packing' }

export async function loadSession(signal: AbortSignal): Promise<Identity | undefined> {
  const response = await fetch('/api/pop/session', { signal })
  if (response.status === 401) return undefined
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export function signIn(input: { terminalId: string; method: string; identifier: string; passcode: string }) {
  return post<Identity>('/api/pop/session', input)
}

export async function signOut() {
  const response = await fetch('/api/pop/session/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export class SessionExpired extends Error {}

export function loadWorkHistory(date: string, signal: AbortSignal) {
  return getSessionData<WorkEntry[]>(`/api/pop/work-history?${new URLSearchParams({ date })}`, signal)
}

export class SessionRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

export async function getSessionData<T>(path: string, signal: AbortSignal, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, signal, cache: 'no-store' })
  if (response.status === 401) throw new SessionExpired()
  if (!response.ok) throw new SessionRequestError(response.status)
  return response.json()
}
