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
}

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export function loadContext(signal: AbortSignal) {
  return get<PopContext>('/api/pop/context', signal)
}

export function loadWorkHistory(
  filters: { terminalId: string; workerId: string; date: string },
  signal: AbortSignal,
) {
  return get<WorkEntry[]>(`/api/pop/work-history?${new URLSearchParams(filters)}`, signal)
}
