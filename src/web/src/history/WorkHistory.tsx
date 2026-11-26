import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { loadWorkHistory, SessionExpired } from '../workHistoryApi'
import type { WorkEntry, Worker } from '../workHistoryApi'
import HistoryDate from './HistoryDate'
import { localDate } from './localDate'
import './workHistory.css'

const captions = {
  customer: '거래처명',
  itemKind: '품목유형',
  partNo: '품목코드',
  plannedQuantity: '수주수량',
  movement: '입/출',
  processName: '공정',
  warehouse: '창고명',
  startedAt: '시작시간',
  finishedAt: '종료시간',
  orderNumber: '수주번호',
  material: '재질',
  thickness: '두께',
  width: '폭',
  length: '길이',
  actualQuantity: '입출수량',
} as const
type Column = keyof typeof captions
type Sort = { key: Column; direction: 1 | -1 }
const dimensions = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const quantity = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })
const collator = new Intl.Collator('ko-KR', { sensitivity: 'accent' })
const endColumns = ['movement', 'processName', 'warehouse', 'startedAt', 'finishedAt'] as const
const bottomColumns = ['orderNumber', 'material', 'thickness', 'width', 'length', 'actualQuantity'] as const
function formatted(row: WorkEntry, key: Column) {
  const v = row[key]
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (key === 'plannedQuantity') return Math.abs(v) < 0.005 ? '' : quantity.format(v)
  return (key === 'actualQuantity' ? integer : dimensions).format(v)
}
function compare(left: WorkEntry, right: WorkEntry, order: Sort[]) {
  for (const { key, direction } of order) {
    const a = left[key],
      b = right[key]
    if (a == null && b == null) continue
    const difference =
      a == null
        ? -1
        : b == null
          ? 1
          : typeof a === 'number' && typeof b === 'number'
            ? a - b
            : collator.compare(String(a), String(b))
    if (difference) return difference * direction
  }
  return 0
}

export default function WorkHistory({
  worker,
  onSessionExpired,
}: {
  worker: Worker
  onSessionExpired: () => void
}) {
  const [date, setDate] = useState(() => localDate(new Date()))
  const [rows, setRows] = useState<WorkEntry[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sort, setSort] = useState<Sort[]>([])
  const [group, setGroup] = useState<string>()
  const [focus, setFocus] = useState<string>()
  const [loadedDate, setLoadedDate] = useState('')
  const pending = useRef<AbortController | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const initial = useRef(date)
  const query = useCallback(
    async (day: string) => {
      pending.current?.abort()
      const controller = new AbortController()
      pending.current = controller
      setState('loading')
      try {
        const next = await loadWorkHistory(day, controller.signal)
        if (controller.signal.aborted) return
        setRows(next)
        setLoadedDate(day)
        setFocus(undefined)
        setGroup(undefined)
        setState('ready')
        if (grid.current) grid.current.scrollTop = 0
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof SessionExpired) onSessionExpired()
        else setState('error')
      } finally {
        if (pending.current === controller) pending.current = null
      }
    },
    [onSessionExpired],
  )
  useEffect(() => {
    void query(initial.current)
    return () => pending.current?.abort()
  }, [query])
  const ordered = useMemo(
    () => (sort.length ? [...rows].sort((a, b) => compare(a, b, sort)) : rows),
    [rows, sort],
  )
  const focusId = focus ?? ordered[0]?.id
  function pick(row: WorkEntry) {
    setFocus(row.id)
    setGroup(row.productionGroup ?? '')
  }
  function keyPick(e: KeyboardEvent<HTMLTableSectionElement>, row: WorkEntry) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(row)
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const peer =
        e.key === 'ArrowUp' ? e.currentTarget.previousElementSibling : e.currentTarget.nextElementSibling
      if (peer instanceof HTMLElement && peer.tagName === 'TBODY') {
        e.preventDefault()
        peer.focus()
      }
    }
  }
  function header(key: Column, span = 1, across = 1) {
    const current = sort.find((s) => s.key === key)
    return (
      <th
        key={key}
        data-key={key}
        rowSpan={span}
        colSpan={across}
        aria-sort={current ? (current.direction === 1 ? 'ascending' : 'descending') : undefined}
      >
        <button
          type="button"
          onClick={(e) => {
            setFocus(focusId)
            const keep = e.shiftKey || e.ctrlKey
            setSort((old) => {
              const previous = old.find((s) => s.key === key)
              if (e.ctrlKey) return old.filter((s) => s.key !== key)
              const replacement: Sort = { key, direction: previous?.direction === 1 ? -1 : 1 }
              if (!keep) return [replacement]
              return previous ? old.map((s) => (s.key === key ? replacement : s)) : [...old, replacement]
            })
          }}
        >
          {captions[key]}
          {current && <span aria-hidden="true">{current.direction === 1 ? ' ▴' : ' ▾'}</span>}
        </button>
      </th>
    )
  }
  return (
    <section className="history-screen" aria-label="작업실적조회">
      <div className="history-viewport">
        <div className="history-form">
          <div className="history-filters">
            <span className="history-date-label">수주일</span>
            <HistoryDate value={date} onChange={setDate} />
            <span className="history-dept-label">부서</span>
            <output className="history-dept">{worker.department}</output>
            <span className="history-worker-label">작업자</span>
            <output className="history-worker">{worker.name}</output>
            <button
              className="history-search"
              disabled={state === 'loading'}
              onClick={() => void query(date)}
            >
              조회
            </button>
          </div>
          <div ref={grid} className="history-grid" aria-busy={state === 'loading'}>
            <table aria-label="작업실적">
              <colgroup>
                {[50, 160, 150, 80, 80, 120, 80, 80, 80, 150, 100, 100, 40].map((width, i) => (
                  <col key={i} style={{ width }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2}>No</th>
                  {header('customer')}
                  {header('itemKind')}
                  {header('partNo', 1, 3)}
                  {header('plannedQuantity')}
                  {endColumns.map((k) => header(k, 2))}
                  <th aria-hidden="true" rowSpan={2} />
                </tr>
                <tr>{bottomColumns.map((k) => header(k))}</tr>
              </thead>
              {ordered.map((row, i) => (
                <tbody
                  key={row.id}
                  tabIndex={focusId === row.id ? 0 : -1}
                  aria-label={row.orderNumber + ' ' + row.movement}
                  data-group={
                    group === undefined ? row.checked === 'Y' : group === (row.productionGroup ?? '')
                  }
                  data-focus={focusId === row.id}
                  data-movement={row.movement}
                  onFocus={() => setFocus(row.id)}
                  onClick={() => pick(row)}
                  onKeyDown={(e) => keyPick(e, row)}
                >
                  <tr>
                    <td rowSpan={2}>{i + 1}</td>
                    <td>{row.customer}</td>
                    <td>{row.itemKind}</td>
                    <td colSpan={3}>{row.partNo}</td>
                    <td className="history-plan-qty">{formatted(row, 'plannedQuantity')}</td>
                    {endColumns.map((k) => (
                      <td key={k} data-field={k} rowSpan={2}>
                        {formatted(row, k)}
                      </td>
                    ))}
                    <td rowSpan={2} />
                  </tr>
                  <tr>
                    {bottomColumns.map((k) => (
                      <td data-field={k} key={k}>
                        {formatted(row, k)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              ))}
            </table>
          </div>
          {state === 'error' && (
            <p role="alert">
              작업실적을 조회하지 못했습니다. 다시 조회해 주세요.
              {loadedDate && ' 마지막 조회일 ' + loadedDate}
            </p>
          )}
          <p className="history-sr" role="status">
            {state === 'loading'
              ? '조회 중'
              : state === 'ready'
                ? rows.length
                  ? rows.length + '건'
                  : '조회 결과가 없습니다.'
                : ''}
          </p>
        </div>
      </div>
    </section>
  )
}
