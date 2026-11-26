import { TouchInput } from './TouchFields'
import './adminTouch.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { loadManagement, loadPlanning, PlanningError, previewPlanningOutput, sendPlanning } from './planningApi'
import type { Branch, Command, Filter, Management, OrderKey, OutputArtifact, OutputSelection, PlanKey, SingleCommand, Spec, Status, View, WorkState } from './planningApi'

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
  pane?: 'issue' | 'spec' | 'status'
  actor: { terminal: string; worker: string }
  onSessionExpired: () => void
}

const definitiveRejections = new Set([
  'MALFORMED_COMMAND', 'INVALID_COMMAND', 'TERMINAL_OUT_OF_SCOPE', 'COMMAND_ACTOR_MISMATCH',
  'REQUEST_ID_REUSED', 'STALE_REVISION', 'WAREHOUSE_OUT_OF_SCOPE', 'ORDER_NOT_FOUND',
  'ORDER_QUANTITY_EXCEEDED', 'PLAN_NOT_FOUND', 'PLAN_NOT_EDITABLE', 'SPEC_UNCHANGED',
  'INVALID_MANAGEMENT', 'INVALID_BATCH', 'INVALID_OUTPUT_SELECTION', 'OUTPUT_SCOPE_MISMATCH',
  'MIXED_OUTPUT_BRANCH', 'MIXED_OUTPUT_ORDER',
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

export default function Planning({ pane, actor, onSessionExpired }: Props) {
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
  const [management, setManagement] = useState<Management[]>([])
  const [managementDraft, setManagementDraft] = useState({
    warehouse: '', quality: '', workState: 'FINISHED' as WorkState, thickness: '', width: '', length: '', quantity: '',
  })
  const [batch, setBatch] = useState<SingleCommand[]>([])
  const [printSelection, setPrintSelection] = useState<string[]>([])
  const [printMode, setPrintMode] = useState<OutputSelection['mode']>('SINGLE')
  const [artifact, setArtifact] = useState<OutputArtifact>()
  const [pdfUrl, setPdfUrl] = useState<string>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<Command | null>(() => readRetry(storageKey))
  const inFlight = useRef(false)
  const lifetime = useRef({ epoch: 0 })

  useLayoutEffect(() => {
    const token = lifetime.current
    token.epoch++
    return () => { token.epoch++ }
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

  useEffect(() => {
    if (view?.revision === undefined) return
    const abort = new AbortController()
    void loadManagement(abort.signal).then(result => {
      if (!abort.signal.aborted) setManagement(result.management)
    }).catch(error => {
      if (abort.signal.aborted) return
      if (error instanceof PlanningError && error.status === 401) onSessionExpired()
      else setNotice('관리계획 조회 실패')
    })
    return () => abort.abort()
  }, [view?.revision, onSessionExpired])

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])

  function showArtifact(next: OutputArtifact) {
    const bytes = Uint8Array.from(atob(next.pdf), value => value.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    setArtifact(next)
    setPdfUrl(url)
  }

  function report(error: unknown) {
    if (error instanceof PlanningError && error.status === 401) onSessionExpired()
    else setNotice(error instanceof PlanningError ? messages[error.message] ?? `계획 요청 실패 (${error.status})`
      : '요청 결과를 확인할 수 없습니다. 같은 명령으로 다시 시도해 주세요.')
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    const generation = lifetime.current.epoch
    inFlight.current = true
    setBusy(true)
    try {
      const next = await loadPlanning(filter)
      if (generation !== lifetime.current.epoch) return
      setView(next)
      setNotice('')
    } catch (error) {
      if (generation !== lifetime.current.epoch) return
      report(error)
    } finally {
      if (generation === lifetime.current.epoch) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }

  async function execute(command: Command) {
    if (inFlight.current || !sameActor || !view?.canWrite) return
    try {
      storeRetry(command)
    } catch {
      setNotice('재시도 사본을 저장할 수 없습니다.')
      return
    }
    const generation = lifetime.current.epoch
    inFlight.current = true
    setBusy(true)
    try {
      const result = await sendPlanning(command)
      if (generation !== lifetime.current.epoch) return
      clearRetry(command)
      if (result.plan) setNotice(`${branches[result.plan.branch]} 계획 ${planText(result.plan.key)}을 발행했습니다.`)
      if (result.management) setNotice(result.management.id + ' 관리계획 등록')
      if (result.report && result.pdf) {
        showArtifact({ report: result.report, pdf: result.pdf })
        setNotice('출력 실행 완료')
      }
      if (result.plans) {
        setBatch([])
        setNotice(result.plans.length + '건 일괄 발행')
      }
    } catch (error) {
      if (generation !== lifetime.current.epoch) return
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
      if (generation !== lifetime.current.epoch) return
      setView(next)
    } catch (error) {
      if (generation !== lifetime.current.epoch) return
      report(error)
    } finally {
      if (generation === lifetime.current.epoch) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }

  async function previewOutput(selection: OutputSelection) {
    if (inFlight.current || !sameActor) return
    const generation = lifetime.current.epoch
    inFlight.current = true
    setBusy(true)
    try {
      const result = await previewPlanningOutput(selection)
      if (generation !== lifetime.current.epoch) return
      showArtifact(result)
      setNotice('미리보기 완료')
    } catch (error) {
      if (generation === lifetime.current.epoch) report(error)
    } finally {
      if (generation === lifetime.current.epoch) {
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

  function reverse(event: FormEvent<HTMLFormElement>, enqueue = false) {
    event.preventDefault()
    if (!view || !canEdit || !reverseValid || !order) return
    const command: SingleCommand = { action: 'REVERSE_ISSUE', requestId: crypto.randomUUID(), expectedRevision: view.revision,
      originalOrder: order.key, warehouse: reverseWarehouse, quantity: reverseQty }
    if (enqueue) setBatch(current => [...current, command])
    else void execute(command)
  }

  function change(event: FormEvent<HTMLFormElement>, enqueue = false) {
    event.preventDefault()
    if (!view || !canEdit || !specValid || !plan || !material) return
    const command: SingleCommand = { action: 'CHANGE_SPEC', requestId: crypto.randomUUID(), expectedRevision: view.revision,
      targetPlan: plan.key, sourceMaterial: material.key, warehouse, quantity: qty, inputQuantity: inputQty,
      spec: { quality: plan.spec.quality, workState, ...dimensions } }
    if (enqueue) setBatch(current => [...current, command])
    else void execute(command)
  }

  return (
    <section className="pop-touch-form" aria-labelledby="planning-title">
      <h2 id="planning-title">{pane === 'status' ? '계획 조회' : pane === 'issue' ? '계획 발행' : pane === 'spec' ? '규격 변경 발행' : '생산계획'}</h2>
      {notice && <p role="status">{notice}</p>}
      {retry && sameActor && <button type="button" disabled={busy || !view?.canWrite} onClick={() => void execute(retry)}>동일 명령 재시도</button>}
      {view && <>
        <p>{view.actor.site.site} · {view.actor.site.workCenter} · 단말 {view.actor.terminal}</p>
        {!view.canWrite && <p>현재 단말은 계획현황만 조회할 수 있습니다.</p>}
        {(!pane || pane === 'status') && <>
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
            <thead><tr>{pane === 'status' && <th scope="col">선택</th>}<th scope="col">계획</th><th scope="col">분기 · 상태</th><th scope="col">원 주문</th>
              <th scope="col">원 계획</th><th scope="col">품목 · 규격</th>{pane && <th scope="col">창고</th>}<th scope="col">수량</th></tr></thead>
            <tbody>{view.plans.map(row => <tr key={key(row.key)}>
              {pane === 'status' && <td><input type="checkbox" aria-label={planText(row.key) + ' 선택'} checked={printSelection.includes(key(row.key))}
                onChange={event => setPrintSelection(event.target.checked ? [...printSelection, key(row.key)] : printSelection.filter(id => id !== key(row.key)))} /></td>}
              <th scope="row">{planText(row.key)}</th><td>{branches[row.branch]} · {statuses[row.status]}</td>
              <td>{orderText(row.originalOrder)}</td><td>{row.sourcePlan ? planText(row.sourcePlan) : '—'}</td>
              <td>{row.item} · {specText(row.spec)}</td>
              {pane && <td>{row.warehouse}</td>}<td>{formatQuantity.format(row.quantity)} / 변경 배정 {formatQuantity.format(row.allocated)}</td>
            </tr>)}</tbody>
          </table></div>}

        </>}
        {(!pane || pane === 'issue') && <form onSubmit={event => reverse(event, (event.nativeEvent as SubmitEvent).submitter?.id === "queue-reverse")}>
          <fieldset disabled={!canEdit}>
            <legend>생산계획 역발행</legend>
            {pane === 'issue' && <div className="table-scroll"><table aria-label="발행 대상 수주">
              <thead><tr>{['선택','원 주문','거래처','품목','재질','두께','폭','길이','창고','주문량','발행량','미발행량'].map(col => <th scope="col" key={col}>{col}</th>)}</tr></thead>
              <tbody>{view.orders.map(row => <tr key={key(row.key)}>
                <td><button type="button" aria-pressed={orderId === key(row.key)} onClick={() => setOrderId(key(row.key))}>선택</button></td>
                <td>{orderText(row.key)}</td><td>{row.customer}</td><td>{row.item}</td><td>{row.spec.quality}</td>
                <td>{row.spec.thickness}</td><td>{row.spec.width}</td><td>{row.spec.length}</td><td>{row.warehouse}</td>
                <td>{row.ordered}</td><td>{row.issued}</td><td>{formatQuantity.format(row.ordered - row.issued)}</td>
              </tr>)}</tbody></table></div>}
            <label>원 주문 <select required value={orderId} onChange={e => setOrderId(e.target.value)}>
              <option value="">원 주문 선택</option>{view.orders.map(row => <option key={key(row.key)} value={key(row.key)}>
                {orderText(row.key)} · 미발행 {formatQuantity.format(row.ordered - row.issued)}
              </option>)}
            </select></label>{' '}
            <label>발행 창고 <select required value={reverseWarehouse} onChange={e => setReverseWarehouse(e.target.value)}>
              <option value="">창고 선택</option>{view.warehouses.map(value => <option key={value}>{value}</option>)}
            </select></label>{' '}
            <label>발행 수량 <TouchInput required inputMode="decimal" value={reverseQty} onValue={next => setReverseQty(next)} /></label>{' '}
            {pane === 'issue' && <>
              <button type="button" disabled={!order || Number(reverseQty) < 1} onClick={() => setReverseQty(String(Number(reverseQty) - 1))}>수량 −1</button>
              <button type="button" disabled={!order || Number(reverseQty) + 1 > order.ordered - order.issued} onClick={() => setReverseQty(String(Number(reverseQty) + 1))}>수량 +1</button>
            </>}
            <button disabled={!reverseValid}>역발행</button>
            <button id="queue-reverse" disabled={!reverseValid || batch.some(row => row.action !== "REVERSE_ISSUE")}>일괄 발행 행 추가</button>
            {order && <p>원 규격 {specText(order.spec)}</p>}
          </fieldset>
        </form>}

        {(!pane || pane === 'spec') && <form onSubmit={event => change(event, (event.nativeEvent as SubmitEvent).submitter?.id === "queue-spec")}>
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
            <label>원 자재 수량 <TouchInput required inputMode="decimal" value={inputQty} onValue={next => setInputQty(next)} /></label>{' '}
            <label>변경 계획 수량 <TouchInput required inputMode="decimal" value={qty} onValue={next => setQty(next)} /></label>{' '}
            <label>제품 상태 <select value={workState} onChange={e => setWorkState(e.target.value as WorkState)}>
              <option value="CUT">절단</option><option value="FINISHED">완성</option>
            </select></label>{' '}
            <label>두께 <TouchInput required inputMode="decimal" value={dimensions.thickness}
              onValue={next => setDimensions({ ...dimensions, thickness: next })} /></label>{' '}
            <label>폭 <TouchInput required inputMode="decimal" value={dimensions.width}
              onValue={next => setDimensions({ ...dimensions, width: next })} /></label>{' '}
            <label>길이 <TouchInput required inputMode="decimal" value={dimensions.length}
              onValue={next => setDimensions({ ...dimensions, length: next })} /></label>{' '}
            <button disabled={!specValid}>규격 변경 발행</button>
            <button id="queue-spec" disabled={!specValid || batch.some(row => row.action !== "CHANGE_SPEC")}>일괄 발행 행 추가</button>
            {plan && <p>원 규격 {specText(plan.spec)}</p>}
          </fieldset>
        </form>}
        {(!pane || pane === 'issue') && <form onSubmit={event => {
          event.preventDefault()
          const { warehouse, quantity, ...spec } = managementDraft
          void execute({ action: 'MANAGEMENT', requestId: crypto.randomUUID(), expectedRevision: view.revision,
            warehouse, quantity, spec })
        }}>
          <fieldset disabled={!canEdit}>
            <legend>관리계획 직접입력</legend>
            <label>창고 <select required value={managementDraft.warehouse}
              onChange={event => setManagementDraft({ ...managementDraft, warehouse: event.target.value })}>
              <option value="">창고 선택</option>{view.warehouses.map(value => <option key={value}>{value}</option>)}
            </select></label>
            <label>제품 상태 <select value={managementDraft.workState}
              onChange={event => setManagementDraft({ ...managementDraft, workState: event.target.value as WorkState })}>
              {Object.entries(workStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            {([['quality', '재질'], ['thickness', '두께'], ['width', '폭'], ['length', '길이'], ['quantity', '수량']] as const)
              .map(([field, label]) => <label key={field}>{label} <TouchInput required inputMode={field === 'quality' ? 'text' : 'decimal'} value={managementDraft[field]}
                onValue={next => setManagementDraft({ ...managementDraft, [field]: next })} /></label>)}
            <button>관리계획 적용</button>
          </fieldset>
        </form>}
        {(!pane || pane === 'issue') && management.length > 0 && <ul aria-label="관리계획 목록">
          {management.map(row => <li key={row.id}>{row.id} / {row.warehouse} / {row.item} / {row.quantity}</li>)}
        </ul>}
        {batch.length > 0 && <fieldset disabled={!canEdit}>
          <legend>일괄 발행</legend>
          <ul>{batch.map(row => <li key={row.requestId}>
            {row.action === 'REVERSE_ISSUE' ? orderText(row.originalOrder) : planText(row.targetPlan)} / {row.quantity}
            <button type="button" onClick={() => setBatch(current => current.filter(item => item !== row))}>제거</button>
          </li>)}</ul>
          <button type="button" onClick={() => void execute({ action: 'BATCH', requestId: crypto.randomUUID(),
            expectedRevision: view.revision, rows: batch })}>일괄 발행</button>
        </fieldset>}
        {(!pane || pane === 'status') && <fieldset disabled={busy || !!retry}>
          <legend>계획현황 출력</legend>
          <label>출력 형식 <select value={printMode}
            onChange={event => setPrintMode(event.target.value as OutputSelection['mode'])}>
            <option value="SINGLE">단일</option><option value="MULTIPLE">복수</option>
          </select></label>
          {!pane && <ul>{view.plans.map(row => <li key={key(row.key)}><label>
            <input type="checkbox" checked={printSelection.includes(key(row.key))} onChange={event => {
              const checked = event.target.checked
              const id = key(row.key)
              setPrintSelection(current => checked ? [...current, id] : current.filter(value => value !== id))
            }} />{planText(row.key)} / {orderText(row.originalOrder)}
          </label></li>)}</ul>}
          {(() => {
            const plans = view.plans.filter(row => printSelection.includes(key(row.key))).map(row => row.key)
            const selection = { site: view.actor.site, mode: printMode, plans }
            const disabled = plans.length === 0 || (printMode === 'SINGLE' && plans.length !== 1)
            return <>
              <button type="button" disabled={disabled} onClick={() => void previewOutput(selection)}>
                PDF 미리보기
              </button>
              <button type="button" disabled={disabled || !canEdit} onClick={() => void execute({
                action: 'OUTPUT', requestId: crypto.randomUUID(), expectedRevision: view.revision, selection,
              })}>출력 실행</button>
            </>
          })()}
        </fieldset>}
        {artifact && pdfUrl && <section aria-label="계획 PDF">
          <a href={pdfUrl} target="_blank" rel="noreferrer">PDF 열기</a>
          <ul>{artifact.report.rows.map(row => <li key={key(row.plan)}>
            {planText(row.plan)} / {orderText(row.issuedOrder)} / 출력 {row.printCount}회
          </li>)}</ul>
        </section>}
      </>}
    </section>
  )
}
