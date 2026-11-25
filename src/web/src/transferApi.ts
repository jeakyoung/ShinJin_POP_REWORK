export type Action =
  | 'REQUEST' | 'QUICK_TRANSFER' | 'SHIP' | 'RECEIVE'
  | 'UNDO_RECEIVE' | 'UNDO_SHIP' | 'CANCEL_REQUEST'
export type Status = 'REQUESTED' | 'SHIPPED' | 'RECEIVED' | 'CANCELLED'

type Line<T> = { number: number; item: string; quantity: T }
type Draft<T> = { source: string; destination: string; lines: Line<T>[] }
type DocumentId = { request: string; kind: 'REQUEST' | 'SHIP' | 'RECEIVE'; revision: number }

export type Actor = { terminalId: string; workerId: string }
export type Command = { request: string; commandId: string; action: Action; draft?: Draft<string | number> | null }
export type Transfer = {
  request: string
  status: Status
  draft: Draft<number>
  documents: Partial<Record<DocumentId['kind'], DocumentId>>
}
export type TransferState = {
  actor: Actor
  source: string
  destination: string
  stock: { warehouse: string; item: string; quantity: string }[]
  transfers: Transfer[]
  documents: { id: DocumentId; lines: { line: Line<number>; sourceDocument: DocumentId | null; sourceLine: number | null }[] }[]
  pending: { request: string; canRetry: boolean; command: Command | null }[]
}

export class TransferError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

const base = '/api/pop/transfers'

async function read<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new TransferError(response.status, body?.code ?? 'REQUEST_FAILED')
  if (!body) throw new Error('Invalid transfer response')
  return body as T
}

export async function loadTransfers(signal?: AbortSignal): Promise<TransferState> {
  return read(await fetch(base, { signal, credentials: 'same-origin', cache: 'no-store' }))
}

export async function sendTransfer(command: Command, simulatePopFailure = false, signal?: AbortSignal) {
  return read<{ code: 'OK'; transfer: Transfer; actor: Actor }>(await fetch(base + '/commands', {
    method: 'POST', signal,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, simulatePopFailure }),
  }))
}
