import { pendingDrawing, submitDrawing } from './drawingPending'
import type { DrawingScope, PendingDrawing } from './drawingPending'
import TouchField from './TouchField'
import './floor-work.css'
import FloorConfirm from './FloorConfirm'
import DrawingPauseButton from './DrawingPauseButton'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { drawingRequest, DrawingError, drawingApi, drawingStates } from './drawingApi'
import type { DrawingMaterial, DrawingDetail } from './drawingApi'
import { SessionExpired } from './workHistoryApi'

type Member = {
  key: string; snapshot: DrawingDetail; drawingInputs: DrawingMaterial[]; autoRemnant: DrawingMaterial | null
  result: { drawingDailyId: string; movementId: string; movementLine: number } | null
}
type Candidate = { material: DrawingMaterial; eligiblePlans: string[] }
type Group = { id: string; members: Member[]; candidates: Candidate[] }
type Line = { key: string; expectedVersion: number; inputs?: DrawingMaterial[]; goodQty?: number; confirmSkip?: boolean }
type Command = { action: 'DRAW_START' | 'DRAW_PAUSE' | 'DRAW_RESUME' | 'DRAW_FINISH'; requestId: string; members: Line[] }

const path = (id: string) => drawingApi + '/groups/' + encodeURIComponent(id)
const candidateKey = ({ lot, warehouse, item }: DrawingMaterial) => JSON.stringify([lot, warehouse, item])
const allocationKey = (plan: string, stock: DrawingMaterial) => plan + '/' + candidateKey(stock)
const positive = (value: string) => /^(?:\d+)(?:\.\d{1,3})?$/.test(value) && Number(value) > 0 && Number.isFinite(Number(value))
const groupErrors: Record<string, string> = {
  GROUP_REMNANT_UNAVAILABLE: '자동 배정할 잔재가 없습니다. 묶음과 재고를 다시 확인하세요.',
  INVALID_SKIP_INPUT: '생략 승인 계획은 자동 잔재 배정만 사용할 수 있습니다.',
  STALE_VERSION: '다른 요청이 먼저 반영됐습니다. 최신 묶음 상태를 표시합니다.',
  TERMINAL_MISMATCH: '다른 단말에서 이 묶음을 진행 중입니다.',
  INSUFFICIENT_INPUT: '투입 합계가 가용 재고를 초과합니다.',
  GROUP_NOT_DRAW_READY: '각 계획의 1차 포장을 완료하거나 잔재 후보가 있는 계획의 생략을 확인하세요.',
  INVALID_QUANTITY: '각 계획의 양품 수량을 확인하세요.',
  INVALID_GROUP_CANDIDATE: '선택한 계획의 투입 후보를 다시 확인하세요.',
}

export default function DrawingGroupWork({ terminalId, workerId, onSessionExpired, onChanged, onPlan }: {
  terminalId: string; workerId: string; onSessionExpired: () => void; onChanged: (keys: string[], signal: AbortSignal) => Promise<void>; onPlan: (key: string) => void
}) {
  const [ids, setIds] = useState<string[]>()
  const [selected, setSelected] = useState('')
  const [group, setGroup] = useState<Group>()
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [skip, setSkip] = useState<Record<string, boolean>>({})
  const [good, setGood] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<PendingDrawing>()
  const active = useRef<AbortController | null>(null)

  const scope = (id: string): DrawingScope => [terminalId, workerId, 'group', id]
  const restoreFirst = useEffectEvent((options: string[]) => {
    if (selected) return
    const id = options.find(option => pendingDrawing(scope(option)))
    if (id) load(id)
  })
  useLayoutEffect(() => () => active.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    drawingRequest<string[]>(drawingApi + '/groups', controller.signal).then(options => { setIds(options); restoreFirst(options) }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setNotice('생산그룹을 조회하지 못했습니다.')
    })
    return () => { controller.abort(); active.current?.abort() }
  }, [onSessionExpired])

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setNotice('')
    try { await work(controller.signal) } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else if (error instanceof DrawingError) setNotice(groupErrors[error.message] ?? '묶음 요청을 처리할 수 없습니다.')
      else setNotice('서버 응답을 확인하지 못했습니다.')
    } finally {
      active.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function update(data: Group) {
    setGroup(data)
    setAllocations({})
    setGood({})
    setSkip({})
  }

  function load(id: string) {
    void run(async (signal) => {
      setSelected(id)
      setRetry(pendingDrawing(scope(id)))
      setGroup(undefined)
      update(await drawingRequest<Group>(path(id), signal))
    })
  }

  function send(command: Command) {
    transmit({ action: command.action, body: JSON.stringify(command) }, false)
  }

  function transmit(pending: PendingDrawing, replay: boolean) {
    void run(async (signal) => {
      let result: Group
      try {
        const reply = await submitDrawing<Group>(scope(selected), path(selected) + '/commands',
          signal, pending, replay, setRetry)
        if (!reply || signal.aborted) return
        result = replay ? await drawingRequest<Group>(path(selected), signal) : reply
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof DrawingError && ['STALE_VERSION', 'TERMINAL_MISMATCH', 'INSUFFICIENT_INPUT', 'GROUP_REMNANT_UNAVAILABLE'].includes(error.message)) {
          update(await drawingRequest<Group>(path(selected), signal))
        }
        throw error
      }
      update(result)
      const notices: Record<string, string> = { DRAW_START: '묶음 008을 시작했습니다.', DRAW_PAUSE: '묶음 008을 중단했습니다.',
        DRAW_RESUME: '묶음 008을 재시작했습니다.', DRAW_FINISH: '묶음 008을 완료했습니다.' }
      setNotice(notices[pending.action])
      await onChanged(result.members.map(({ key }) => key), signal)
    })
  }

  const allReady = group?.members.every(({ snapshot, autoRemnant }) =>
    snapshot.state === 'DRAW_READY' || (snapshot.state === 'CUT_READY' && !!autoRemnant))
  const hasSkipBranch = group?.members.some(({ snapshot, autoRemnant }) => snapshot.bypassedPack1 || !!autoRemnant)
  const hasNormalBranch = group?.members.some(({ snapshot, drawingInputs }) =>
    snapshot.state === 'DRAW_READY' || (!snapshot.bypassedPack1 && drawingInputs.length > 0))
  const allActive = group?.members.every(({ snapshot }) => snapshot.state === 'DRAW_ACTIVE' && snapshot.activeGroupId === group.id)
  const ownedHere = group?.members.every(({ snapshot }) => !snapshot.ownerTerminalId || snapshot.ownerTerminalId === terminalId)
  const startLines = group?.members.map(({ key, snapshot }) => ({
    key, expectedVersion: snapshot.version,
    confirmSkip: snapshot.state === 'CUT_READY' && !!skip[key],
    inputs: group.candidates.filter((candidate) => candidate.eligiblePlans.includes(key))
      .flatMap(({ material }) => {
        const value = allocations[allocationKey(key, material)]
        return value ? [{ ...material, qty: Number(value) }] : []
      }),
  }))
  const canStart = allReady && Object.values(allocations).every((value) => !value || positive(value))
    && startLines?.every((line) => line.confirmSkip || line.inputs.length > 0)
  const allPaused = group?.members.every(({ snapshot }) => snapshot.state === 'DRAW_PAUSED' && snapshot.activeGroupId === group.id)
  const canFinish = allActive && group?.members.every(({ key }) => positive(good[key] ?? ''))
  const locked = busy || !!retry

  return (
    <section className="floor-work" aria-labelledby="drawing-group-title">
      <h3 id="drawing-group-title">008 생산그룹</h3>
      {ids?.length === 0 && <p>이 사업장에 생산그룹이 없습니다.</p>}
      {!!ids?.length && (
        <label>생산그룹 선택
          <select value={selected} disabled={busy} onChange={(event) => load(event.target.value)}>
            <option value="" disabled>생산그룹 선택</option>
            {ids.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
      )}
      {selected && <button type="button" disabled={busy} onClick={() => load(selected)}>묶음 새로 조회</button>}
      {group && (
        <>
          {hasSkipBranch && hasNormalBranch && <p>1차 포장 완료·생략 혼합 묶음</p>}
          <ul>{group.members.map(({ key, snapshot, result, drawingInputs, autoRemnant }) => (
            <li key={key}>
              <button type="button" disabled={locked} onClick={() => onPlan(key)}>{key}</button>
              {' · '}{drawingStates[snapshot.state]} · 버전 {snapshot.version}
              {snapshot.bypassedPack1 && <span> · 1차 포장 생략</span>}
              {(snapshot.state === 'DRAW_READY' || (!snapshot.bypassedPack1 && drawingInputs.length > 0)) && <span> · 1차 포장 완료</span>}
              {snapshot.state === 'CUT_READY' && autoRemnant && (
                <label>
                  <input type="checkbox" checked={!!skip[key]} disabled={locked || !ownedHere}
                    onChange={event => setSkip(current => ({ ...current, [key]: event.target.checked }))} />
                  {key} 1차 생략 확인 · 자동 잔재 {autoRemnant.lot} / {autoRemnant.warehouse} / {autoRemnant.item} · {autoRemnant.qty}
                </label>
              )}
              {result && <div>생산일보 {result.drawingDailyId} · 이동 {result.movementId} / {result.movementLine}</div>}
              {snapshot.ownerTerminalId && ' · ' + snapshot.ownerTerminalId}
              {drawingInputs.length > 0 && (
                <ul aria-label="시작 투입 내역">
                  {drawingInputs.map((material) => (
                    <li key={candidateKey(material)}>{material.lot} / {material.warehouse} / {material.item} · {material.qty}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}</ul>
          {!allReady && !allActive && group.members.some(({ snapshot }) => snapshot.state === 'CUT_READY' || snapshot.state === 'PACK1_ACTIVE') &&
            <p>생략 후보가 없는 계획은 1차 포장을 완료한 뒤 묶음을 새로 조회하세요.</p>}
          {allReady && (
            <>
              <fieldset className="floor-stage"><legend>계획별 자재 배분</legend>
              <div className="table-scroll">
                <table aria-label="묶음 투입 후보">
                  <thead><tr><th scope="col">LOT / 창고 / 품목</th><th scope="col">가용량</th>
                    {group.members.map(({ key }) => <th scope="col" key={key}>{key} 투입량</th>)}</tr></thead>
                  <tbody>{group.candidates.filter(({ eligiblePlans }) => eligiblePlans.length > 0).map(({ material, eligiblePlans }) => (
                    <tr key={candidateKey(material)}><th scope="row">{material.lot} / {material.warehouse} / {material.item}</th>
                      <td>{material.qty}</td>
                      {group.members.map(({ key }) => {
                        const inputKey = allocationKey(key, material)
                        return <td key={key}>{eligiblePlans.includes(key) && <TouchField layout="decimal" type="number" min="0.001" step="0.001"
                          label={material.lot + ' / ' + material.warehouse + ' / ' + material.item + ' ' + key + ' 투입량'} disabled={locked || !ownedHere}
                          value={allocations[inputKey] ?? ''}
                          onValueChange={value => setAllocations((values) => ({ ...values, [inputKey]: value }))} />}</td>
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <button type="button" disabled={locked || !ownedHere || !canStart} onClick={() => {
                if (startLines) send({ action: 'DRAW_START', requestId: crypto.randomUUID(), members: startLines })
              }}>묶음 008 시작</button>
              </fieldset>
            </>
          )}
          {(allActive || allPaused) && <DrawingPauseButton paused={!!allPaused} disabled={locked || !ownedHere}
            onConfirm={() => send({ action: allPaused ? 'DRAW_RESUME' : 'DRAW_PAUSE', requestId: crypto.randomUUID(),
              members: group.members.map(({ key, snapshot }) => ({ key, expectedVersion: snapshot.version })) })} />}
          {allActive && (
            <fieldset className="floor-stage"><legend>계획별 양품 실적</legend>
              {group.members.map(({ key }) => (
                <TouchField key={key} label={key + ' 양품 수량'} layout="decimal" type="number" min="0.001" step="0.001" disabled={locked || !ownedHere} value={good[key] ?? ''}
                    onValueChange={value => setGood((values) => ({ ...values, [key]: value }))} />
              ))}
              <FloorConfirm label="묶음 008 완료" summary={group.members.map(({ key }) => key + ' · ' + good[key]).join(' / ')} disabled={locked || !ownedHere || !canFinish} onConfirm={() => send({
                action: 'DRAW_FINISH', requestId: crypto.randomUUID(), members: group.members.map(({ key, snapshot }) => ({
                  key, expectedVersion: snapshot.version, goodQty: Number(good[key]),
                })),
              })} />
            </fieldset>
          )}
        </>
      )}
      {selected && retry && <button type="button" disabled={busy} onClick={() => transmit(retry, true)}>같은 묶음 요청 다시 보내기</button>}
      <p role="status">{busy ? '묶음 처리 중입니다.' : notice}</p>
    </section>
  )
}
