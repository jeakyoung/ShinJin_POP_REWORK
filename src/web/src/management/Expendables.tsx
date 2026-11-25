import { useLayoutEffect, useRef, useState } from 'react'
import { SessionExpired } from '../workHistoryApi'
import { issueExpendables, loadExpendables, ManagementError } from './managementApi'
import type { Actor, Selection, StockKey } from './managementApi'

type Result = Awaited<ReturnType<typeof loadExpendables>>
const filters = { materialFlag: '', kind1: '', kind2: '' }
const text: Record<string, string> = {
  STALE_REVISION: '다른 요청이 먼저 반영됐습니다. 최신 재고를 확인하세요.',
  STOCK_EXCEEDED: '선택한 수량의 합계가 현재 재고를 초과합니다.',
  RECENT_REQUEST_NOT_FOUND: '현재 작업장에서 재신청할 수 없는 행입니다.',
  STOCK_NOT_FOUND: '현재 사업장에 없는 재고입니다.',
}
const description = ({ item, lot, warehouse, location }: StockKey) => [item, lot, warehouse, location].join(' / ')
const rowKey = (origin: string, prior: string | null, stock: StockKey) => JSON.stringify([origin, prior, description(stock)])
const validAmount = (value: string) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2_147_483_647

function readPending(key: string) {
  try {
    const body = sessionStorage.getItem(key)
    if (!body) return
    const command = JSON.parse(body)
    if (typeof command?.requestId === 'string' && Array.isArray(command.lines) && command.lines.length
      && Number.isSafeInteger(command.expectedRevision)) return body
  } catch {
    return
  }
}

export default function Expendables({ actor, onSessionExpired }: { actor: Actor; onSessionExpired: () => void }) {
  const key = 'synthetic-expendables-retry:' + JSON.stringify([actor.terminalId, actor.workerId])
  return <ExpendablesScreen key={key} storageKey={key} onSessionExpired={onSessionExpired} />
}

function ExpendablesScreen({ storageKey, onSessionExpired }: { storageKey: string; onSessionExpired: () => void }) {
  const [query, setQuery] = useState(filters)
  const [data, setData] = useState<Result>()
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<string>()
  const [pending, setPending] = useState(() => readPending(storageKey))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController | null>(null)

  useLayoutEffect(() => {
    const request = new AbortController()
    loadExpendables(filters, request.signal)
      .then((result) => { if (!request.signal.aborted) setData(result) })
      .catch((error: unknown) => {
        if (request.signal.aborted) return
        if (error instanceof SessionExpired) onSessionExpired()
        else setNotice('소모품을 조회하지 못했습니다.')
      })
    return () => { request.abort(); active.current?.abort() }
  }, [onSessionExpired])

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    const request = new AbortController()
    active.current = request
    setBusy(true)
    setNotice('')
    try {
      await work(request.signal)
    } catch (error) {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else if (error instanceof ManagementError) setNotice(text[error.message] ?? '출고 신청을 처리하지 못했습니다.')
      else setNotice('서버 응답을 확인하지 못했습니다.')
    } finally {
      active.current = null
      if (!request.signal.aborted) setBusy(false)
    }
  }

  async function refresh(signal: AbortSignal) {
    const current = await loadExpendables(query, signal)
    if (!signal.aborted) {
      setData(current)
      setAmounts({})
    }
  }

  function clearPending(body: string) {
    const current = sessionStorage.getItem(storageKey)
    if (current === body) {
      sessionStorage.removeItem(storageKey)
      setPending(undefined)
    } else {
      setPending(readPending(storageKey))
    }
  }

  function send(body: string) {
    void run(async (signal) => {
      try {
        sessionStorage.setItem(storageKey, body)
      } catch {
        setNotice('출고 요청을 보존할 수 없습니다.')
        return
      }
      setPending(body)
      setConfirm(undefined)
      let receipt
      try {
        receipt = await issueExpendables(body, signal)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof ManagementError && error.status < 500 && error.status !== 408 && error.status !== 429) {
          clearPending(body)
          if (error.status === 409) await refresh(signal)
        }
        throw error
      }
      if (signal.aborted) return
      clearPending(body)
      setData(undefined)
      setNotice('출고 신청이 저장됐습니다. ' + receipt.number)
      await refresh(signal)
    })
  }

  const candidates = data ? [
    ...data[0].rows.map((row) => ({ origin: 'CATALOG' as const, priorRequest: null, stock: row.key, ...row })),
    ...data[1].rows.map((row) => ({ origin: 'RECENT' as const, priorRequest: row.request, ...row })),
  ] : []
  const lines: Selection[] = candidates.flatMap((row) => {
    const { origin, priorRequest, stock } = row
    const quantity = amounts[rowKey(origin, priorRequest, stock)]
    return quantity ? [{ origin, priorRequest, stock, quantity }] : []
  })
  const locked = busy || !!pending || !!confirm
  const canSubmit = !!data && data[0].revision === data[1].revision && lines.length > 0
    && lines.every(({ quantity }) => validAmount(quantity))

  return (
    <section aria-label="합성 소모품">
      <h2>소모품 요청·출고</h2>
      <form onSubmit={(event) => { event.preventDefault(); void run(refresh) }}>
        <label>재료 구분<input value={query.materialFlag} disabled={locked}
          onChange={(event) => setQuery({ ...query, materialFlag: event.target.value })} /></label>
        <label>품목 분류 1<input value={query.kind1} disabled={locked}
          onChange={(event) => setQuery({ ...query, kind1: event.target.value })} /></label>
        <label>품목 분류 2<input value={query.kind2} disabled={locked}
          onChange={(event) => setQuery({ ...query, kind2: event.target.value })} /></label>
        <button type="submit" disabled={locked}>소모품 조회</button>
      </form>
      {data && <p>재고 버전 {data[0].revision}</p>}
      {data && data[0].revision !== data[1].revision && <p>재고가 변경됐습니다. 다시 조회하세요.</p>}
      {(['CATALOG', 'RECENT'] as const).map((origin) => {
        const label = origin === 'CATALOG' ? '소모품 목록' : '신청재고'
        const rows = candidates.filter((row) => row.origin === origin)
        return <section key={origin} aria-label={label}>
          <h3>{label}</h3>
          {data && !rows.length && <p>조건에 맞는 행이 없습니다.</p>}
          {!!rows.length && <div className="table-scroll"><table>
            <thead><tr><th scope="col">품목·LOT·창고·위치</th><th scope="col">원신청</th><th scope="col">가용량</th>
              <th scope="col">신청 수량</th></tr></thead>
            <tbody>{rows.map((row) => {
              const key = rowKey(origin, row.priorRequest, row.stock)
              return <tr key={key}><th scope="row">{row.name} · {description(row.stock)}</th>
                <td>{row.priorRequest ?? '—'}</td><td>{row.available}</td>
                <td><input inputMode="numeric" aria-label={label + ' ' + description(row.stock) + ' 수량'}
                  value={amounts[key] ?? ''} disabled={locked || row.available === 0}
                  onChange={(event) => setAmounts({ ...amounts, [key]: event.target.value })} /></td>
              </tr>
            })}</tbody>
          </table></div>}
        </section>
      })}
      <button type="button" disabled={locked || !canSubmit} onClick={() => {
        if (data && canSubmit) setConfirm(JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: data[0].revision, lines }))
      }}>출고 신청</button>
      {confirm && <div role="group" aria-label="출고 확인">
        <p>선택한 {lines.length}개 행의 출고를 신청하시겠습니까?</p>
        <button type="button" disabled={busy} onClick={() => send(confirm)}>출고 신청 확인</button>
        <button type="button" disabled={busy} onClick={() => setConfirm(undefined)}>돌아가기</button>
      </div>}
      {pending && <button type="button" disabled={busy} onClick={() => send(pending)}>동일 출고 요청 재시도</button>}
      <p role="status">{busy ? '처리 중입니다.' : notice}</p>
      <section aria-label="출고 신청 이력">
        <h3>출고 신청 이력</h3>
        {data && !data[2].length && <p>출고 신청 이력이 없습니다.</p>}
        {!!data?.[2].length && <ul>{data[2].map((receipt) => (
          <li key={receipt.number}>{receipt.number} · {receipt.actor.worker}
            <ul>{receipt.lines.map((row) => (
              <li key={row.movementId}>{description(row.stock)} · {row.quantity}개 · {row.movementId}</li>
            ))}</ul>
          </li>
        ))}</ul>}
      </section>
    </section>
  )
}
