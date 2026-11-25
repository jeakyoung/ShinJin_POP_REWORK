import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { InventoryError, loadInventory, sendInventory } from './inventoryApi'
import type { Command, InventoryView, Location, Movement } from './inventoryApi'

const messages: Record<string, string> = {
  STALE_VERSION: '다른 이동이 먼저 반영됐습니다. 갱신된 잔량을 확인해 주세요.',
  INSUFFICIENT_STOCK: '이동 또는 취소에 필요한 LOT 잔량이 부족합니다.',
  STOCK_OVERFLOW: '도착 위치의 재고 상한을 초과합니다.',
  SAME_WAREHOUSE: '서로 다른 창고를 선택해 주세요.',
  TERMINAL_OUT_OF_SCOPE: '현재 단말은 재고이동 권한이 없습니다.',
  LOCATION_OUT_OF_SCOPE: '현재 단말의 창고·위치 범위를 벗어났습니다.',
  CANCEL_TERMINAL_MISMATCH: '원래 이동 단말에서 취소해 주세요.',
  COMMAND_ACTOR_MISMATCH: '원래 작업자와 단말에서 다시 시도해 주세요.',
  INVALID_COMMAND: '품목·LOT·위치와 수량을 확인해 주세요.',
  ALREADY_CANCELLED: '이미 취소된 이동입니다.',
}

function locationKey(location: Location) {
  return JSON.stringify([location.warehouse, location.position])
}

function locationText(location: Location) {
  return `${location.warehouse} / ${location.position}`
}

function units(quantity: string) {
  if (!/^\d{1,15}(\.\d{1,3})?$/.test(quantity)) return 0n
  const [whole, fraction = ''] = quantity.split('.')
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
}

type Props = {
  actor: { terminal: string; worker: string }
  onSessionExpired: () => void
}

const definitiveRejections = new Set([
  'MALFORMED_COMMAND', 'INVALID_COMMAND', 'REQUEST_ID_REUSED', 'STALE_VERSION',
  'TERMINAL_OUT_OF_SCOPE', 'COMMAND_ACTOR_MISMATCH', 'LOCATION_OUT_OF_SCOPE',
  'MOVEMENT_NOT_FOUND', 'CANCEL_TERMINAL_MISMATCH', 'ALREADY_CANCELLED',
  'SAME_WAREHOUSE', 'INSUFFICIENT_STOCK', 'STOCK_OVERFLOW',
])

function readRetry(key: string): Command | null {
  try {
    const saved = sessionStorage.getItem(key)
    return saved ? JSON.parse(saved) as Command : null
  } catch {
    return null
  }
}

export default function InventoryMoves({ actor, onSessionExpired }: Props) {
  const storageKey = 'synthetic-inventory-retry:' + JSON.stringify([actor.terminal, actor.worker])
  const [view, setView] = useState<InventoryView>()
  const [item, setItem] = useState('')
  const [lot, setLot] = useState('')
  const [source, setSource] = useState('')
  const [destination, setDestination] = useState('')
  const [quantity, setQuantity] = useState('')
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
    loadInventory(abort.signal).then(next => { if (!abort.signal.aborted) setView(next) }).catch(error => {
      if (abort.signal.aborted) return
      if (error instanceof InventoryError && error.status === 401) onSessionExpired()
      else setNotice('재고이동 후보를 불러오지 못했습니다.')
    })
    return () => abort.abort()
  }, [onSessionExpired])

  function report(error: unknown) {
    if (error instanceof InventoryError && error.status === 401) onSessionExpired()
    else setNotice(error instanceof InventoryError ? messages[error.message] ?? `재고이동 요청 실패 (${error.status})`
      : '요청 결과를 확인할 수 없습니다. 같은 명령으로 다시 시도해 주세요.')
  }

  async function refresh() {
    if (inFlight.current) return
    const generation = lifetime.current
    inFlight.current = true
    setBusy(true)
    try {
      const next = await loadInventory()
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
      await sendInventory(command)
      if (generation !== lifetime.current) return
      clearRetry(command)
      setQuantity('')
      setNotice(command.action === 'MOVE' ? '재고이동을 기록했습니다.' : '재고이동을 취소했습니다.')
    } catch (error) {
      if (generation !== lifetime.current) return
      if (error instanceof InventoryError && error.status >= 400 && error.status < 500
          && definitiveRejections.has(error.message)) clearRetry(command)
      report(error)
      if (error instanceof InventoryError && error.status === 401) {
        inFlight.current = false
        setBusy(false)
        return
      }
    }
    try {
      const next = await loadInventory()
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

  const positive = view?.balances.filter(balance => units(balance.quantity) > 0n) ?? []
  const items = [...new Set(positive.map(balance => balance.lot.item))]
  const itemLots = positive.filter(balance => balance.lot.item === item)
  const lots = [...new Set(itemLots.map(balance => balance.lot.lot))]
  const sources = itemLots.filter(balance => balance.lot.lot === lot)
  const from = sources.find(balance => locationKey(balance.location) === source)
  const destinations = view?.locations.filter(location => from && location.warehouse !== from.location.warehouse) ?? []
  const to = destinations.find(location => locationKey(location) === destination)
  const canEdit = !!view?.canMove && sameActor && !busy && !retry
  const canSubmit = canEdit && from && to && units(quantity) > 0n && units(quantity) <= units(from.quantity)

  function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!view || !canSubmit || !from || !to) return
    void execute({ action: 'MOVE', requestId: crypto.randomUUID(), expectedVersion: view.version,
      lot: from.lot, source: from.location, destination: to, quantity })
  }

  function cancel(row: Movement) {
    if (!view || !canEdit || !window.confirm(`${row.id} 이동을 취소할까요?`)) return
    void execute({ action: 'CANCEL', requestId: crypto.randomUUID(), expectedVersion: view.version, movementId: row.id })
  }

  return (
    <section aria-labelledby="inventory-title">
      <h2 id="inventory-title">재고이동</h2>
      <button type="button" disabled={busy} onClick={() => void refresh()}>재고 새로고침</button>
      {notice && <p role="status">{notice}</p>}
      {retry && sameActor && <button type="button" disabled={busy} onClick={() => void execute(retry)}>동일 명령 재시도</button>}
      {view && <>
        <p>{view.actor.site.site} · 단말 {view.actor.terminal} · 작업자 {view.actor.worker}</p>
        {!view.canMove && <p>현재 단말은 조회만 할 수 있습니다.</p>}
        <form onSubmit={move}>
          <fieldset disabled={!canEdit}>
            <legend>창고 간 이동</legend>
            <label>품목 <select required value={item} onChange={event => {
              setItem(event.target.value); setLot(''); setSource(''); setDestination('')
            }}><option value="">품목 선택</option>{items.map(value => <option key={value}>{value}</option>)}</select></label>{' '}
            <label>LOT <select required value={lot} onChange={event => {
              setLot(event.target.value); setSource(''); setDestination('')
            }}><option value="">LOT 선택</option>{lots.map(value => <option key={value}>{value}</option>)}</select></label>{' '}
            <label>출발 위치 <select required value={source} onChange={event => {
              setSource(event.target.value); setDestination('')
            }}><option value="">출발 위치 선택</option>{sources.map(row => <option key={locationKey(row.location)}
              value={locationKey(row.location)}>{locationText(row.location)} · 잔량 {row.quantity}</option>)}</select></label>{' '}
            <label>도착 위치 <select required value={destination} onChange={event => setDestination(event.target.value)}>
              <option value="">도착 위치 선택</option>{destinations.map(location => <option key={locationKey(location)}
                value={locationKey(location)}>{locationText(location)}</option>)}</select></label>{' '}
            <label>수량 <input required inputMode="decimal" maxLength={19} value={quantity}
              onChange={event => setQuantity(event.target.value)} /></label>{' '}
            <button type="submit" disabled={!canSubmit}>이동 확정</button>
          </fieldset>
        </form>
        <h3>현재 잔량</h3>
        <table>
          <thead><tr><th scope="col">품목 · LOT</th><th scope="col">창고 / 위치</th><th scope="col">수량</th></tr></thead>
          <tbody>{view.balances.map(row => <tr key={JSON.stringify([row.lot, row.location])}>
            <th scope="row">{row.lot.item} · {row.lot.lot}</th>
            <td>{locationText(row.location)}</td><td>{row.quantity}</td>
          </tr>)}</tbody>
        </table>
        <h3>이동 이력</h3>
        {view.movements.length === 0 ? <p>이동 이력이 없습니다.</p> : (
          <table>
            <thead><tr><th>이동 번호</th><th>품목 · LOT</th><th>출발 → 도착</th><th>수량</th><th>상태</th><th>작업</th></tr></thead>
            <tbody>{view.movements.map(row => <tr key={row.id}>
              <th scope="row">{row.id}</th><td>{row.lot.item} · {row.lot.lot}</td>
              <td>{locationText(row.source)} → {locationText(row.destination)}</td><td>{row.quantity}</td>
              <td>{row.status === 'MOVED' ? '이동 완료' : '취소됨'}</td>
              <td>{row.status === 'MOVED' && row.movedBy.terminal === view.actor.terminal &&
                <button type="button" disabled={!canEdit} onClick={() => cancel(row)}>이동 취소</button>}</td>
            </tr>)}</tbody>
          </table>
        )}
      </>}
    </section>
  )
}
