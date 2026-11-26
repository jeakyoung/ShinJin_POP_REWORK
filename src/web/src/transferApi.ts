import type { FormBody, FormView } from './transferFormTypes'
export type Action =
  | 'REQUEST' | 'QUICK_TRANSFER' | 'SHIP' | 'RECEIVE'
  | 'UNDO_RECEIVE' | 'UNDO_SHIP' | 'CANCEL_REQUEST'
export type Status = 'REQUESTED' | 'SHIPPED' | 'RECEIVED' | 'CANCELLED'

type Line<T> = { number: number; item: string; quantity: T; source?: string; destination?: string }
type Draft<T> = { source: string; destination: string; lines: Line<T>[] }
export type DocumentId = { request: string; kind: 'REQUEST' | 'SHIP' | 'RECEIVE'; revision: number }

export type Actor = { terminalId: string; workerId: string }
export type Command = { form?: FormBody; request: string; commandId: string; action: Action; sourceDocument?: DocumentId | null; autoReceive?: boolean; draft?: Draft<string | number> | null }
export type Transfer = {
  request: string
  status: Status
  draft: Draft<number>
  documents: Partial<Record<DocumentId['kind'], DocumentId>>
}
export type TransferMaster = {
  configured: boolean
  terminalPlant: string | null
  plants: { CODE_ID2: string; CODE_NAME_FULL: string; ETC: string }[]
  warehouses: { PLANT_CODE: string; WAREHOUSE_CODE: string; WAREHOUSE_NAME: string; ETC: string }[]
}
export type TransferState = {
  forms?: FormView | null
  actor: Actor
  source: string
  destination: string
  stock: { warehouse: string; item: string; quantity: string }[]
  headers?: Record<number, { department: string; worker: string; remark: string | null; number: string | null }>
  reportLines?: Record<string, { NO_LINE: number; STND_ITEM: string; DC_RMK: string }[]>
  master?: TransferMaster
  documentDates?: Record<number, string>
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
  if (command.form) return read<{ number: string }>(await fetch(base + '/forms', {
    method: 'POST', signal, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command.form),
  }))
  return read<{ code: 'OK'; transfer: Transfer; actor: Actor }>(await fetch(base + '/commands', {
    method: 'POST', signal,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, simulatePopFailure }),
  }))
}

export type OutputList = {
  form: 'rptOutputList'
  printerRole: 'Printer1'
  issuedAt: string
  groups: {
    request: string
    headerRemark?: string
    receivingPlant?: string
    department?: string
    requestDate: string
    rows: { number: number; quantity: number; specification?: string; remark?: string }[]
    total: number
  }[]
}

export async function previewOutputList(documents: DocumentId[], signal: AbortSignal): Promise<OutputList> {
  return read(await fetch(base + '/output-list/preview', {
    method: 'POST', signal, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documents }),
  }))
}
