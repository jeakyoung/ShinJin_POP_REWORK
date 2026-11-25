import { useEffect, useRef, useState } from 'react'
import { loadShipping, sendShipping, ShippingError } from './shippingApi'
import type { Action, Command, ShippingRow } from './shippingApi'

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
  const inFlight = useRef(false)
  const sameActor = data?.terminal === actor.terminal && data.worker === actor.worker

  function storePending(command: Command | null) {
    if (command) sessionStorage.setItem(storageKey, JSON.stringify(command))
    else sessionStorage.removeItem(storageKey)
    setPending(command)
  }

  function report(error: unknown) {
    if (error instanceof ShippingError && error.status === 401) {
      onSessionExpired()
      return
    }
    setNotice(error instanceof ShippingError ? messages[error.message] ?? `출하 요청 실패 (${error.status})`
      : '서버 응답을 확인할 수 없습니다. 명령은 같은 키로 다시 보낼 수 있습니다.')
  }

  useEffect(() => {
    const abort = new AbortController()
    loadShipping(abort.signal).then(setData).catch(error => {
      if (abort.signal.aborted) return
      if (error instanceof ShippingError && error.status === 401) onSessionExpired()
      else setNotice(error instanceof ShippingError ? messages[error.message] ?? '출하 조회 실패' : '출하 조회 실패')
    })
    return () => abort.abort()
  }, [onSessionExpired])

  async function refresh() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      setData(await loadShipping())
      setNotice('')
    } catch (error) {
      report(error)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function execute(command: Command) {
    if (inFlight.current || !sameActor) return
    try {
      storePending(command)
    } catch {
      setNotice('재시도 사본을 저장할 수 없습니다.')
      return
    }
    inFlight.current = true
    setBusy(true)
    try {
      await sendShipping(command)
      storePending(null)
      setNotice(`${labels[command.action]} 완료`)
    } catch (error) {
      if (error instanceof ShippingError && error.status < 500 && error.status !== 401) storePending(null)
      report(error)
      if (error instanceof ShippingError && error.status === 401) {
        inFlight.current = false
        setBusy(false)
        return
      }
    }
    try {
      setData(await loadShipping())
    } catch (error) {
      report(error)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
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
              const disabled = busy || !!pending || !sameActor || data.terminal !== row.handoff.shippingTerminal
              return <tr key={row.handoff.id}>
                <th scope="row">{row.handoff.packingRef}</th>
                <td>{row.handoff.lot} · {row.handoff.item}</td><td>{row.handoff.quantity}</td>
                <td>{statuses[row.status]}{row.handoff.deferred && ' · 이월'}</td>
                <td>{row.shipment?.number ?? '—'}</td><td>{row.reprintCount}</td>
                <td>
                  {row.status === 'READY' && <button type="button" disabled={disabled}
                    onClick={() => start(row, 'CONFIRM')}>{labels.CONFIRM}</button>}
                  {row.status === 'SHIPPED' && <>
                    <button type="button" disabled={disabled} onClick={() => start(row, 'CANCEL')}>{labels.CANCEL}</button>{' '}
                    <button type="button" disabled={disabled} onClick={() => start(row, 'REPRINT')}>{labels.REPRINT}</button>
                  </>}
                </td>
              </tr>
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
