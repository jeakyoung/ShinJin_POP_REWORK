import type { Contract } from './output/outputDocument'

export type Action = 'CONFIRM' | 'CANCEL' | 'REPRINT'
export type Command = { handoffId: string; action: Action; printChecked?: boolean; previewPrinter?: string; expectedVersion: number; requestId: string }
export type ShippingRow = {
  print?: { status: string; device: string | null; pages: number }
  handoff: {
    id: string; packingRef: string; shippingTerminal: string
    lot: string; item: string; quantity: number; deferred: boolean
  }
  status: 'READY' | 'SHIPPED' | 'CANCELLED'
  version: number
  shipment: { number: string; confirmedAt: string; cancelledAt: string | null } | null
  reprintCount: number
}

type ShippingState = { terminal: string; worker: string; rows: ShippingRow[] }

export class ShippingError extends Error {
  readonly status: number

  constructor(status: number, code: string) {
    super(code)
    this.status = status
  }
}

const path = '/api/pop/shipping'

async function read<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ShippingError(response.status, body?.code ?? body?.status ?? 'REQUEST_FAILED')
  if (body === null) throw new Error('Empty shipping response')
  return body as T
}

export async function loadShipping(signal?: AbortSignal) {
  return read<ShippingState>(await fetch(path, { signal, credentials: 'same-origin', cache: 'no-store' }))
}

export async function sendShipping(command: Command, signal?: AbortSignal) {
  return read<ShippingRow>(await fetch(path + '/commands', {
    method: 'POST', signal,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  }))
}


function documentUrl(number: string) {
  return path + '/' + encodeURIComponent(number) + '/document'
}

export async function loadShippingDocument(number: string, signal: AbortSignal) {
  const response = await fetch(documentUrl(number), { signal, cache: 'no-store' })
  return { ...await read<Contract>(response), device: response.headers.get('X-Preview-Printer') }
}

export async function loadShippingPdf(number: string, signal: AbortSignal) {
  const response = await fetch(documentUrl(number) + '/pdf', { signal, cache: 'no-store' })
  if (!response.ok) return read<never>(response)
  if (response.headers.get('Content-Type') !== 'application/pdf') throw new Error('Shipping PDF unavailable')
  return response.blob()
}

export type ShippingInfo = {
  packingNumber: string; packingDate: string; order: string
  customerCode: string; customer: string; customerAbbreviation: string
  materialCode: string; material: string; itemKindCode: string; itemKind: string
  workCenter: string; workCenterName: string; orderWorker: string; productGroup: string
  thickness: number; width: number; length: number; orderQty: number; previous: number
  stock: number; warehouse: string; location: string
}
export type ShippingFormRow = { snapshot: ShippingRow; info: ShippingInfo; shippingDate: string | null; lots?: ShippingFormRow[] }
export type ShippingFormState = { terminal: string; worker: string; rows: ShippingFormRow[]; options: ShippingInfo[] }
export type ShippingBatch = {
  requestId: string; action: 'CONFIRM' | 'CANCEL'; rows: { id: string; version: number }[]
  shippingDate?: string; printChecked?: boolean
}
export function loadShippingForm(signal?: AbortSignal) {
  return fetch(path + '/form?includeRows=false', { signal, credentials: 'same-origin', cache: 'no-store' }).then(read<ShippingFormState>)
}
export function sendShippingBatch(command: ShippingBatch, signal?: AbortSignal) {
  return fetch(path + '/batch', { method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) })
    .then(read<{ rows: ShippingRow[]; documents: Record<string, NonNullable<ShippingRow['print']>> }>)
}

export type DocumentBundle = Contract & { expected: { id: string; version: number }[] }
export type BundlePrint = { numbers: string[]; expected: DocumentBundle['expected']; previewPrinter: string | null; requestId: string }
function bundleFetch(operation: string, payload: object, signal?: AbortSignal) {
  return fetch(path + '/documents/' + operation, { method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
}
export function loadBundle(numbers: string[], signal: AbortSignal) {
  return bundleFetch('preview', {numbers}, signal).then(read<DocumentBundle>)
}
export async function bundlePdf(numbers: string[], signal: AbortSignal) {
  const response = await bundleFetch('pdf', {numbers}, signal)
  if (!response.ok) return read<never>(response)
  return response.blob()
}
export function printBundle(command: BundlePrint, signal: AbortSignal) {
  return bundleFetch('print', command, signal).then(read<{status: string}>)
}

export function queryShipping(kind: 'packing' | 'completed', binding: object, signal: AbortSignal) {
  return fetch(path + '/queries/' + kind, { method: 'POST', signal, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(binding) }).then(read<ShippingFormState>)
}
