import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { loadPlanning, PlanningError, sendPlanning } from './planningApi'
import type { Branch, Command, Filter, OrderKey, PlanKey, Spec, Status, View, WorkState } from './planningApi'

const emptyFilter: Filter = { from: '', to: '', status: '', branch: '' }
const statuses: Record<Status, string> = { PLANNED: '계획', STARTED: '작업 중', COMPLETED: '완료' }
const branches: Record<Branch, string> = { STANDARD: '일반', REVERSE: '역발행', SPEC_CHANGE: '규격 변경' }
const workStates: Record<WorkState, string> = { CUT: '절단', FINISHED: '완성' }
const messages: Record<string, string> = {
  STALE_REVISION: '다른 작업이 반영됐습니다. 최신 계획과 잔량을 확인해 주세요.',
  ORDER_QUANTITY_EXCEEDED: '원 주문의 미발행 수량을 초과했습니다.',
  PLAN_QUANTITY_EXCEEDED: '대상 계획의 남은 수량을 초과했습니다.',
  PLAN_NOT_EDITABLE: '작업 시작 전 계획만 규격을 변경할 수 있습니다.',
  MATERIAL_SPEC_MISMATCH: '대상 계획과 원 자재의 품목·규격을 확인해 주세요.',
  INSUFFICIENT_MATERIAL: '선택한 LOT·위치의 가용량이 부족합니다.',
  SPEC_UNCHANGED: '변경할 규격을 입력해 주세요.',
  TERMINAL_OUT_OF_SCOPE: '현재 단말은 계획을 변경할 수 없습니다.',
  INVALID_DATE_RANGE: '조회 시작일은 종료일보다 늦을 수 없습니다.',
  INVALID_COMMAND: '수량·규격과 참조값을 확인해 주세요.',
}

const formatQuantity = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 })
const key = (value: object) => JSON.stringify(value)
const orderText = (value: OrderKey) => `${value.number} / 이력 ${value.history} / 행 ${value.line}`
const planText = (value: PlanKey) => `${value.date} / ${value.sequence}`
const specText = (value: Spec) => `${value.quality} · ${workStates[value.workState]} · ${value.thickness} × ${value.width} × ${value.length}`
const positive = (value: string) => /^\d{1,6}(\.\d{1,3})?$/.test(value) && Number(value) > 0

type Props = {
  actor: { terminal: string; worker: string }
  onSessionExpired: () => void
}

const definitiveRejections = new Set([
  'MALFORMED_COMMAND', 'INVALID_COMMAND', 'TERMINAL_OUT_OF_SCOPE', 'COMMAND_ACTOR_MISMATCH',
  'REQUEST_ID_REUSED', 'STALE_REVISION', 'WAREHOUSE_OUT_OF_SCOPE', 'ORDER_NOT_FOUND',
  'ORDER_QUANTITY_EXCEEDED', 'PLAN_NOT_FOUND', 'PLAN_NOT_EDITABLE', 'SPEC_UNCHANGED',
  'PLAN_QUANTITY_EXCEEDED', 'MATERIAL_NOT_FOUND', 'MATERIAL_SPEC_MISMATCH', 'INSUFFICIENT_MATERIAL',
])

function readRetry(key: string): Command | null {
  try {
    const stored = sessionStorage.getItem(key)
    return stored ? JSON.parse(stored) as Command : null
  } catch {
    return null
  }
}

export default function Planning({ actor, onSessionExpired }: Props) {
  const storageKey = 'synthetic-planning-retry:' + JSON.stringify([actor.terminal, actor.worker])
  const [view, setView] = useState<View>()
  const [filter, setFilter] = useState<Filter>(emptyFilter)
  const [orderId, setOrderId] = useState('')
  const [planId, setPlanId] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [reverseWarehouse, setReverseWarehouse] = useState('')
  const [reverseQty, setReverseQty] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [qty, setQty] = useState('')
  const [inputQty, setInputQty] = useState('')
  const [dimensions, setDimensions] = useState({ thickness: '', width: '', length: '' })
  const [workState, setWorkState] = useState<WorkState>('FINISHED')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<Command | null>(() => readRetry(storageKey))
  const inFlight = useRef(false)
  const lifetime = useRef(0)

  useLayoutEffect(() => {
    lifetime.current++
    return () => { lifetime.current++ }
  }, [storageKey])
  const sameActor = view?.actor.terminal === actor.terminal && view.actor.worker === actor.worker

  function storeRetry(command: Command) {
    sessionStorage.setItem(storageKey, JSON.stringify(command))
    setRetry(command)
  }

  function clearRetry(command: Command) {
    if (readRetry(storageKey)?.requestId !== command.requestId) return
    sessionStorage.removeItem(storageKey)
    setRetry(current => current?.requestId === command.requestId ? null : current)
  }

  useEffect(() => {
    const abort = new AbortController()
    loadPlanning(emptyFilter, abort.signal).then(next => { if (!abort.signal.aborted) setView(next) }).catch(error => {
      if (abort.signal.aborted) return
      if (error instanceof PlanningError && error.status === 401) onSessionExpired()
      else setNotice('계획현황을 불러오지 못했습니다.')
    })
    return () => abort.abort()
  }, [onSessionExpired])

  function report(error: unknown) {
    if (error instanceof PlanningError && error.status === 401) onSessionExpired()
    else setNotice(error instanceof PlanningError ? messages[error.message] ?? `계획 요청 실패 (${error.status})`
      : '요청 결과를 확인할 수 없습니다. 같은 명령으로 다시 시도해 주세요.')
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    const generation = lifetime.current
    inFlight.current = true
    setBusy(true)
    try {
      const next = await loadPlanning(filter)
      if (generation !== lifetime.current) return
      setView(next)
      setNotice('')
    } catch (error) {
      if (generation !== lifetime.current) return
      report(error)
    } finally {
      if (generation === lifetime.current) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }

  async function execute(command: Command) {
    if (inFlight.current || !sameActor) return
    try {
      storeRetry(command)
    } catch {
      setNotice('재시도 사본을 저장할 수 없습니다.')
      return
    }
    const generation = lifetime.current
    inFlight.current = true
    setBusy(true)
    try {
      const result = await sendPlanning(command)
      if (generation !== lifetime.current) return
      clearRetry(command)
      setNotice(`${branches[result.plan.branch]} 계획 ${planText(result.plan.key)}을 발행했습니다.`)
    } catch (error) {
      if (generation !== lifetime.current) return
      if (error instanceof PlanningError && error.status >= 400 && error.status < 500
          && definitiveRejections.has(error.message)) clearRetry(command)
      report(error)
      if (error instanceof PlanningError && error.status === 401) {
        setBusy(false)
        inFlight.current = false
        return
      }
    }
    try {
      const next = await loadPlanning(filter)
      if (generation !== lifetime.current) return
      setView(next)
    } catch (error) {
      if (generation !== lifetime.current) return
      report(error)
    } finally {
      if (generation === lifetime.current) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }

  const canEdit = !!view?.canWrite && sameActor && !busy && !retry
  const order = view?.orders.find(row => key(row.key) === orderId)
  const plans = view?.plans.filter(row => row.status === 'PLANNED' && row.quantity > row.allocated) ?? []
  const plan = plans.find(row => key(row.key) === planId)
  const materials = view?.materials.filter(row => plan && row.available > 0 && row.key.item === plan.item
    && specText(row.spec) === specText(plan.spec)) ?? []
  const material = materials.find(row => key(row.key) === materialId)
  const reverseValid = !!order && !!reverseWarehouse && positive(reverseQty) && Number(reverseQty) >= 1
  const specValid = !!plan && !!material && !!warehouse && positive(qty) && positive(inputQty)
    && positive(dimensions.thickness) && positive(dimensions.width) && positive(dimensions.length)

  function reverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!view || !canEdit || !reverseValid || !order) return
    void execute({ action: 'REVERSE_ISSUE', requestId: crypto.randomUUID(), expectedRevision: view.revision,
      originalOrder: order.key, warehouse: reverseWarehouse, quantity: reverseQty })
  }

  function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!view || !canEdit || !specValid || !plan || !material) return
    void execute({ action: 'CHANGE_SPEC', requestId: crypto.randomUUID(), expectedRevision: view.revision,
      targetPlan: plan.key, sourceMaterial: material.key, warehouse, quantity: qty, inputQuantity: inputQty,
      spec: { quality: plan.spec.quality, workState, ...dimensions } })
  }

  return (
    <section aria-labelledby="planning-title">
      <h2 id="planning-title">생산계획</h2>
      {notice && <p role="status">{notice}</p>}
      {retry && sameActor && <button type="button" disabled={busy} onClick={() => void execute(retry)}>동일 명령 재시도</button>}
      {view && <>
        <p>{view.actor.site.site} · {view.actor.site.workCenter} · 단말 {view.actor.terminal}</p>
        {!view.canWrite && <p>현재 단말은 계획현황만 조회할 수 있습니다.</p>}
        <h3>계획현황</h3>
        <form onSubmit={search}>
          <label>시작일 <input type="date" value={filter.from} onChange={e => setFilter({ ...filter, from: e.target.value })} /></label>{' '}
          <label>종료일 <input type="date" value={filter.to} onChange={e => setFilter({ ...filter, to: e.target.value })} /></label>{' '}
          <label>상태 <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value as Filter['status'] })}>
            <option value="">전체</option>{Object.entries(statuses).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select></label>{' '}
          <label>발행 분기 <select value={filter.branch} onChange={e => setFilter({ ...filter, branch: e.target.value as Filter['branch'] })}>
            <option value="">전체</option>{Object.entries(branches).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select></label>{' '}
          <button disabled={busy}>계획 조회</button>
        </form>
        {view.plans.length === 0 ? <p>조건에 맞는 계획이 없습니다.</p> :
          <div className="table-scroll"><table>
            <thead><tr><th scope="col">계획</th><th scope="col">분기 · 상태</th><th scope="col">원 주문</th>
              <th scope="col">원 계획</th><th scope="col">품목 · 규격</th><th scope="col">수량</th></tr></thead>
            <tbody>{view.plans.map(row => <tr key={key(row.key)}>
              <th scope="row">{planText(row.key)}</th><td>{branches[row.branch]} · {statuses[row.status]}</td>
              <td>{orderText(row.originalOrder)}</td><td>{row.sourcePlan ? planText(row.sourcePlan) : '—'}</td>
              <td>{row.item} · {specText(row.spec)}</td>
              <td>{formatQuantity.format(row.quantity)} / 변경 배정 {formatQuantity.format(row.allocated)}</td>
            </tr>)}</tbody>
          </table></div>}

        <form onSubmit={reverse}>
          <fieldset disabled={!canEdit}>
            <legend>생산계획 역발행</legend>
            <label>원 주문 <select required value={orderId} onChange={e => setOrderId(e.target.value)}>
              <option value="">원 주문 선택</option>{view.orders.map(row => <option key={key(row.key)} value={key(row.key)}>
                {orderText(row.key)} · 미발행 {formatQuantity.format(row.ordered - row.issued)}
              </option>)}
            </select></label>{' '}
            <label>발행 창고 <select required value={reverseWarehouse} onChange={e => setReverseWarehouse(e.target.value)}>
              <option value="">창고 선택</option>{view.warehouses.map(value => <option key={value}>{value}</option>)}
            </select></label>{' '}
            <label>발행 수량 <input required inputMode="decimal" value={reverseQty} onChange={e => setReverseQty(e.target.value)} /></label>{' '}
            <button disabled={!reverseValid}>역발행</button>
            {order && <p>원 규격 {specText(order.spec)}</p>}
          </fieldset>
        </form>

        <form onSubmit={change}>
          <fieldset disabled={!canEdit}>
            <legend>제품규격 변경 발행</legend>
            <label>대상 계획 <select required value={planId} onChange={e => {
              setPlanId(e.target.value)
              setMaterialId('')
            }}>
              <option value="">계획 선택</option>{plans.map(row => <option key={key(row.key)} value={key(row.key)}>
                {planText(row.key)} · {row.item} · 잔량 {formatQuantity.format(row.quantity - row.allocated)}
              </option>)}
            </select></label>{' '}
            <label>원 자재 LOT <select required value={materialId} onChange={e => setMaterialId(e.target.value)}>
              <option value="">LOT·위치 선택</option>{materials.map(row => <option key={key(row.key)} value={key(row.key)}>
                {row.key.lot} · {row.key.warehouse}/{row.key.position} · {row.available}
              </option>)}
            </select></label>{' '}
            <label>목적 창고 <select required value={warehouse} onChange={e => setWarehouse(e.target.value)}>
              <option value="">창고 선택</option>{view.warehouses.map(value => <option key={value}>{value}</option>)}
            </select></label>{' '}
            <label>원 자재 수량 <input required inputMode="decimal" value={inputQty} onChange={e => setInputQty(e.target.value)} /></label>{' '}
            <label>변경 계획 수량 <input required inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /></label>{' '}
            <label>제품 상태 <select value={workState} onChange={e => setWorkState(e.target.value as WorkState)}>
              <option value="CUT">절단</option><option value="FINISHED">완성</option>
            </select></label>{' '}
            <label>두께 <input required inputMode="decimal" value={dimensions.thickness}
              onChange={e => setDimensions({ ...dimensions, thickness: e.target.value })} /></label>{' '}
            <label>폭 <input required inputMode="decimal" value={dimensions.width}
              onChange={e => setDimensions({ ...dimensions, width: e.target.value })} /></label>{' '}
            <label>길이 <input required inputMode="decimal" value={dimensions.length}
              onChange={e => setDimensions({ ...dimensions, length: e.target.value })} /></label>{' '}
            <button disabled={!specValid}>규격 변경 발행</button>
            {plan && <p>원 규격 {specText(plan.spec)}</p>}
          </fieldset>
        </form>
      </>}
    </section>
  )
}
