import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BasketApiError, loadBasket, sendBasketCommand } from './basketApi'
import type { Action, Actor, BasketView, Command, Issue, PlanKey, ReturnLine } from './basketApi'

const planId = (key: PlanKey) => key.date + '/' + key.sequence
const lotLabel = (lot: BasketView['materials'][number]['lot']) => [lot.item, lot.lot, lot.warehouse, lot.position].join(' / ')

function readPending(key: string): Command | undefined {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as Command : undefined
  } catch {
    return undefined
  }
}

export default function WorkBasket({ actor, onSessionExpired }: { actor: Actor; onSessionExpired: () => void }) {
  const storageKey = 'synthetic-basket-retry:' + JSON.stringify([actor.terminal, actor.worker])
  const [view, setView] = useState<BasketView>()
  const [scan, setScan] = useState('')
  const [visible, setVisible] = useState<string[]>([])
  const [checked, setChecked] = useState<string[]>([])
  const [issue, setIssue] = useState('0')
  const [quantity, setQuantity] = useState('')
  const [returnLot, setReturnLot] = useState('')
  const [returnQty, setReturnQty] = useState('')
  const [length, setLength] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [returns, setReturns] = useState<ReturnLine[]>([])
  const inFlight = useRef(false)
  const [pending, setPending] = useState(() => readPending(storageKey))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const lifetime = useRef({ active: false })
  useLayoutEffect(() => {
    const mount = { active: true }
    lifetime.current = mount
    return () => { mount.active = false }
  }, [storageKey])

  useEffect(() => {
    let active = true
    void loadBasket().then(next => {
      if (active) {
        setView(next)
      }
    }).catch((error: unknown) => {
      if (!active) return
      if (error instanceof BasketApiError && error.status === 401) onSessionExpired()
      else setNotice(String(error))
    })
    return () => { active = false }
  }, [onSessionExpired])

  const sameActor = view?.actor.terminal === actor.terminal && view.actor.worker === actor.worker

  function clearPending(command: Command) {
    if (readPending(storageKey)?.requestId !== command.requestId) return
    sessionStorage.removeItem(storageKey)
    setPending(current => current?.requestId === command.requestId ? undefined : current)
  }

  async function submit(action?: Action) {
    if (!view || !sameActor || !view.canWrite || inFlight.current) return
    const rows = view.work.map(row => row.plan.key).filter(key => visible.includes(planId(key)))
    const saving = action === 'SAVE_BASKET'
    const command = pending ?? (action && {
      action, requestId: crypto.randomUUID(), expectedRevision: view.revision, visible: rows,
      selected: action === 'START_BASKET' ? [] : rows.filter(key => checked.includes(planId(key))),
      issues: saving ? issues : [],
      returns: saving ? returns : [],
    })
    if (!command) return
    const mount = lifetime.current
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(command))
    } catch {
      setNotice('요청 복구 정보를 저장할 수 없습니다.')
      return
    }
    inFlight.current = true
    setBusy(true)
    setPending(command)
    try {
      const result = await sendBasketCommand(command)
      if (!mount.active) return
      clearPending(command)
      if (command.action === 'SAVE_BASKET') {
        setIssues([])
        setReturns([])
      }
      if (command.action === 'DELETE_UNFINISHED') {
        const affected = new Set(result.affected.map(planId))
        setChecked(current => current.filter(id => !affected.has(id)))
      }
      setNotice('처리 완료 · 버전 ' + result.revision)
      const next = await loadBasket()
      if (mount.active) setView(next)
    } catch (error) {
      if (!mount.active) return
      if (error instanceof BasketApiError && error.status === 401) {
        onSessionExpired()
      } else {
        setNotice(String(error))
        if (error instanceof BasketApiError && [400, 403, 404, 409, 422].includes(error.status)) {
          clearPending(command)
          if (error.status === 409) {
            try {
              const next = await loadBasket()
              if (mount.active) setView(next)
            } catch (refreshError) {
              if (mount.active && refreshError instanceof BasketApiError && refreshError.status === 401) onSessionExpired()
            }
          }
        }
      }
    } finally {
      inFlight.current = false
      if (mount.active) setBusy(false)
    }
  }

  function toggle(values: string[], id: string) {
    return values.includes(id) ? values.filter(value => value !== id) : [...values, id]
  }

  return <section aria-label="작업 장바구니">
    <h2>작업 장바구니</h2>
    {notice && <p role="status">{notice}</p>}
    {view && sameActor && <>
      <p>{view.actor.scope.center} · 버전 {view.revision}</p>
      <form onSubmit={event => {
        event.preventDefault()
        const row = view.work.find(work => planId(work.plan.key) === scan.trim())
        if (!row) {
          setNotice('계획 키를 찾을 수 없습니다.')
          return
        }
        const ids = row.groupId
          ? view.work.filter(work => work.groupId === row.groupId).map(work => planId(work.plan.key))
          : [planId(row.plan.key)]
        setVisible(current => [...new Set([...current, ...ids])])
        setScan('')
        setNotice('')
      }}>
        <label>합성 작업지시 스캔 <input value={scan} onChange={event => setScan(event.target.value)}
          placeholder="2030-01-01/1" /></label>
        <button type="submit" disabled={busy || Boolean(pending) || confirmDelete || !scan.trim()}>작업 조회</button>
      </form>
      <details><summary>합성 계획 후보</summary>
        <ul>{view.work.map(row => <li key={planId(row.plan.key)}>{planId(row.plan.key)}</li>)}</ul>
      </details>
      <fieldset disabled={!view.canWrite || busy || Boolean(pending) || confirmDelete}>
        <legend>조회 목록과 작업 선택</legend>
        {view.work.filter(row => visible.includes(planId(row.plan.key))).map(row => {
          const id = planId(row.plan.key)
          return <div key={id}>
            <label><input type="checkbox" checked={visible.includes(id)} onChange={() => setVisible(current => toggle(current, id))} />목록 {id}</label>
            <label><input type="checkbox" disabled={!visible.includes(id)} checked={visible.includes(id) && checked.includes(id)} onChange={() => setChecked(current => toggle(current, id))} />선택</label>
            {' '}{row.plan.order} / {row.plan.orderLine} · {row.phase} {row.groupId}
          </div>
        })}
        {view.mode === 'BASKET' && <>
          <label>투입 LOT <select value={issue} onChange={event => setIssue(event.target.value)}>
            {view.materials.map((row, i) => <option value={i} key={lotLabel(row.lot)}>{lotLabel(row.lot)} · 잔량 {row.available}</option>)}
          </select></label>
          <label>투입수량 <input type="number" min="0.001" step="0.001" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
          <button type="button" disabled={!quantity || !view.materials[Number(issue)]} onClick={() => {
            setIssues([...issues, { lot: view.materials[Number(issue)].lot, quantity }])
            setQuantity('')
          }}>투입행 추가</button>
          <ul aria-label="투입행">{issues.map((row, i) => <li key={i}>
            {lotLabel(row.lot)} ? {row.quantity}
            <button type="button" onClick={() => setIssues(issues.filter((_, index) => index !== i))}>제거</button>
          </li>)}</ul>
          <label>반납 LOT <select value={returnLot} onChange={event => setReturnLot(event.target.value)}>
            <option value="">반납 없음</option>
            {view.returnCandidates.map((lot, i) => <option value={i} key={lotLabel(lot)}>{lotLabel(lot)}</option>)}
          </select></label>
          {returnLot !== '' && <>
            <label>반납수량 <input type="number" min="0.001" step="0.001" value={returnQty} onChange={event => setReturnQty(event.target.value)} /></label>
            <label>반납길이 <input type="number" min="0.001" step="0.001" value={length} onChange={event => setLength(event.target.value)} /></label>
            <button type="button" disabled={!returnQty || !length} onClick={() => {
              setReturns([...returns, { lot: view.returnCandidates[Number(returnLot)], quantity: returnQty, length }])
              setReturnQty('')
              setLength('')
            }}>반납행 추가</button>
          </>}
          <ul aria-label="반납행">{returns.map((row, i) => <li key={i}>
            {lotLabel(row.lot)} ? {row.quantity} / {row.length}
            <button type="button" onClick={() => setReturns(returns.filter((_, index) => index !== i))}>제거</button>
          </li>)}</ul>
          <button type="button" disabled={!issues.length} onClick={() => void submit('SAVE_BASKET')}>장바구니 저장</button>
          <button type="button" onClick={() => void submit('START_BASKET')}>작업 시작</button>
        </>}
        <button type="button" disabled={!visible.length} onClick={() => setConfirmDelete(true)}>미완료 삭제</button>
        <p>{view.mode === 'CHECKED_LIST' ? '목록에 완료 작업이 있으면 중단합니다. 선택한 미완료 작업을 삭제합니다.' : '목록에 완료 작업이 있으면 중단합니다. 목록 전체의 미완료 작업을 삭제합니다.'}</p>
      </fieldset>
      {confirmDelete && <section role="alertdialog" aria-label="미완료 삭제 확인">
        <p>{view.mode === 'CHECKED_LIST' ? '선택한 미완료 작업을 삭제합니까?'
          : '표시된 목록의 미완료 작업을 삭제합니까?'}</p>
        <button type="button" onClick={() => setConfirmDelete(false)}>취소</button>
        <button type="button" onClick={() => {
          setConfirmDelete(false)
          void submit('DELETE_UNFINISHED')
        }}>삭제 확정</button>
      </section>}
      {view.groups.filter(group => view.work.some(row => row.groupId === group.id && visible.includes(planId(row.plan.key))))
        .map(group => <section key={group.id} aria-label={group.id}>
          <h3>{group.id}</h3>
          <ul>{group.issues.map((row, i) => <li key={'issue-' + i}>{lotLabel(row.lot)} / {row.quantity}</li>)}
            {group.returns.map((row, i) => <li key={'return-' + i}>{lotLabel(row.lot)} / {row.quantity} / {row.length}</li>)}</ul>
        </section>)}
      {pending && <button type="button" disabled={busy || !view.canWrite} onClick={() => void submit()}>같은 요청 재시도</button>}
    </>}
  </section>
}
