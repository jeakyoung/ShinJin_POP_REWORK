import '../pop-form-frame.css'
import { useEffect, useRef, useState } from 'react'
import { SessionExpired } from '../workHistoryApi'
import { loadRepairs, ManagementError } from './managementApi'
import type { Repair, RepairStatus } from './managementApi'
import HistoryDate from '../history/HistoryDate'
import '../history/workHistory.css'
import './RepairHistory.css'

const states = { ALL: ['000', '전체'], COMPLETE: ['001', '완료'], OPEN: ['002', '미완료'] } as const
const headings = ['순번', '설비명', '이슈 번호', '이슈 내용', '이슈 발생자', '경과 시간', '이슈 발생일시', '이슈 해결내용', '이슈 해결자', '이슈 해결일시']
const collate = new Intl.Collator('ko', { numeric: true })
function cells(row: Repair) {
  const detail = row.detail
  return [detail?.sequence ?? '', detail?.equipmentName ?? row.equipment, row.issue, row.reason, detail?.reporter ?? '',
    detail?.elapsedHours ?? '', [row.opened, detail?.openedTime].filter(Boolean).join(' '), row.result ?? '',
    detail?.resolver ?? '', [row.closed, detail?.closedTime].filter(Boolean).join(' ')]
}

export default function RepairHistory({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<RepairStatus>('ALL')
  const [rows, setRows] = useState<Repair[]>()
  const [selection, setSelection] = useState('')
  const [sort, setSort] = useState<{ index: number; descending: boolean }>()
  const [busy, setBusy] = useState(true)
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController | null>(null)
  const picker = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const request = new AbortController()
    loadRepairs('', '', 'ALL', request.signal).then(page => {
      if (request.signal.aborted) return
      setFrom(page.from)
      setTo(page.to)
      setRows(page.rows)
      setSelection(page.rows[0]?.issue ?? '')
    }).catch((error: unknown) => {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setNotice('수리내역을 조회하지 못했습니다.')
    }).finally(() => { if (!request.signal.aborted) setBusy(false) })
    return () => { request.abort(); active.current?.abort() }
  }, [onSessionExpired])

  async function search() {
    if (active.current) return
    const request = new AbortController()
    active.current = request
    setBusy(true)
    setNotice('')
    try {
      const page = await loadRepairs(from, to, status, request.signal)
      if (!request.signal.aborted) {
        setRows(page.rows); setFrom(page.from); setTo(page.to); setSelection(page.rows[0]?.issue ?? '')
      }
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

  const ordered = (rows ?? []).map(row => ({ row, values: cells(row) }))
  if (sort) ordered.sort((a, b) => collate.compare(String(a.values[sort.index]), String(b.values[sort.index])) * (sort.descending ? -1 : 1))

  return <section className="repair-history" aria-label="설비 수리내역">
    <form onSubmit={event => { event.preventDefault(); void search() }}>
      <span>수리 요청일</span><HistoryDate className="repair-date" label="시작일" value={from} disabled={busy}
        onChange={date => {
          if (to && date > to) setNotice('시작일은 종료일 보다 같거나 작아야 합니다.')
          else { setNotice(''); setFrom(date) }
        }} />
      <b aria-hidden="true">~</b><HistoryDate className="repair-date" label="종료일" value={to} disabled={busy}
        onChange={date => {
          if (from && date < from) setNotice('종료일은 시작일 보다 같거나 커야 합니다.')
          else { setNotice(''); setTo(date) }
        }} />
      <span>완료여부</span><button type="button" aria-label="완료여부 선택" disabled={busy}
        onClick={() => picker.current?.showModal()}>{states[status][1]} <i aria-hidden="true">⌕</i></button>
      <button type="submit" disabled={busy}>조회</button>
    </form>
    <div className="repair-grid">
      <table><colgroup>{[61,99,100,181,102,49,124,213,133,124].map((width,i)=><col key={i} style={{width: (width / 1186 * 100) + '%'}}/>)}</colgroup><thead><tr>{headings.map((heading, i) =>
        <th key={heading} scope="col" aria-sort={sort?.index === i ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
          <button onClick={() => setSort({ index: i, descending: sort?.index === i && !sort.descending })} aria-label={heading}>{heading.split(' ').map(part => <span key={part}>{part}</span>)}</button>
        </th>)}</tr></thead>
        <tbody>{ordered.map(({ row, values }) => <tr key={row.issue} tabIndex={0}
          className={selection === row.issue ? 'selected' : undefined}
          onFocus={() => setSelection(row.issue)} onClick={() => setSelection(row.issue)}>
          {values.map((value, index) => <td key={headings[index]}
            className={index === 5 && !row.closed ? 'open-hours' : undefined}>{value}</td>)}
        </tr>)}</tbody></table>
    </div>
    <p role="status">{busy ? '조회 중입니다.' : notice || (rows && !rows.length ? '조건에 맞는 수리내역이 없습니다.' : '')}</p>
    <dialog ref={picker} aria-label="완료여부 목록"><table><thead><tr><th>코드</th><th>완료여부</th></tr></thead>
      <tbody>{(Object.keys(states) as RepairStatus[]).map(value => <tr key={value}><td>{states[value][0]}</td>
        <td><button type="button" onClick={() => { setStatus(value); picker.current?.close() }}>{states[value][1]}</button></td></tr>)}</tbody>
    </table><button type="button" onClick={() => picker.current?.close()}>닫기</button></dialog>
  </section>
}
