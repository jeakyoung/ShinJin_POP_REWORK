import type { ReceiveCommand, SourceKey } from './procurementApi'

export type ProcurementActor = { terminalId: string; workerId: string }
export type PendingReceipt = { source: SourceKey; body: string }

export const actorScope = ({ terminalId, workerId }: ProcurementActor) => JSON.stringify([terminalId, workerId])
const storageKey = (scope: string) => 'synthetic-procurement-receipt:' + scope

export function createPending(source: SourceKey, command: ReceiveCommand): PendingReceipt {
  return { source, body: JSON.stringify(command) }
}

export function recoverPending(scope: string): PendingReceipt | undefined {
  try {
    const pending = JSON.parse(sessionStorage.getItem(storageKey(scope)) ?? 'null')
    if (!pending || !['ESCO_SHIPMENT', 'PURCHASE_ORDER'].includes(pending.source?.type)
      || typeof pending.source?.number !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,39}$/.test(pending.source.number)
      || typeof pending.body !== 'string') return
    const command = JSON.parse(pending.body)
    if (typeof command?.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(command.requestId)
      || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0
      || !Array.isArray(command.lines) || !command.lines.length
      || command.lines.some((line: { lineNo: unknown; quantity: unknown } | null) =>
        !line || typeof line.lineNo !== 'number' || !Number.isSafeInteger(line.lineNo) || line.lineNo < 1
        || typeof line.quantity !== 'string' || !/^\d+(?:\.\d{1,3})?$/.test(line.quantity)
        || Number(line.quantity) <= 0 || !Number.isFinite(Number(line.quantity)))) return
    return { source: pending.source, body: pending.body }
  } catch {
    return
  }
}

export function storePending(scope: string, pending?: PendingReceipt) {
  if (pending) sessionStorage.setItem(storageKey(scope), JSON.stringify(pending))
  else sessionStorage.removeItem(storageKey(scope))
}
