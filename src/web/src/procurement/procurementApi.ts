import { SessionExpired } from '../workHistoryApi'

export type SourceType = 'ESCO_SHIPMENT' | 'PURCHASE_ORDER'
export type SourceKey = { type: SourceType; number: string }
export type Line = { lineNo: number; item: string; warehouse: string; expected: number; received: number; remaining: number }
export type Receipt = {
  receiptId: string; source: SourceKey; terminalId: string; workerId: string; recordedAt: string; revision: number
  lines: { lineNo: number; item: string; warehouse: string; quantity: number; remaining: number }[]
}
export type Source = {
  source: SourceKey; sourceDate: string; status: 'OPEN' | 'PARTIALLY_RECEIVED' | 'RECEIVED'
  revision: number; lines: Line[]; receipts: Receipt[]
}
export type ReceiveCommand = {
  requestId: string; expectedRevision: number; lines: { lineNo: number; quantity: string }[]
}

const root = '/api/pop/procurement/sources'
const url = ({ type, number }: SourceKey) => root + '/' + type + '/' + encodeURIComponent(number)

export class ProcurementError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, signal: AbortSignal, body?: string): Promise<T> {
  const response = await fetch(path, {
    signal, cache: 'no-store', method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body,
  })
  if (response.status === 401) throw new SessionExpired()
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    throw new ProcurementError(response.status, failure?.code ?? 'HTTP_ERROR')
  }
  return response.json()
}

export function listSources(type: SourceType, number: string, date: string, signal: AbortSignal) {
  const filters = new URLSearchParams({ type })
  if (number) filters.set('number', number)
  if (date) filters.set('date', date)
  return request<Source[]>(root + '?' + filters, signal)
}

export const loadSource = (source: SourceKey, signal: AbortSignal) => request<Source>(url(source), signal)
export const receive = (source: SourceKey, body: string, signal: AbortSignal) =>
  request<Receipt>(url(source) + '/receipts', signal, body)
