export type Action = 'CONFIRM' | 'CANCEL' | 'REPRINT'
export type Command = { handoffId: string; action: Action; expectedVersion: number; requestId: string }
export type ShippingRow = {
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
  if (!response.ok) throw new ShippingError(response.status, body?.code ?? 'REQUEST_FAILED')
  if (body === null) throw new Error('Empty shipping response')
  return body as T
}

export async function loadShipping(signal?: AbortSignal) {
  return read<ShippingState>(await fetch(path, { signal, credentials: 'same-origin', cache: 'no-store' }))
}

export async function sendShipping(command: Command) {
  return read<ShippingRow>(await fetch(path + '/commands', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  }))
}
