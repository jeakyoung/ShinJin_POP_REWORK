import { useEffect, useRef, useState } from 'react'
import { SessionExpired } from '../workHistoryApi'
import { loadRepairs, ManagementError } from './managementApi'
import type { Repair, RepairStatus } from './managementApi'

export default function RepairHistory({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<RepairStatus>('ALL')
  const [rows, setRows] = useState<Repair[]>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController | null>(null)

  useEffect(() => {
    const request = new AbortController()
    loadRepairs('', '', 'ALL', request.signal).then((page) => {
      if (request.signal.aborted) return
      setFrom(page.from)
      setTo(page.to)
      setRows(page.rows)
    }).catch((error: unknown) => {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setNotice('수리내역을 조회하지 못했습니다.')
    })
    return () => { request.abort(); active.current?.abort() }
  }, [onSessionExpired])

  async function search() {
    if (active.current || !from || !to) return
    if (from > to) {
      setRows(undefined)
      setNotice('시작일은 종료일과 같거나 이전이어야 합니다.')
      return
    }
    const request = new AbortController()
    active.current = request
    setBusy(true)
    setNotice('')
    setRows(undefined)
    try {
      const page = await loadRepairs(from, to, status, request.signal)
      if (!request.signal.aborted) setRows(page.rows)
    } catch (error) {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setNotice(error instanceof ManagementError && error.message === 'INVALID_REPAIR_FILTER'
        ? '수리내역 조회 기간을 확인하세요.' : '수리내역을 조회하지 못했습니다.')
    } finally {
      active.current = null
      if (!request.signal.aborted) setBusy(false)
    }
  }

  return (
    <section aria-label="설비수리 내역">
      <h2>설비수리 내역</h2>
      <form onSubmit={(event) => { event.preventDefault(); void search() }}>
        <label>시작일<input type="date" required value={from} disabled={busy} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>종료일<input type="date" required value={to} disabled={busy} onChange={(event) => setTo(event.target.value)} /></label>
        <label>완료 여부<select value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as RepairStatus)}>
          <option value="ALL">전체</option><option value="COMPLETE">완료</option><option value="OPEN">미완료</option>
        </select></label>
        <button type="submit" disabled={busy}>수리내역 조회</button>
      </form>
      <p role="status">{busy ? '조회 중입니다.' : notice || (rows && !rows.length ? '조건에 맞는 수리내역이 없습니다.' : '')}</p>
      {!!rows?.length && <div className="table-scroll"><table>
        <thead><tr><th scope="col">접수번호</th><th scope="col">설비</th><th scope="col">접수 사유</th>
          <th scope="col">접수일</th><th scope="col">완료일</th><th scope="col">처리 결과</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.issue}>
          <th scope="row">{row.issue}</th><td>{row.equipment}</td><td>{row.reason}</td>
          <td>{row.opened}</td><td>{row.closed ?? '—'}</td><td>{row.result ?? '미완료'}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  )
}
