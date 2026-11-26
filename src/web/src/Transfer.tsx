import TransferEntryForm from './TransferEntryForm'
import TransferMessage from './TransferMessage'
import type { Message } from './TransferMessage'
import TransferDocuments from './TransferDocuments'
import TouchField from './TouchField'
import { QuantityPad } from './QuantityPad'
import { useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { loadTransfers, previewOutputList, sendTransfer, TransferError } from './transferApi'
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
  ERP_NUMBER_NOT_CONFIGURED: '사용 가능한 전표번호 응답이 없습니다.',
  MATERIAL_NOT_FOUND: '입고 창고에 해당 품목이 없습니다. 신규 등록하세요!',
  MULTIPLE_ROUTES_UNSUPPORTED: '서로 다른 이송 경로의 동시 저장을 지원하지 않습니다.',
  WAREHOUSE_TRIGGER_UNVERIFIED: '동일 사업장 창고이동의 재고 반영은 검증 전입니다.',
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

type Entry = 'transfer' | 'transferShip' | 'transferReceive' | 'transferQuick'
const entryActions: Record<Entry, Action[]> = {
  transfer: ['CANCEL_REQUEST'], transferShip: ['SHIP', 'UNDO_SHIP'],
  transferReceive: ['RECEIVE', 'UNDO_RECEIVE'], transferQuick: [],
}
type Props = { entry?: Entry; actor: Actor; onSessionExpired: () => void }

function readRetry(key: string): Command | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as Command : null
  } catch {
    return null
  }
}

export default function Transfer({ entry = 'transfer', actor, onSessionExpired }: Props) {
  const retryKey = 'synthetic-transfer-retry:' + JSON.stringify([actor.terminalId, actor.workerId])
  const [state, setState] = useState<TransferState | null>(null)
  const [busy, setBusy] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [formMessage, setFormMessage] = useState<Message | null>(null)
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState<Command | null>(() => readRetry(retryKey))
  const [request, setRequest] = useState('')
  const [item, setItem] = useState('SKU-X')
  const [quantity, setQuantity] = useState('1')
  const mode = entry === 'transferQuick' ? 'QUICK_TRANSFER' : 'REQUEST'
  const registration = entry === 'transfer' || entry === 'transferQuick'
  const diagnostics = new URLSearchParams(window.location.search).get('demoDiagnostics') === 'transfer'
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
        await sendTransfer(command, diagnostics && injectFailure, signal)
        if (signal.aborted) return
        clearRetry(command.commandId)
        if (command.form || showForm) setFormVersion(v => v + 1)
        if (showDocuments || showForm || command.form) setFormMessage({ text: command.action.startsWith('UNDO_') ? '삭제 되었습니다.' : '처리 되었습니다.' })
        else setNotice(`${actionText[command.action]} 반영 완료`)
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
    if (!state || !canCreate || !request.trim()) return
    if (!window.confirm(`${actionText[mode]} · ${state.source} → ${state.destination} · ${item} ${quantity} · ${request.trim()}`)) return
    void execute({
      request: request.trim(), commandId: crypto.randomUUID(), action: mode,
      draft: { source: state.source, destination: state.destination, lines: [{ number: 10, item, quantity }] },
    }, simulate)
  }

  const retryVisible = retry && state && sameActor(actor, state.actor)
  const pending = state?.pending ?? []
  const pendingRequests = new Set(pending.map(entry => entry.request))
  const showDocuments = !registration && !!state?.master?.configured
  const showForm = registration && !!state?.forms 
  const canCreate = state && !busy && !retry && !pendingRequests.has(request.trim())

  return (
    <section className="logistics-touch" aria-label="공장이송">
      {!showForm && !showDocuments && <h2>공장이송</h2>}
      {!showForm && !showDocuments && <button type="button" disabled={busy} onClick={() => void refresh()}>새로고침</button>}
      {formMessage && <TransferMessage message={formMessage} close={() => setFormMessage(null)} />}
      {notice && <p role="status">{notice}</p>}
      {retryVisible && !pendingRequests.has(retry.request) && (
        <button type="button" disabled={busy} onClick={() => void execute(retry)}>
          {retry.request} 동일 명령 재시도
        </button>
      )}
      {state && (
        <>
          {!showForm && !showDocuments && <p>단말 {state.actor.terminalId} · 작업자 {state.actor.workerId}</p>}
          {registration && !showForm && <form onSubmit={create}>
            <TouchField label="의뢰 ID" required maxLength={64} value={request}
              disabled={busy || !!retry} onValueChange={setRequest} />
            <button type="button" disabled={busy || !!retry || !!request}
              onClick={() => setRequest(crypto.randomUUID())}>의뢰 ID 자동 입력</button>{' '}
            <label>품목 <select value={item} onChange={e => setItem(e.target.value)}>
              <option>SKU-X</option><option>SKU-Y</option>
            </select></label>{' '}
            <label>수량 <input required type="number" min="0.001" step="0.001" value={quantity}
              onChange={e => setQuantity(e.target.value)} /></label>{' '}
            <QuantityPad value={quantity} onApply={setQuantity} disabled={busy || !!retry} />
            <button type="submit" disabled={!canCreate}>{actionText[mode]}</button>
          </form>}
          {diagnostics && <label><input type="checkbox" checked={simulate} disabled={busy}
            onChange={e => setSimulate(e.target.checked)} /> ERP 선반영 후 POP 실패 모의</label>}

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

          {showForm && state.forms ? <TransferEntryForm key={entry} quick={entry === 'transferQuick'} state={state}
            read={apply=>{ void run(async signal=>{
              const next=await loadTransfers(signal)
              if (!signal.aborted) {setState(next);apply(next)}
            }) }} forms={state.forms} version={formVersion} locked={busy || !!retry} ask={setFormMessage} submit={execute} /> : showDocuments && state.master ? <TransferDocuments key={entry} receipt={entry === 'transferReceive'}
            state={state} master={state.master} locked={busy || !!retry} refresh={refresh} notice={text => setFormMessage({ text })} ask={setFormMessage}
            submit={command => execute(command, simulate)} preview={(ids, show) => {
              void run(async signal => {
                const report = await previewOutputList(ids, signal)
                if (!signal.aborted) show(report)
              })
            }} /> : <>
          <h2>{entry === 'transferShip' ? '출고 처리 대상' : entry === 'transferReceive' ? '입고 처리 대상' : '의뢰 현황'}</h2>
          <p>취소 순서 · 입고 취소 → 출고 취소 → 의뢰 취소</p>
          <table>
            <thead><tr><th scope="col">의뢰</th><th scope="col">상태</th><th scope="col">가능 작업</th></tr></thead>
            <tbody>{state.transfers.filter(row => registration || actions[row.status].some(action => entryActions[entry].includes(action))).map(transfer => <tr key={transfer.request}>
              <th scope="row">{transfer.request}</th>
              <td>{statusText[transfer.status]}{pendingRequests.has(transfer.request) && ' · POP 반영 보류'}</td>
              <td>{actions[transfer.status].some(action => entryActions[entry].includes(action)) && <details><summary>{transfer.request} 작업 선택</summary>{actions[transfer.status].filter(action => entryActions[entry].includes(action)).map(action => <button type="button" key={action}
                disabled={busy || !!retry || pendingRequests.has(transfer.request)}
                onClick={() => {
                  if (window.confirm(`${transfer.request} · ${actionText[action]} 처리할까요?`))
                    void execute({ request: transfer.request, commandId: crypto.randomUUID(), action,
                      sourceDocument: transfer.documents[action === 'UNDO_RECEIVE' ? 'RECEIVE' :
                        action === 'UNDO_SHIP' || action === 'RECEIVE' ? 'SHIP' : 'REQUEST'] }, simulate)
                }}>
                {actionText[action]}
              </button>)}</details>}</td>
            </tr>)}</tbody>
          </table></>}
          {((!showForm && !showDocuments) || diagnostics) && <><h2>POP 재고</h2>
          <ul>{state.stock.map(row => <li key={JSON.stringify([row.warehouse, row.item])}>
            {row.warehouse} · {row.item} · {row.quantity}
          </li>)}</ul>
          <h2>ERP 활성 문서</h2>
          <ul>{state.documents.map(({ id, lines }) => <li key={id.revision}>
            {id.request} · {id.kind} · {id.revision} · 상세 {lines.length}건
          </li>)}</ul></>}
        </>
      )}
    </section>
  )
}
