export type Location = { warehouse: string; position: string }
export type Lot = { item: string; lot: string }
export type Actor = { site: { factory: string; site: string }; terminal: string; worker: string }
export type Balance = { lot: Lot; location: Location; quantity: string }
export type Movement = {
  id: string; lot: Lot; source: Location; destination: Location; quantity: string
  status: 'MOVED' | 'CANCELLED'; movedBy: Actor; cancelledBy: Actor | null
}
export type InventoryView = {
  actor: Actor; version: number; canMove: boolean; locations: Location[]
  balances: Balance[]; movements: Movement[]
}

type CommandKey = { expectedVersion: number; requestId: string }
export type Command = CommandKey & (
  | { action: 'MOVE'; lot: Lot; source: Location; destination: Location; quantity: string }
  | { action: 'CANCEL'; movementId: string }
)

export class InventoryError extends Error {
  readonly status: number

  constructor(status: number, code: string) {
    super(code)
    this.status = status
  }
}

const base = '/api/pop/inventory-moves'

async function read<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new InventoryError(response.status, body?.code ?? 'REQUEST_FAILED')
  if (body == null) throw new Error('Missing inventory response')
  return body as T
}

export async function loadInventory(signal?: AbortSignal) {
  return read<InventoryView>(await fetch(base, { signal, credentials: 'same-origin', cache: 'no-store' }))
}

export async function sendInventory(command: Command) {
  return read<{ version: number; movement: Movement }>(await fetch(base + '/commands', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  }))
}
