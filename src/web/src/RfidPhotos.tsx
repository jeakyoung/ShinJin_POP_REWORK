import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type PhotoEvent = {
  eventId: string
  kind: string
  pallet: string
  tag: string
  readOnly: boolean
  revision: number
  samples: string[]
}

const base = '/api/pop/rfid/photos'
const samples = ['grid', 'stripes']

function preview(sample: string) {
  return base + '/samples/' + encodeURIComponent(sample)
}

export default function RfidPhotos({ actor, movementCount, onSessionExpired }: {
  actor: string
  movementCount: number
  onSessionExpired: () => void
}) {
  const [events, setEvents] = useState<PhotoEvent[]>()
  const [selected, setSelected] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [notice, setNotice] = useState('')
  const event = events?.find(row => row.eventId === selected)

  useEffect(() => {
    const request = new AbortController()
    fetch(base, { signal: request.signal }).then(async (response) => {
      if (request.signal.aborted) return
      if (response.status === 401) return onSessionExpired()
      if (!response.ok) throw new Error()
      const rows: PhotoEvent[] = await response.json()
      if (!request.signal.aborted) {
        setEvents(current => rows.map(row => {
          const known = current?.find(item => item.eventId === row.eventId)
          return known && known.revision > row.revision ? known : row
        }))
        setNotice('')
      }
    }).catch(() => {
      if (!request.signal.aborted) setNotice('사진 이력을 불러오지 못했습니다.')
    })
    return () => request.abort()
  }, [movementCount, onSessionExpired, refresh])

  return <section aria-labelledby="rfid-photo-title">
    <h3 id="rfid-photo-title">RFID 사진</h3>
    <label>사진 이벤트<select value={selected} onChange={e => setSelected(e.target.value)}>
      <option value="">선택</option>
      {events?.map(row => <option key={row.eventId} value={row.eventId}>
        {row.kind} · {row.pallet} · {row.tag} · {row.eventId}
      </option>)}
    </select></label>
    <button type="button" onClick={() => setRefresh(value => value + 1)}>사진 이력 다시 조회</button>
    {events?.length === 0 && <p>조회할 사진 이벤트가 없습니다.</p>}
    {notice && <p role="status">{notice}</p>}
    {event && <EventPhotos key={JSON.stringify([actor, event.eventId])} event={event}
      storageKey={'synthetic-rfid-photo:' + JSON.stringify([actor, event.eventId])} onSessionExpired={onSessionExpired}
      onUpdated={updated => setEvents(rows => rows?.map(row =>
        row.eventId === updated.eventId && row.revision <= updated.revision ? updated : row))} />}
  </section>
}

function readPending(key: string) {
  try { return sessionStorage.getItem(key) } catch { return null }
}

function EventPhotos({ event, storageKey, onUpdated, onSessionExpired }: {
  event: PhotoEvent
  storageKey: string
  onUpdated: (event: PhotoEvent) => void
  onSessionExpired: () => void
}) {
  const [sample, setSample] = useState('')
  const [pending, setPending] = useState(() => readPending(storageKey))
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const request = useRef<AbortController | null>(null)
  useLayoutEffect(() => () => request.current?.abort(), [])

  function begin() {
    if (request.current || pending || !confirmed || !sample || event.readOnly) return
    const body = JSON.stringify({ requestId: crypto.randomUUID(), sampleId: sample, revision: event.revision, confirmed })
    try { sessionStorage.setItem(storageKey, body) } catch {
      setNotice('\uCCA8\uBD80 \uC694\uCCAD\uC744 \uBCF4\uC874\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.')
      return
    }
    setPending(body)
    void attach(body)
  }

  async function attach(body: string) {
    if (request.current || event.readOnly) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      const response = await fetch(base + '/events/' + encodeURIComponent(event.eventId), {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (controller.signal.aborted) return
      if (response.status === 401) return onSessionExpired()
      if (response.status >= 500) throw new Error()
      const reply: { code: string; event?: PhotoEvent } = await response.json()
      if (controller.signal.aborted) return
      if (typeof reply.code !== 'string') throw new Error()
      if (readPending(storageKey) === body) sessionStorage.removeItem(storageKey)
      setPending(readPending(storageKey))
      if (reply.event) onUpdated(reply.event)
      if (response.ok) setSample('')
      setConfirmed(false)
      setNotice(response.ok ? '합성 사진을 첨부했습니다.' : '첨부 요청이 거절됐습니다. 현재 사진과 상태를 확인하세요.')
    } catch {
      if (!controller.signal.aborted) setNotice('첨부 결과를 확인하지 못했습니다. 이벤트를 다시 조회하세요.')
    } finally {
      request.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return <>
    <p>{event.readOnly ? '읽기 전용 사진' : '첨부 사진'} ({event.samples.length})</p>
    {event.samples.map(id => <img key={id} src={preview(id)} alt={'첨부 샘플 ' + id} width={160} height={96} />)}
    {!event.readOnly && <>
      <label>합성 샘플<select value={sample} disabled={busy || !!pending} onChange={e => {
        setSample(e.target.value)
        setConfirmed(false)
        setNotice('')
      }}>
        <option value="">선택</option>
        {samples.map(id => <option key={id} value={id} disabled={event.samples.includes(id)}>{id}</option>)}
      </select></label>
      {sample && <img src={preview(sample)} alt="선택한 합성 샘플" width={160} height={96} />}
      <label><input type="checkbox" checked={confirmed} disabled={!sample || busy || !!pending}
        onChange={e => setConfirmed(e.target.checked)} />이 이벤트에 첨부 확인</label>
      <button type="button" disabled={!confirmed || busy || !!pending || event.samples.includes(sample)} onClick={begin}>
        합성 사진 첨부
      </button>
    </>}
    {pending && <button type="button" disabled={busy} onClick={() => void attach(pending)}>
      동일 사진 첨부 재시도
    </button>}
    {notice && <p role="status">{notice}</p>}
  </>
}
