import { useLayoutEffect, useRef, useState } from 'react'
import { loadShipping, loadShippingDocument, loadShippingPdf, sendShipping, ShippingError } from './shippingApi'
import type { Action, Command, ShippingRow } from './shippingApi'
import { DocumentPages } from './output/OutputPreview'
import { outputMessage, savePdf } from './output/outputDocument'
import type { Contract } from './output/outputDocument'

const labels: Record<Action, string> = {
  CONFIRM: '출하 확정', CANCEL: '출하 취소', REPRINT: '재출력 기록',
}
const statuses: Record<ShippingRow['status'], string> = {
  READY: '출하 대기', SHIPPED: '출하 확정', CANCELLED: '출하 취소',
}
const messages: Record<string, string> = {
  STALE_VERSION: '다른 작업이 반영되었습니다. 최신 상태를 확인해 주세요.',
  TERMINAL_MISMATCH: '지정된 출하 단말에서 실행해 주세요.',
  SITE_MISMATCH: '다른 사업장의 인계입니다.',
  SHIPMENT_ALREADY_RECORDED: '이 포장 인계에는 이미 출하 기록이 있습니다.',
  SHIPMENT_NOT_ACTIVE: '확정된 출하만 취소하거나 재출력할 수 있습니다.',
  COMMAND_ACTOR_MISMATCH: '기존 명령의 작업자·단말이 일치하지 않습니다.',
  PACKING_SOURCE_UNAVAILABLE: '포장 인계를 읽을 수 없습니다.',
}

type Props = {
  actor: { terminal: string; worker: string }
  onSessionExpired: () => void
}

function readPending(key: string): Command | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as Command : null
  } catch {
    return null
  }
}

export default function Shipping({ actor, onSessionExpired }: Props) {
  const storageKey = 'synthetic-shipping-retry:' + JSON.stringify([actor.terminal, actor.worker])
  const [data, setData] = useState<Awaited<ReturnType<typeof loadShipping>>>()
  const [pending, setPending] = useState<Command | null>(() => readPending(storageKey))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [document, setDocument] = useState<{ number: string; result: Contract }>()
  const [documentNotice, setDocumentNotice] = useState('')
  const [documentBusy, setDocumentBusy] = useState(false)
  const documentRequest = useRef<AbortController | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const sameActor = data?.terminal === actor.terminal && data.worker === actor.worker

  function storePending(command: Command) {
    sessionStorage.setItem(storageKey, JSON.stringify(command))
    setPending(command)
  }

  function clearPending(requestId: string) {
    const current = readPending(storageKey)
    if (current?.requestId === requestId) {
      sessionStorage.removeItem(storageKey)
      setPending(null)
    } else {
      setPending(current)
    }
  }

  function report(error: unknown) {
    if (error instanceof ShippingError && error.status === 401) {
      onSessionExpired()
      return
    }
    setNotice(error instanceof ShippingError ? messages[error.message] ?? `출하 요청 실패 (${error.status})`
      : '서버 응답을 확인할 수 없습니다. 명령은 같은 키로 다시 보낼 수 있습니다.')
  }

  useLayoutEffect(() => {
    const abort = new AbortController()
    loadShipping(abort.signal).then((next) => {
      if (!abort.signal.aborted) setData(next)
    }).catch(error => {
      if (abort.signal.aborted) return
      if (error instanceof ShippingError && error.status === 401) onSessionExpired()
      else setNotice(error instanceof ShippingError ? messages[error.message] ?? '출하 조회 실패' : '출하 조회 실패')
    })
    return () => abort.abort()
  }, [onSessionExpired])

  useLayoutEffect(() => () => {
    activeRequest.current?.abort()
    documentRequest.current?.abort()
  }, [])

  async function runDocument(task: (signal: AbortSignal) => Promise<void>) {
    if (documentRequest.current) return
    const request = new AbortController()
    documentRequest.current = request
    setDocumentBusy(true)
    setDocumentNotice('')
    try {
      await task(request.signal)
    } catch (error) {
      if (request.signal.aborted) return
      if (error instanceof ShippingError && error.status === 401) onSessionExpired()
      else setDocumentNotice(error instanceof ShippingError
        ? messages[error.message] ?? outputMessage(error.message)
        : '출하 PDF를 불러오지 못했습니다.')
    } finally {
      documentRequest.current = null
      if (!request.signal.aborted) setDocumentBusy(false)
    }
  }

  function openDocument(number: string) {
    return runDocument(async (signal) => {
      setDocument(undefined)
      const result = await loadShippingDocument(number, signal)
      if (!signal.aborted) setDocument({ number, result })
    })
  }

  function downloadDocument(number: string) {
    void runDocument(async (signal) => {
      const pdf = await loadShippingPdf(number, signal)
      if (!signal.aborted) savePdf(pdf, number + '.pdf')
    })
  }

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (activeRequest.current) return
    const request = new AbortController()
    activeRequest.current = request
    setBusy(true)
    try {
      await task(request.signal)
    } catch (error) {
      if (!request.signal.aborted) report(error)
    } finally {
      activeRequest.current = null
      if (!request.signal.aborted) setBusy(false)
    }
  }

  function refresh() {
    void run(async (signal) => {
      const next = await loadShipping(signal)
      if (signal.aborted) return
      setData(next)
      setNotice('')
    })
  }

  function execute(command: Command) {
    if (!sameActor) return
    void run(async (signal) => {
      try {
        storePending(command)
      } catch {
        setNotice('재시도 사본을 저장할 수 없습니다.')
        return
      }
      let reprintNumber: string | undefined
      try {
        const updated = await sendShipping(command, signal)
        if (signal.aborted) return
        clearPending(command.requestId)
        if (command.action === 'REPRINT') reprintNumber = updated.shipment?.number
        if (command.action === 'CANCEL' && updated.shipment?.number === document?.number) setDocument(undefined)
        setNotice(`${labels[command.action]} 완료`)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof ShippingError && error.status === 401) throw error
        if (error instanceof ShippingError && error.status < 500) clearPending(command.requestId)
        report(error)
      }
      const next = await loadShipping(signal)
      if (signal.aborted) return
      setData(next)
      if (reprintNumber) await openDocument(reprintNumber)
    })
  }

  function start(row: ShippingRow, action: Action) {
    if (action === 'CANCEL' && !window.confirm(`${row.shipment?.number ?? ''} 출하를 취소하시겠습니까?`)) return
    void execute({ action, handoffId: row.handoff.id, expectedVersion: row.version, requestId: crypto.randomUUID() })
  }

  return (
    <section aria-labelledby="shipping-title">
      <h2 id="shipping-title">출하</h2>
      <button type="button" disabled={busy} onClick={() => void refresh()}>포장 인계 새로고침</button>
      {notice && <p role="status">{notice}</p>}
      {pending && sameActor && <button type="button" disabled={busy} onClick={() => void execute(pending)}>동일 요청 재시도</button>}
      {data && <p>단말 {data.terminal} · 작업자 {data.worker}</p>}
      {data?.rows.length === 0 && <p>출하 가능한 포장 인계가 없습니다.</p>}
      {data && data.rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead><tr>
              <th scope="col">원포장 계획</th><th scope="col">LOT · 품목</th><th scope="col">수량</th>
              <th scope="col">상태</th><th scope="col">출하 전표</th><th scope="col">재출력 횟수</th>
              <th scope="col">작업</th>
            </tr></thead>
            <tbody>{data.rows.map(row => {
              const disabled = busy || documentBusy || !!pending || !sameActor || data.terminal !== row.handoff.shippingTerminal
              return <tr key={row.handoff.id}>
                <th scope="row">{row.handoff.packingRef}</th>
                <td>{row.handoff.lot} · {row.handoff.item}</td><td>{row.handoff.quantity}</td>
                <td>{statuses[row.status]}{row.handoff.deferred && ' · 이월'}</td>
                <td>{row.shipment?.number ?? '—'}</td><td>{row.reprintCount}</td>
                <td>
                  {row.status === 'READY' && <button type="button" disabled={disabled}
                    onClick={() => start(row, 'CONFIRM')}>{labels.CONFIRM}</button>}
                  {row.status === 'SHIPPED' && <>
                    <button type="button" disabled={disabled || !row.shipment}
                      onClick={() => { if (row.shipment) void openDocument(row.shipment.number) }}>PDF 미리보기</button>{' '}
                    <button type="button" disabled={disabled} onClick={() => start(row, 'CANCEL')}>{labels.CANCEL}</button>{' '}
                    <button type="button" disabled={disabled} onClick={() => start(row, 'REPRINT')}>{labels.REPRINT}</button>
                  </>}
                </td>
              </tr>
            })}</tbody>
          </table>
        </div>
      )}
      {document && (
        <section className="synthetic-output" aria-label="출하 PDF 미리보기">
          <h3>출하 PDF {document.number}</h3>
          {document.result.status === 'PDF_READY' ? (
            <>
              <button type="button" disabled={documentBusy || busy} onClick={() => downloadDocument(document.number)}>출하 PDF 다운로드</button>
              <DocumentPages pages={document.result.preview} />
            </>
          ) : <p role="status">{outputMessage(document.result.status)}</p>}
        </section>
      )}
      {documentNotice && <p role="status">{documentNotice}</p>}
    </section>
  )
}
