import { useEffect, useRef, useState } from 'react'
import { SessionExpired } from './workHistoryApi'

type Option = { key: string; fgUse2: string; item: string; cutLot: string; orderQuantity: number }
type Material = { lot: string; warehouse: string; item: string; qty: number }
type State = 'CUT_READY' | 'PACK1_ACTIVE' | 'DRAW_READY' | 'DRAW_ACTIVE' | 'PACK2_READY' | 'PACK2_ACTIVE' | 'SHIP_READY'
type Detail = {
  state: State; plateFlag: string | null; version: number; ownerTerminalId: string | null; bypassedPack1: boolean
  shipPlanId: string | null; shipment: { material: Material; deferred: boolean } | null
}
type Scan = { accepted: boolean; scanToken: string; materials: Material[] }
type Action = 'PACK1_START' | 'PACK1_FINISH' | 'DRAW_START' | 'DRAW_FINISH' | 'PACK2_START' | 'PACK2_FINISH'
type Input = { action: Action; lot?: string; qty?: number; goodQty?: number; scanToken?: string; inputs?: Material[] }
type Command = Input & { requestId: string; expectedVersion: number }

const api = '/api/drawing-008'
const url = (key: string) => api + '/plans/' + encodeURIComponent(key)
const states: Record<State, string> = {
  CUT_READY: '절단 완료', PACK1_ACTIVE: '1차 포장 중', DRAW_READY: '도면가공 대기', DRAW_ACTIVE: '도면가공 중',
  PACK2_READY: '2차 포장 대기', PACK2_ACTIVE: '2차 포장 중', SHIP_READY: '출하 준비',
}
const messages: Record<string, string> = {
  STALE_VERSION: '다른 요청이 먼저 반영되었습니다. 최신 상태를 표시합니다.',
  TERMINAL_MISMATCH: '다른 단말에서 진행 중인 단계입니다.',
  PACK_QTY_MUST_MATCH_REMAINING: '2차 포장에는 남은 산출량 전부를 입력하세요.',
  PACK_QTY_EXCEEDED: '포장 수량이 가용량을 초과합니다.',
  ORDER_NOT_DRAWING: '도면가공 대상 수주가 아닙니다.',
  ALREADY_PACKED: '이미 출하 인계가 생성됐습니다.',
  INSUFFICIENT_INPUT: '투입 수량이 재고를 초과합니다.',
  SCAN_TOKEN_INVALID: '스캔이 만료되었습니다. 다시 스캔하세요.',
}
class DrawingError extends Error {}

async function request<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch(path, {
    signal, cache: 'no-store', method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 401) throw new SessionExpired()
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new DrawingError(data?.error ?? 'HTTP_' + response.status)
  }
  return response.json()
}

export default function DrawingWork({ terminalId, onSessionExpired }: { terminalId: string; onSessionExpired: () => void }) {
  const [plans, setPlans] = useState<Option[]>([])
  const [active, setActive] = useState<string[]>([])
  const [selected, setSelected] = useState<Option>()
  const [detail, setDetail] = useState<Detail>()
  const [scan, setScan] = useState<Scan>()
  const [confirm, setConfirm] = useState(false)
  const [qty, setQty] = useState('')
  const [materials, setMaterials] = useState<Material[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<Command>()
  const current = useRef<AbortController | null>(null)

  function showError(error: unknown) {
    if (error instanceof SessionExpired) onSessionExpired()
    else if (error instanceof DrawingError) setNotice(messages[error.message] ?? '요청을 처리할 수 없습니다. 입력과 작업 상태를 확인하세요.')
    else setNotice('서버 응답을 확인하지 못했습니다.')
  }

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([request<Option[]>(api + '/plans', controller.signal), request<string[]>(api + '/active', controller.signal)])
      .then(([options, running]) => { setPlans(options); setActive(running) })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof SessionExpired) onSessionExpired()
        else setNotice('도면가공 계획을 조회하지 못했습니다.')
      })
    return () => { controller.abort(); current.current?.abort() }
  }, [onSessionExpired])

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (current.current) return
    const controller = new AbortController()
    current.current = controller
    setBusy(true)
    setNotice('')
    try { await task(controller.signal) } catch (error) {
      if (!controller.signal.aborted) showError(error)
    } finally {
      current.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function load(option: Option) {
    await run(async (signal) => {
      setSelected(option)
      setDetail(undefined)
      setScan(undefined)
      setConfirm(false)
      setRetry(undefined)
      setQty('')
      const [fresh, running] = await Promise.all([
        request<Detail>(url(option.key), signal), request<string[]>(api + '/active', signal),
      ])
      setDetail(fresh)
      setActive(running)
      setQty(fresh.state === 'PACK1_ACTIVE' || fresh.state === 'DRAW_ACTIVE' ? String(option.orderQuantity) : '')
    })
  }

  async function scanPlan(option: Option, decision: 'PROBE' | 'DECLINE' | 'ACCEPT') {
    await run(async (signal) => {
      setScan(undefined)
      setConfirm(false)
      try {
        const result = await request<Scan>(url(option.key) + '/scan', signal, { decision })
        if (result.accepted) {
          setScan(result)
          setMaterials(result.materials.length ? result.materials : [
            { lot: option.cutLot, warehouse: '011', item: option.item, qty: 1 },
          ])
        } else setNotice('1차 포장 생략을 취소했습니다.')
      } catch (error) {
        if (error instanceof DrawingError && error.message === 'PACK1_CONFIRM_REQUIRED') setConfirm(true)
        else throw error
      }
    })
  }

  async function send(option: Option, command: Command) {
    await run(async (signal) => {
      let fresh: Detail
      try {
        fresh = await request<Detail>(url(option.key) + '/commands', signal, command)
      } catch (error) {
        if (signal.aborted) return
        if (!(error instanceof DrawingError) && !(error instanceof SessionExpired)) {
          setRetry(command)
          throw error
        }
        setRetry(undefined)
        if (error instanceof DrawingError && ['STALE_VERSION', 'TERMINAL_MISMATCH', 'ALREADY_PACKED', 'SCAN_TOKEN_INVALID'].includes(error.message)) {
          setScan(undefined)
          setConfirm(false)
          const latest = await request<Detail>(url(option.key), signal)
          setDetail(latest)
          setQty(latest.state === 'PACK1_ACTIVE' || latest.state === 'DRAW_ACTIVE' ? String(option.orderQuantity) : '')
          setActive(await request<string[]>(api + '/active', signal))
        }
        throw error
      }
      setRetry(undefined)
      setDetail(fresh)
      setScan(undefined)
      setConfirm(false)
      setQty(fresh.state === 'PACK1_ACTIVE' || fresh.state === 'DRAW_ACTIVE' ? String(option.orderQuantity) : '')
      setActive(await request<string[]>(api + '/active', signal))
    })
  }

  function command(action: Input) {
    if (!selected || !detail) return
    void send(selected, { ...action, expectedVersion: detail.version, requestId: crypto.randomUUID() })
  }

  const locallyOwned = !detail?.ownerTerminalId || detail.ownerTerminalId === terminalId
  const disabled = busy || !locallyOwned || !!retry
  const validQty = Number(qty) > 0 && Number.isFinite(Number(qty))
  return (
    <section aria-labelledby="drawing-title">
      <h2 id="drawing-title">도면가공·포장 계획</h2>
      <p>008 진행 목록 {active.length ? active.join(', ') : '없음'}</p>
      <label>계획 선택
        <select disabled={busy || !!retry} value={selected?.key ?? ''} onChange={(event) => {
          const option = plans.find((plan) => plan.key === event.target.value)
          if (option) void load(option)
        }}>
          <option value="" disabled>계획 선택</option>
          {plans.map((plan) => <option key={plan.key} value={plan.key}>{plan.key} · {plan.item} · {plan.fgUse2}</option>)}
        </select>
      </label>
      {selected && <button type="button" disabled={busy || !!retry} onClick={() => void load(selected)}>계획 새로 조회</button>}
      {selected && detail && (
        <>
          <p>{states[detail.state]} · 버전 {detail.version}{detail.bypassedPack1 && ' · 1차 포장 생략'}</p>
          {!locallyOwned && <p>진행 단말 {detail.ownerTerminalId}</p>}
          {detail.state === 'CUT_READY' && selected.fgUse2 !== '001' &&
            <button type="button" disabled={disabled} onClick={() => command({ action: 'PACK1_START' })}>1차 포장 시작</button>}
          {(detail.state === 'CUT_READY' || detail.state === 'DRAW_READY') &&
            <button type="button" disabled={disabled || confirm} onClick={() => void scanPlan(selected, 'PROBE')}>008 스캔</button>}
          {confirm && (
            <div>
              <p>1차 포장이 완료되지 않았습니다. 생략하고 도면가공하시겠습니까?</p>
              <button type="button" disabled={disabled} onClick={() => void scanPlan(selected, 'DECLINE')}>생략 거절</button>
              <button type="button" disabled={disabled} onClick={() => void scanPlan(selected, 'ACCEPT')}>생략 확인</button>
            </div>
          )}
          {scan && (
            <div>
              <h3>008 투입 자재</h3>
              {scan.materials.length === 0 && <p>자동 추천 자재가 없습니다. 절단 LOT 수량을 확인하세요.</p>}
              {materials.map((row, index) => (
                <label key={row.lot + '/' + row.warehouse}>{row.lot} · {row.warehouse} · {row.item}
                  <input type="number" min="0.001" step="0.001" value={row.qty || ''} disabled={disabled}
                    onChange={(event) => {
                      const amount = Number(event.target.value)
                      setMaterials((list) => list.map((line, i) => i === index ? { ...line, qty: amount } : line))
                    }} />
                </label>
              ))}
              <button type="button" disabled={disabled || materials.some((row) => !(row.qty > 0))}
                onClick={() => command({ action: 'DRAW_START', scanToken: scan.scanToken, inputs: materials })}>008 시작</button>
            </div>
          )}
          {(detail.state === 'PACK1_ACTIVE' || detail.state === 'DRAW_ACTIVE' || detail.state === 'PACK2_READY' || detail.state === 'PACK2_ACTIVE') && (
            <label>{detail.state === 'DRAW_ACTIVE' ? '008 양품 수량' : '포장 수량'}
              <input type="number" min="0.001" step="0.001" value={qty} disabled={disabled}
                placeholder={detail.state.startsWith('PACK2') ? '비우면 남은 산출량 전부' : undefined}
                onChange={(event) => setQty(event.target.value)} />
            </label>
          )}
          {detail.state === 'PACK1_ACTIVE' &&
            <button type="button" disabled={disabled || !validQty}
              onClick={() => command({ action: 'PACK1_FINISH', lot: selected.cutLot, qty: Number(qty) })}>1차 포장 완료</button>}
          {detail.state === 'DRAW_ACTIVE' &&
            <button type="button" disabled={disabled || !validQty}
              onClick={() => command({ action: 'DRAW_FINISH', goodQty: Number(qty) })}>008 완료</button>}
          {detail.state === 'PACK2_READY' &&
            <button type="button" disabled={disabled} onClick={() => command({ action: 'PACK2_START' })}>2차 포장 시작</button>}
          {(detail.state === 'PACK2_READY' || detail.state === 'PACK2_ACTIVE') &&
            <button type="button" disabled={disabled || (!!qty && !validQty)}
              onClick={() => command({ action: 'PACK2_FINISH', qty: qty ? Number(qty) : undefined })}>2차 포장 완료</button>}
          {detail.shipment && <p>출하 인계 {detail.shipPlanId} · {detail.shipment.material.lot} · {detail.shipment.material.qty}
            {detail.shipment.deferred && ' · 이월'}</p>}
          {retry && <button type="button" disabled={busy} onClick={() => void send(selected, retry)}>같은 요청 다시 보내기</button>}
        </>
      )}
      <p role="status">{busy ? '처리 중입니다.' : notice}</p>
    </section>
  )
}
