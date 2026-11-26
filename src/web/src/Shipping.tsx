import './logisticsTouch.css'
import ShippingForm from './ShippingForm'
import { useLayoutEffect, useRef, useState } from 'react'
import { bundlePdf, loadBundle, printBundle, loadShipping, loadShippingDocument, loadShippingPdf, sendShipping, ShippingError } from './shippingApi'
import type { Action, Command, BundlePrint, DocumentBundle } from './shippingApi'
import { DocumentPages } from './output/OutputPreview'
import { outputMessage, savePdf } from './output/outputDocument'
import type { Contract } from './output/outputDocument'

const labels: Record<Action, string> = {
  CONFIRM: '출하 확정', CANCEL: '출하 취소', REPRINT: '인쇄',
}
const messages: Record<string, string> = {
  PREVIEW_DEVICE_CHANGED: '프린터 설정이 변경되었습니다. 미리보기를 다시 열어 주세요.',
  PRINTER_UNSET: '거래명세서 프린터가 설정되지 않았습니다.',
  DELIVERY_UNKNOWN: '거래처 발송 설정을 확인할 수 없습니다.',
  PRINT_ERROR: '거래명세서 출력 요청에 실패했습니다.',
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
  const [bundle, setBundle] = useState<{ numbers: string[]; result: DocumentBundle }>()
  const bundleKey = storageKey + ':documents'
  const [pendingBundle, setPendingBundle] = useState<BundlePrint | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(bundleKey) ?? 'null') } catch { return null }
  })
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

  function openDocument(numbers: string[]) {
    if (numbers.length > 1) return runDocument(async signal => {
      const result = await loadBundle(numbers,signal)
      if (!signal.aborted) { setDocument(undefined); setBundle({numbers,result}) }
    })
    const number = numbers[0]
    return runDocument(async (signal) => {
      setDocument(undefined)
      const result = await loadShippingDocument(number, signal)
      if (!signal.aborted) setDocument({ number, result })
    })
  }

  function sendBundle(command: BundlePrint) {
    void runDocument(async signal => {
      sessionStorage.setItem(bundleKey,JSON.stringify(command)); setPendingBundle(command)
      try {
        await printBundle(command,signal)
        if (signal.aborted) return
        sessionStorage.removeItem(bundleKey); setPendingBundle(null); setBundle(undefined); setNotice('인쇄 요청이 전달되었습니다.')
      } catch (e) {
        if (e instanceof ShippingError && e.status < 500 && e.status !== 401) {
          sessionStorage.removeItem(bundleKey); setPendingBundle(null)
        }
        throw e
      }
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

  function execute(command: Command) {
    if (!sameActor) return
    void run(async (signal) => {
      try {
        storePending(command)
      } catch {
        setNotice('재시도 사본을 저장할 수 없습니다.')
        return
      }
      try {
        const updated = await sendShipping(command, signal)
        if (signal.aborted) return
        clearPending(command.requestId)
        if (command.action === 'REPRINT') setDocument(undefined)
        if (command.action === 'CANCEL' && updated.shipment?.number === document?.number) setDocument(undefined)
        const print = updated.print
        const outcome = print?.status === 'SUBMITTED' ? `합성 장치 ${print.device}에 ${print.pages}페이지 전달`
          : print?.status === 'NO_PAPER' ? '종이 출력 대상 없음'
          : print ? messages[print.status] ?? outputMessage(print.status) : ''
        setNotice([labels[command.action], outcome].filter(Boolean).join(' · '))
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof ShippingError && error.status === 401) throw error
        if (error instanceof ShippingError && error.status < 500) clearPending(command.requestId)
        report(error)
      }
      const next = await loadShipping(signal)
      if (signal.aborted) return
      setData(next)
    })
  }

  return (
    <section className="shipping-workspace" aria-label="출하">
      <ShippingForm actor={actor} onSessionExpired={onSessionExpired} onPreview={openDocument}
        disabled={busy || !!pending || documentBusy || !!pendingBundle} />
      {notice && <p role="status" className="ship-feedback" onClick={() => setNotice('')}>{notice}</p>}
      {pending && sameActor && <button className="ship-retry" type="button" disabled={busy} onClick={() => execute(pending)}>동일 요청 재시도</button>}
      {pendingBundle && <button className="ship-retry" disabled={documentBusy} onClick={() => sendBundle(pendingBundle)}>동일 인쇄 요청 재시도</button>}
      {bundle && <section className="synthetic-output" aria-label="출하 PDF 미리보기">
        <h3>출하 PDF · {bundle.numbers.join(', ')}</h3><p>거래명세서 프린터 {bundle.result.device}</p>
        <button disabled={documentBusy} onClick={() => setBundle(undefined)}>닫기</button>
        <button disabled={documentBusy} onClick={() => void runDocument(async signal => {
          const pdf = await bundlePdf(bundle.numbers,signal)
          if (!signal.aborted) savePdf(pdf,'shipping-statements.pdf')
        })}>출하 PDF 다운로드</button>
        <button disabled={documentBusy || !!pendingBundle} onClick={() => sendBundle({numbers:bundle.numbers,
          expected:bundle.result.expected, previewPrinter:bundle.result.device, requestId:crypto.randomUUID()})}>인쇄</button>
        <DocumentPages pages={bundle.result.preview} />
      </section>}
      {document && (
        <section className="synthetic-output" aria-label="출하 PDF 미리보기">
          <h3>출하 PDF {document.number}</h3>
          {document.result.device && <p>거래명세서 프린터 {document.result.device}</p>}
          <button type="button" disabled={busy} onClick={() => setDocument(undefined)}>닫기</button>
          {document.result.status === 'PDF_READY' ? (
            <>
              <button type="button" disabled={documentBusy || busy} onClick={() => downloadDocument(document.number)}>출하 PDF 다운로드</button>
              <button type="button" disabled={busy || documentBusy || !!pending || !sameActor}
                onClick={() => {
                  void loadShipping().then(next => {
                    if (next.terminal !== actor.terminal || next.worker !== actor.worker) return
                    const row = next.rows.find(entry => entry.shipment?.number === document.number)
                    if (row) execute({ action: 'REPRINT', handoffId: row.handoff.id, expectedVersion: row.version,
                      previewPrinter: document.result.device ?? undefined, requestId: crypto.randomUUID() })
                  }).catch(report)
                }}>인쇄</button>
              <DocumentPages pages={document.result.preview} />
            </>
          ) : <p role="status">{outputMessage(document.result.status)}</p>}
        </section>
      )}
      {documentNotice && <p role="status">{documentNotice}</p>}
    </section>
  )
}
