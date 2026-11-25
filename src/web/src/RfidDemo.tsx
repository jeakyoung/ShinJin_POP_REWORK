import RfidPhotos from './RfidPhotos'
import { useEffect, useRef, useState } from 'react'
import ScanInput from './ScanInput'
import { SessionExpired } from './workHistoryApi'
type Command =
  | { action: 'register'; tag: string }
  | { action: 'match'; tag: string; pallet: string }
  | { action: 'load'; pallet: string; item: string }
  | { action: 'in' | 'out'; pallet: string; eventId: string }

const labels: Record<string, string> = {
  REGISTERED: '등록 완료', MATCHED: '매칭 완료', LOADED: '적재 완료', APPLIED: '이동 완료',
  REPLAYED: '기존 명령 재생', INVALID_INPUT: '필수 입력을 확인해 주세요.',
  TAG_NOT_FOUND: '등록되지 않은 태그입니다.', ALREADY_REGISTERED: '이미 등록된 태그입니다.',
  ALREADY_MATCHED: '이미 매칭되어 있습니다.', ALREADY_LOADED: '이미 적재되어 있습니다.',
  COMMAND_ACTOR_MISMATCH: '다른 작업자의 이벤트입니다.', PALLET_ACTOR_MISMATCH: '이 파렛트의 이동 권한이 없습니다.',
  TAG_ACTOR_MISMATCH: '이 태그의 매칭 권한이 없습니다.', INVALID_SEQUENCE: '작업 순서를 확인해 주세요.', EVENT_ID_REUSED: '같은 이벤트 키에 다른 입력입니다.',
}

type View = { history: { eventId: string; direction: 'IN' | 'OUT'; pallet: string; tag: string; items: string[] }[]; netInventoryDelta: number }
type Reply = { code: string; view: View }
type Pending = Command & { eventId: string }

function recoverPending(key: string): Pending | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (!value || typeof value.eventId !== 'string' || !value.eventId.trim()) return
    if (value.action === 'register' && typeof value.tag === 'string') {
      return { action: 'register', tag: value.tag, eventId: value.eventId }
    }
    if (typeof value.pallet !== 'string') return
    if (value.action === 'match' && typeof value.tag === 'string') {
      return { action: 'match', tag: value.tag, pallet: value.pallet, eventId: value.eventId }
    }
    if (value.action === 'load' && typeof value.item === 'string') {
      return { action: 'load', pallet: value.pallet, item: value.item, eventId: value.eventId }
    }
    if (value.action === 'in' || value.action === 'out') {
      return { action: value.action, pallet: value.pallet, eventId: value.eventId }
    }
  } catch {
    return
  }
}

export default function RfidDemo({ actor, onSessionExpired }: { actor: string; onSessionExpired: () => void }) {

  const storageKey = 'synthetic-rfid-pending:' + actor
  const [pending, setPending] = useState(() => recoverPending(storageKey))
  const [tag, setTag] = useState('')
  const [pallet, setPallet] = useState('')
  const [item, setItem] = useState('')
  const [eventId, setEventId] = useState('')
  const [notice, setNotice] = useState('')
  const [state, setState] = useState<View>({ history: [], netInventoryDelta: 0 })
  const [busy, setBusy] = useState(true)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/pop/rfid', { signal: controller.signal }).then(async (response) => {
      if (response.status === 401) throw new SessionExpired()
      if (!response.ok) throw new Error('RFID 조회 실패')
      const view: View = await response.json()
      if (!controller.signal.aborted) setState(view)
    }).catch((error) => {
      if (controller.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setNotice('RFID 이력을 불러오지 못했습니다.')
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => { controller.abort(); request.current?.abort() }
  }, [onSessionExpired])

  function clearPending() {
    sessionStorage.removeItem(storageKey)
    setPending(undefined)
  }

  function begin(command: Command) {
    if (busy || request.current || pending) return
    const eventId = command.action === 'in' || command.action === 'out' ? command.eventId.trim() : crypto.randomUUID()
    if (!eventId) {
      setNotice(labels.INVALID_INPUT)
      return
    }
    void execute({ ...command, eventId })
  }

  async function execute(command: Pending) {
    if (busy || request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(command))
      setPending(command)
      const response = await fetch('/api/pop/rfid/commands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify(command),
      })
      if (response.status === 401) throw new SessionExpired()
      if (response.status >= 500 || response.status === 408 || response.status === 429) throw new Error('unknown command result')
      const reply: Reply = await response.json()
      if (controller.signal.aborted) return
      clearPending()
      setNotice(labels[reply.code] ?? reply.code)
      if (reply.view) setState(reply.view)
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setNotice('명령 응답을 확인하지 못했습니다. 보존된 동일 명령을 재시도해 주세요.')
    } finally {
      request.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <section aria-labelledby="rfid-title">
      <h2 id="rfid-title">합성 RFID·파렛트</h2>
      <p>데모 서버 메모리에 저장되며 내 단말·작업자의 이력을 표시합니다.</p>
      <ScanInput actor={actor} modes={[{ value: 'lot', label: '태그' }]} label="태그 스캔"
        onRoute={(route) => { if (route.kind === 'lot') setTag(route.code) }} />
      <label>태그<input value={tag} onChange={(event) => setTag(event.target.value)} /></label>
      <label>파렛트<input value={pallet} onChange={(event) => setPallet(event.target.value)} /></label>
      <label>품목<input value={item} onChange={(event) => setItem(event.target.value)} /></label>
      <label>이동 이벤트 키<input value={eventId} onChange={(event) => setEventId(event.target.value)} /></label>
      <button type="button" disabled={busy || !!pending} onClick={() => begin({ action: 'register', tag })}>태그 등록</button>
      <button type="button" disabled={busy || !!pending} onClick={() => begin({ action: 'match', tag, pallet })}>파렛트 매칭</button>
      <button type="button" disabled={busy || !!pending} onClick={() => begin({ action: 'load', pallet, item })}>품목 적재</button>
      <button type="button" disabled={busy || !!pending} onClick={() => begin({ action: 'in', pallet, eventId })}>수동 입고</button>
      <button type="button" disabled={busy || !!pending} onClick={() => begin({ action: 'out', pallet, eventId })}>수동 출고</button>
      {pending && <div>
        <p>응답 확인 대기 중인 명령 {pending.action}</p>
        <button type="button" disabled={busy} onClick={() => void execute(pending)}>동일 명령 재시도</button>
        <button type="button" disabled={busy} onClick={() => {
          clearPending()
          setNotice('저장한 재시도 요청을 지웠습니다. 서버에 반영된 변경은 유지됩니다.')
        }}>재시도 종료</button>
      </div>}
      <p role="status">{notice}</p>
      <p>합성 재고 증감 {state.netInventoryDelta}</p>
      <h3>이동 이력</h3>
      <ol>{state.history.map((row) => <li key={row.eventId}>
        {row.direction === 'IN' ? '입고' : '출고'} · {row.pallet} · {row.tag} · {row.items.join(', ')}
      </li>)}</ol>
      <RfidPhotos actor={actor} movementCount={state.history.length} onSessionExpired={onSessionExpired} />
    </section>
  )
}
