import { useEffect, useRef, useState } from 'react'
import { drawingRequest, DrawingError, drawingApi, drawingStates } from './drawingApi'
import type { DrawingMaterial, DrawingDetail } from './drawingApi'
import { SessionExpired } from './workHistoryApi'

type Member = {
  key: string; snapshot: DrawingDetail; drawingInputs: DrawingMaterial[]
  result: { drawingDailyId: string; movementId: string; movementLine: number } | null
}
type Candidate = { material: DrawingMaterial; eligiblePlans: string[] }
type Group = { id: string; members: Member[]; candidates: Candidate[] }
type Line = { key: string; expectedVersion: number; inputs?: DrawingMaterial[]; goodQty?: number }
type Command = { action: 'DRAW_START' | 'DRAW_FINISH'; requestId: string; members: Line[] }

const path = (id: string) => drawingApi + '/groups/' + encodeURIComponent(id)
const candidateKey = ({ lot, warehouse, item }: DrawingMaterial) => JSON.stringify([lot, warehouse, item])
const allocationKey = (plan: string, stock: DrawingMaterial) => plan + '/' + candidateKey(stock)
const positive = (value: string) => /^(?:\d+)(?:\.\d{1,3})?$/.test(value) && Number(value) > 0 && Number.isFinite(Number(value))
const groupErrors: Record<string, string> = {
  STALE_VERSION: '다른 요청이 먼저 반영됐습니다. 최신 묶음 상태를 표시합니다.',
  TERMINAL_MISMATCH: '다른 단말에서 이 묶음을 진행 중입니다.',
  INSUFFICIENT_INPUT: '투입 합계가 가용 재고를 초과합니다.',
  GROUP_NOT_DRAW_READY: '묶음의 모든 계획에서 1차 포장을 완료하세요.',
  INVALID_QUANTITY: '각 계획의 양품 수량을 확인하세요.',
  INVALID_GROUP_CANDIDATE: '선택한 계획의 투입 후보를 다시 확인하세요.',
}

export default function DrawingGroupWork({ terminalId, onSessionExpired, onChanged, onPlan }: {
  terminalId: string; onSessionExpired: () => void; onChanged: (keys: string[], signal: AbortSignal) => Promise<void>; onPlan: (key: string) => void
}) {
  const [ids, setIds] = useState<string[]>()
  const [selected, setSelected] = useState('')
  const [group, setGroup] = useState<Group>()
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [good, setGood] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<Command>()
  const active = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    drawingRequest<string[]>(drawingApi + '/groups', controller.signal).then(setIds).catch((error: unknown) => {
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
  }

  function load(id: string) {
    void run(async (signal) => {
      setSelected(id)
      setGroup(undefined)
      update(await drawingRequest<Group>(path(id), signal))
    })
  }

  function send(command: Command) {
    void run(async (signal) => {
      let result: Group
      try {
        result = await drawingRequest<Group>(path(selected) + '/commands', signal, command)
      } catch (error) {
        if (signal.aborted) return
        if (!(error instanceof DrawingError) && !(error instanceof SessionExpired)) {
          setRetry(command)
        } else {
          setRetry(undefined)
          if (error instanceof DrawingError && ['STALE_VERSION', 'TERMINAL_MISMATCH', 'INSUFFICIENT_INPUT'].includes(error.message)) {
            setGroup(await drawingRequest<Group>(path(selected), signal))
          }
        }
        throw error
      }
      setRetry(undefined)
      update(result)
      setNotice(command.action === 'DRAW_START' ? '묶음 008을 시작했습니다.' : '묶음 008을 완료했습니다.')
      await onChanged(result.members.map(({ key }) => key), signal)
    })
  }

  const allReady = group?.members.every(({ snapshot }) => snapshot.state === 'DRAW_READY')
  const allActive = group?.members.every(({ snapshot }) => snapshot.state === 'DRAW_ACTIVE' && snapshot.activeGroupId === group.id)
  const ownedHere = group?.members.every(({ snapshot }) => !snapshot.ownerTerminalId || snapshot.ownerTerminalId === terminalId)
  const startLines = group?.members.map(({ key, snapshot }) => ({
    key, expectedVersion: snapshot.version,
    inputs: group.candidates.filter((candidate) => candidate.eligiblePlans.includes(key))
      .flatMap(({ material }) => {
        const value = allocations[allocationKey(key, material)]
        return value ? [{ ...material, qty: Number(value) }] : []
      }),
  }))
  const canStart = allReady && Object.values(allocations).every((value) => !value || positive(value))
    && startLines?.every((line) => line.inputs.length > 0)
  const canFinish = allActive && group?.members.every(({ key }) => positive(good[key] ?? ''))
  const locked = busy || !!retry

  return (
    <section aria-labelledby="drawing-group-title">
      <h3 id="drawing-group-title">008 생산그룹</h3>
      {ids?.length === 0 && <p>이 사업장에 생산그룹이 없습니다.</p>}
      {!!ids?.length && (
        <label>생산그룹 선택
          <select value={selected} disabled={locked} onChange={(event) => load(event.target.value)}>
            <option value="" disabled>생산그룹 선택</option>
            {ids.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
      )}
      {selected && <button type="button" disabled={locked} onClick={() => load(selected)}>묶음 새로 조회</button>}
      {group && (
        <>
          <ul>{group.members.map(({ key, snapshot, result, drawingInputs }) => (
            <li key={key}>
              <button type="button" disabled={locked} onClick={() => onPlan(key)}>{key}</button>
              {' · '}{drawingStates[snapshot.state]} · 버전 {snapshot.version}
              {result && <div>{result.drawingDailyId} ? {result.movementId} / {result.movementLine}</div>}
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
            <p>각 계획에서 1차 포장을 완료한 뒤 묶음을 새로 조회하세요.</p>}
          {allReady && (
            <>
              <div className="table-scroll">
                <table aria-label="묶음 투입 후보">
                  <thead><tr><th scope="col">LOT / 창고 / 품목</th><th scope="col">가용량</th>
                    {group.members.map(({ key }) => <th scope="col" key={key}>{key} 투입량</th>)}</tr></thead>
                  <tbody>{group.candidates.filter(({ eligiblePlans }) => eligiblePlans.length > 0).map(({ material, eligiblePlans }) => (
                    <tr key={candidateKey(material)}><th scope="row">{material.lot} / {material.warehouse} / {material.item}</th>
                      <td>{material.qty}</td>
                      {group.members.map(({ key }) => {
                        const inputKey = allocationKey(key, material)
                        return <td key={key}>{eligiblePlans.includes(key) && <input type="number" min="0.001" step="0.001"
                          aria-label={material.lot + ' / ' + material.warehouse + ' / ' + material.item + ' ' + key + ' 투입량'} disabled={locked || !ownedHere}
                          value={allocations[inputKey] ?? ''}
                          onChange={(event) => setAllocations((values) => ({ ...values, [inputKey]: event.target.value }))} />}</td>
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <button type="button" disabled={locked || !ownedHere || !canStart} onClick={() => {
                if (startLines) send({ action: 'DRAW_START', requestId: crypto.randomUUID(), members: startLines })
              }}>묶음 008 시작</button>
            </>
          )}
          {allActive && (
            <>
              {group.members.map(({ key }) => (
                <label key={key}>{key} 양품 수량
                  <input type="number" min="0.001" step="0.001" disabled={locked || !ownedHere} value={good[key] ?? ''}
                    onChange={(event) => setGood((values) => ({ ...values, [key]: event.target.value }))} />
                </label>
              ))}
              <button type="button" disabled={locked || !ownedHere || !canFinish} onClick={() => send({
                action: 'DRAW_FINISH', requestId: crypto.randomUUID(), members: group.members.map(({ key, snapshot }) => ({
                  key, expectedVersion: snapshot.version, goodQty: Number(good[key]),
                })),
              })}>묶음 008 완료</button>
            </>
          )}
          {retry && <button type="button" disabled={busy} onClick={() => send(retry)}>같은 묶음 요청 다시 보내기</button>}
        </>
      )}
      <p role="status">{busy ? '묶음 처리 중입니다.' : notice}</p>
    </section>
  )
}
