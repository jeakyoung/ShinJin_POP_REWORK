import { useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { loadTransfers, sendTransfer, TransferError } from './transferApi'
import type { Action, Actor, Command, Status, TransferState } from './transferApi'

const statusText: Record<Status, string> = {
  REQUESTED: '의뢰 완료',
  SHIPPED: '출고 완료',
  RECEIVED: '입고 완료',
  CANCELLED: '의뢰 취소 완료',
}

const actionText: Record<Action, string> = {
  REQUEST: '의뢰 등록',
  QUICK_TRANSFER: '간편이송 등록',
  SHIP: '출고',
  RECEIVE: '입고',
  UNDO_RECEIVE: '입고 취소',
  UNDO_SHIP: '출고 취소',
  CANCEL_REQUEST: '의뢰 취소',
}

const actions: Record<Status, Action[]> = {
  REQUESTED: ['SHIP', 'CANCEL_REQUEST'],
  SHIPPED: ['RECEIVE', 'UNDO_SHIP'],
  RECEIVED: ['UNDO_RECEIVE'],
  CANCELLED: [],
}

const codeText: Record<string, string> = {
  LOGIN_REQUIRED: '로그인 후 공장이송을 다시 열어 주세요.',
  INVALID_COMMAND: '명령 입력을 확인해 주세요.',
  MALFORMED_COMMAND: '요청 형식을 확인해 주세요.',
  INVALID_LINES: '품목과 수량을 확인해 주세요.',
  INVALID_STATE: '현재 상태에서 이 작업을 실행할 수 없습니다.',
  REQUEST_NOT_FOUND: '의뢰를 찾을 수 없습니다.',
  INSUFFICIENT_STOCK: '가용 재고가 부족합니다.',
  STOCK_OVERFLOW: '재고 수량 상한을 초과합니다.',
  REQUEST_ID_REUSED: '같은 명령 ID에 다른 입력이 사용되었습니다.',
  COMMAND_ACTOR_MISMATCH: '원래 작업자와 단말에서 재시도해 주세요.',
  RECONCILIATION_REQUIRED: '보류 중인 명령을 먼저 재시도해 주세요.',
  ERP_DETAIL_MISMATCH: 'ERP 문서 상세가 일치하지 않습니다. 대사 후 재시도해 주세요.',
  ERP_COMMITTED_POP_PENDING: 'ERP 반영은 완료되었습니다. 동일 명령을 재시도해 POP 반영을 마치세요.',
}

function message(error: unknown) {
  if (error instanceof TransferError) return codeText[error.code] ?? `공장이송 요청 실패 (HTTP ${error.status})`
  return '서버 응답을 확인할 수 없습니다. 같은 명령을 재시도해 주세요.'
}

function sameActor(a: Actor, b: Actor) {
  return a.terminalId === b.terminalId && a.workerId === b.workerId
}

type Props = { actor: Actor; onSessionExpired: () => void }

function readRetry(key: string): Command | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as Command : null
  } catch {
    return null
  }
}

export default function Transfer({ actor, onSessionExpired }: Props) {
  const retryKey = 'synthetic-transfer-retry:' + JSON.stringify([actor.terminalId, actor.workerId])
  const [state, setState] = useState<TransferState | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState<Command | null>(() => readRetry(retryKey))
  const [request, setRequest] = useState('')
  const [item, setItem] = useState('SKU-X')
  const [quantity, setQuantity] = useState('1')
  const [mode, setMode] = useState<'REQUEST' | 'QUICK_TRANSFER'>('REQUEST')
  const [simulate, setSimulate] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)

  useLayoutEffect(() => {
    const controller = new AbortController()
    loadTransfers(controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next)
    }).catch(error => {
      if (controller.signal.aborted) return
      if (error instanceof TransferError && error.status === 401) onSessionExpired()
      else setNotice(message(error))
    })
    return () => controller.abort()
  }, [onSessionExpired])

  useLayoutEffect(() => () => activeRequest.current?.abort(), [])

  function saveRetry(command: Command) {
    sessionStorage.setItem(retryKey, JSON.stringify(command))
    setRetry(command)
  }

  function clearRetry(commandId: string) {
    const current = readRetry(retryKey)
    if (current?.commandId === commandId) {
      sessionStorage.removeItem(retryKey)
      setRetry(null)
    } else {
      setRetry(current)
    }
  }

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (activeRequest.current) return
    const request = new AbortController()
    activeRequest.current = request
    setBusy(true)
    try {
      await work(request.signal)
    } catch (error) {
      if (request.signal.aborted) return
      if (error instanceof TransferError && error.status === 401) {
        setState(null)
        onSessionExpired()
      } else {
        setNotice(message(error))
      }
    } finally {
      activeRequest.current = null
      if (!request.signal.aborted) setBusy(false)
    }
  }

  function refresh() {
    void run(async (signal) => {
      const next = await loadTransfers(signal)
      if (signal.aborted) return
      setState(next)
      setNotice('')
    })
  }

  function execute(command: Command, injectFailure = false) {
    if (!state || !sameActor(actor, state.actor)) return
    void run(async (signal) => {
      try {
        saveRetry(command)
      } catch {
        setNotice('재시도 사본을 저장할 수 없습니다. 브라우저 저장소 설정을 확인해 주세요.')
        return
      }
      setNotice('')
      try {
        await sendTransfer(command, injectFailure, signal)
        if (signal.aborted) return
        clearRetry(command.commandId)
        setNotice(`${actionText[command.action]} 반영 완료`)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof TransferError && error.status === 401) throw error
        const definitiveFailure = error instanceof TransferError && error.status < 500
          && error.code !== 'ERP_DETAIL_MISMATCH'
        if (definitiveFailure) clearRetry(command.commandId)
        setNotice(message(error))
      }
      try {
        const next = await loadTransfers(signal)
        if (!signal.aborted) setState(next)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof TransferError && error.status === 401) throw error
        setNotice(previous => [previous, message(error)].filter(Boolean).join(' '))
      }
    })
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!state || retry || !request.trim()) return
    void execute({
      request: request.trim(), commandId: crypto.randomUUID(), action: mode,
      draft: { source: state.source, destination: state.destination, lines: [{ number: 10, item, quantity }] },
    }, simulate)
  }

  const retryVisible = retry && state && sameActor(actor, state.actor)
  const pending = state?.pending ?? []
  const pendingRequests = new Set(pending.map(entry => entry.request))
  const canCreate = state && !busy && !retry && !pendingRequests.has(request.trim())

  return (
    <section aria-labelledby="transfer-heading">
      <h2 id="transfer-heading">공장이송</h2>
      <button type="button" disabled={busy} onClick={() => void refresh()}>새로고침</button>
      {notice && <p role="status">{notice}</p>}
      {retryVisible && !pendingRequests.has(retry.request) && (
        <button type="button" disabled={busy} onClick={() => void execute(retry)}>
          {retry.request} 동일 명령 재시도
        </button>
      )}
      {state && (
        <>
          <p>단말 {state.actor.terminalId} · 작업자 {state.actor.workerId}</p>
          <form onSubmit={create}>
            <label>의뢰 ID <input required maxLength={64} value={request} onChange={e => setRequest(e.target.value)} /></label>{' '}
            <label>품목 <select value={item} onChange={e => setItem(e.target.value)}>
              <option>SKU-X</option><option>SKU-Y</option>
            </select></label>{' '}
            <label>수량 <input required type="number" min="0.001" step="0.001" value={quantity}
              onChange={e => setQuantity(e.target.value)} /></label>{' '}
            <label>처리 방식 <select value={mode} onChange={e =>
              setMode(e.target.value === 'QUICK_TRANSFER' ? 'QUICK_TRANSFER' : 'REQUEST')}>
              <option value="REQUEST">단계별 의뢰</option><option value="QUICK_TRANSFER">간편이송</option>
            </select></label>{' '}
            <button type="submit" disabled={!canCreate}>{actionText[mode]}</button>
          </form>
          <label><input type="checkbox" checked={simulate} disabled={busy}
            onChange={e => setSimulate(e.target.checked)} /> ERP 선반영 후 POP 실패 모의</label>

          {pending.length > 0 && (
            <section aria-labelledby="transfer-pending">
              <h2 id="transfer-pending">POP 반영 보류</h2>
              <ul>{pending.map(entry => <li key={entry.request}>
                {entry.request}{' '}
                {entry.canRetry && entry.command ? (
                  <button type="button" disabled={busy || (retry !== null && retry.request !== entry.request)}
                    onClick={() => { if (entry.command) void execute(entry.command) }}>동일 명령 재시도</button>
                ) : '원래 작업자·단말에서 재시도'}
              </li>)}</ul>
            </section>
          )}

          <h2>의뢰 현황</h2>
          <p>취소 순서 · 입고 취소 → 출고 취소 → 의뢰 취소</p>
          <table>
            <thead><tr><th scope="col">의뢰</th><th scope="col">상태</th><th scope="col">가능 작업</th></tr></thead>
            <tbody>{state.transfers.map(transfer => <tr key={transfer.request}>
              <th scope="row">{transfer.request}</th>
              <td>{statusText[transfer.status]}{pendingRequests.has(transfer.request) && ' · POP 반영 보류'}</td>
              <td>{actions[transfer.status].map(action => <button type="button" key={action}
                disabled={busy || !!retry || pendingRequests.has(transfer.request)}
                onClick={() => void execute({ request: transfer.request, commandId: crypto.randomUUID(), action }, simulate)}>
                {actionText[action]}
              </button>)}</td>
            </tr>)}</tbody>
          </table>
          <h2>POP 재고</h2>
          <ul>{state.stock.map(row => <li key={JSON.stringify([row.warehouse, row.item])}>
            {row.warehouse} · {row.item} · {row.quantity}
          </li>)}</ul>
          <h2>ERP 활성 문서</h2>
          <ul>{state.documents.map(({ id, lines }) => <li key={id.revision}>
            {id.request} · {id.kind} · {id.revision} · 상세 {lines.length}건
          </li>)}</ul>
        </>
      )}
    </section>
  )
}
