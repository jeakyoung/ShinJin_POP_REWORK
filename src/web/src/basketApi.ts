export type PlanKey = { date: string; sequence: number }
export type Lot = { item: string; lot: string; warehouse: string; position: string }
export type Issue = { lot: Lot; quantity: string }
export type ReturnLine = Issue & { length: string }
export type Action = 'SAVE_BASKET' | 'START_BASKET' | 'DELETE_UNFINISHED'
export type Actor = { terminal: string; worker: string }
export type BasketView = {
  actor: Actor & { scope: { factory: string; site: string; center: string } }
  mode: 'BASKET' | 'ALL_LIST' | 'CHECKED_LIST'
  revision: number
  canWrite: boolean
  work: { plan: { key: PlanKey; order: string; orderLine: number; item: string }; phase: string; groupId: string | null }[]
  groups: { id: string; terminal: string; issues: { lot: Lot; quantity: number }[]; returns: { lot: Lot; quantity: number; length: number }[]; startedAt: string | null }[]
  materials: { lot: Lot; available: number }[]
  returnCandidates: Lot[]
}
export type Command = {
  action: Action; requestId: string; expectedRevision: number
  visible: PlanKey[]; selected: PlanKey[]; issues: Issue[]; returns: ReturnLine[]
}
type Result = { revision: number; affected: PlanKey[]; groupId: string | null }
export class BasketApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
async function request<T>(suffix = '', init?: RequestInit): Promise<T> {
  const response = await fetch('/api/pop/work-baskets' + suffix, { ...init, credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new BasketApiError(response.status, typeof body?.code === 'string' ? body.code : 'HTTP ' + response.status)
  }
  return response.json() as Promise<T>
}
export const loadBasket = () => request<BasketView>()
export const sendBasketCommand = (command: Command) => request<Result>('/commands', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
})
