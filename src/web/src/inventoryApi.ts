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
  documents: DocumentHeader[]; catalog: Catalog; today: string
}
export type DocumentHeader = { number: string; requestNo: string; date: string; warehouse: string; actor: Actor; movementIds: string[] }
export type Item = { code: string; kind: string; qualityCode: string; quality: string; thickness: number; width: number; length: number; extraMaterial: boolean }
export type Catalog = { plants: Record<string,string>; warehouses: Record<string,string>; bins: { location: Location; name: string }[];
  items: Item[]; defaults: {item: string; location: Location}[]; inputWarehouses: Record<string,string[]>; auxiliaryWarehouses: Record<string,string[]> }
export type MoveLine = { lot: Lot; source: Location; rowDestination: Location; quantity: string }
export type DocumentCommand = CommandKey & ({ action: 'SAVE'; destinationSite: string; warehouse: string; lines: MoveLine[] }
  | {action: 'DELETE_LINES'; documentNo: string; selectedIds: string[]})

export function stockKey(balance: Pick<Balance,'lot'|'location'>) {
  return JSON.stringify([balance.lot.item,balance.lot.lot,balance.location.warehouse,balance.location.position])
}
export function locationName(view: InventoryView, location: Location) {
  if (location.position === '000000') return '미적용'
  return view.catalog.bins.find(row => row.location.warehouse === location.warehouse
    && row.location.position === location.position)?.name ?? location.position
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
export async function sendInventoryDocument(command: DocumentCommand) {
  return read<{ version: number; documentNo: string | null }>(await fetch(base + '/documents', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
  }))
}
