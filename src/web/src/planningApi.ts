export type Branch = 'STANDARD' | 'REVERSE' | 'SPEC_CHANGE'
export type Status = 'PLANNED' | 'STARTED' | 'COMPLETED'
export type WorkState = 'CUT' | 'FINISHED'
export type OrderKey = { number: string; history: number; line: number }
export type PlanKey = { date: string; sequence: number }
export type MaterialKey = { item: string; lot: string; warehouse: string; position: string }
export type Spec<T = number> = { quality: string; workState: WorkState; thickness: T; width: T; length: T }
export type Order = { key: OrderKey; customer: string; item: string; spec: Spec; warehouse: string; ordered: number; issued: number }
export type Material = { key: MaterialKey; spec: Spec; available: number }
export type Plan = {
  key: PlanKey; branch: Branch; status: Status; originalOrder: OrderKey; sourcePlan: PlanKey | null
  issuedOrder: OrderKey; item: string; spec: Spec; warehouse: string; quantity: number; allocated: number
  materialUse: { source: MaterialKey; quantity: number } | null
}
export type View = {
  actor: { site: { factory: string; site: string; workCenter: string }; terminal: string; worker: string }
  revision: number; canWrite: boolean; warehouses: string[]; orders: Order[]; plans: Plan[]; materials: Material[]
}
export type Filter = { from: string; to: string; status: Status | ''; branch: Branch | '' }
type CommandBase = { requestId: string; expectedRevision: number; warehouse: string; quantity: string }
export type SingleCommand = CommandBase & (
  | { action: 'REVERSE_ISSUE'; originalOrder: OrderKey }
  | { action: 'CHANGE_SPEC'; targetPlan: PlanKey; spec: Spec<string>; sourceMaterial: MaterialKey; inputQuantity: string }
)

type FollowupBase = { requestId: string; expectedRevision: number }
export type Command = SingleCommand | FollowupBase & (
  | { action: 'MANAGEMENT'; warehouse: string; spec: Spec<string>; quantity: string }
  | { action: 'BATCH'; rows: SingleCommand[] }
)
export type Management = { id: string; month: string; warehouse: string; item: string; quantity: number }
export type CommandResult = { revision: number; plan?: Plan; management?: Management; plans?: Plan[] }

export class PlanningError extends Error {
  readonly status: number
  constructor(status: number, code: string) {
    super(code)
    this.status = status
  }
}

const base = '/api/pop/planning'

async function read<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new PlanningError(response.status, body?.code ?? 'REQUEST_FAILED')
  if (body == null) throw new Error('Missing planning response')
  return body as T
}

export async function loadPlanning(filter: Filter, signal?: AbortSignal) {
  const query = new URLSearchParams()
  for (const [field, value] of Object.entries(filter)) {
    if (value) query.set(field, value)
  }
  return read<View>(await fetch(base + (query.size ? '?' + query : ''), {
    credentials: 'same-origin', cache: 'no-store', signal,
  }))
}

export async function sendPlanning(command: Command) {
  const route = command.action === 'MANAGEMENT' ? '/management'
    : command.action === 'BATCH' ? '/batch' : '/commands'
  const payload = command.action === 'MANAGEMENT' || command.action === 'BATCH'
    ? Object.fromEntries(Object.entries(command).filter(([key]) => key !== 'action')) : command
  return read<CommandResult>(await fetch(base + route, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }))
}

export async function loadManagement(signal: AbortSignal) {
  return read<{ revision: number; management: Management[] }>(await fetch(base + '/followups', {
    credentials: 'same-origin', cache: 'no-store', signal,
  }))
}
