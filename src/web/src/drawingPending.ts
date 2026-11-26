import { DrawingError, drawingRequest } from './drawingApi'

const groupActions = ['DRAW_START', 'DRAW_PAUSE', 'DRAW_RESUME', 'DRAW_FINISH']
const planActions = [...groupActions, 'PACK1_START', 'PACK1_FINISH', 'PACK2_START', 'PACK2_FINISH',
  'STANDARD_PACK_START', 'STANDARD_PACK_PAUSE', 'STANDARD_PACK_RESUME', 'STANDARD_PACK_FINISH']

export type DrawingScope = readonly [terminal: string, worker: string, kind: 'plan' | 'group' | 'packing' | 'returns', unit: string]
export type PendingDrawing = { action: string; body: string }

function storageKey(scope: DrawingScope, action: string) {
  return 'synthetic-drawing:' + JSON.stringify([...scope, action])
}

export function pendingDrawing(scope: DrawingScope): PendingDrawing | undefined {
  for (const action of scope[2] === 'returns' ? ['SAVE_RETURNS'] : scope[2] === 'packing' ? [...planActions, 'STANDARD_PACK_CANCEL'] : scope[2] === 'plan' ? planActions : groupActions) {
    const body = sessionStorage.getItem(storageKey(scope, action))
    if (body !== null) return { action, body }
  }
}

// A stored command belongs to one authenticated actor and one selected unit.
// Replaying an absent or superseded receipt must never recreate it.
export async function submitDrawing<T>(scope: DrawingScope, endpoint: string, signal: AbortSignal,
  command: PendingDrawing, replay: boolean, update: (pending?: PendingDrawing) => void): Promise<T | undefined> {
  const found = pendingDrawing(scope)
  const key = storageKey(scope, command.action)
  if (replay ? found?.action !== command.action || found.body !== command.body : !!found) {
    update(found)
    return
  }
  if (!replay) sessionStorage.setItem(key, command.body)
  update(command)
  function stillCurrent() {
    return !signal.aborted && sessionStorage.getItem(key) === command.body
  }
  function settle() {
    sessionStorage.removeItem(key)
    update(pendingDrawing(scope))
  }
  let result: T
  try {
    result = await drawingRequest<T>(endpoint, signal, command.body)
  } catch (error) {
    if (!stillCurrent()) {
      if (!signal.aborted) update(pendingDrawing(scope))
      return
    }
    if (error instanceof DrawingError) settle()
    throw error
  }
  if (!stillCurrent()) {
    if (!signal.aborted) update(pendingDrawing(scope))
    return
  }
  settle()
  return result
}
