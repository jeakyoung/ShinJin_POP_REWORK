import './pop-form-frame.css'
import { Fragment, useEffect, useRef, useState } from 'react'
import { appendPlan, bands, emptyReport, parsePlan } from './production-report'
import type { ProductionRow } from './production-report'
import { exportProductionXlsx } from './production-xlsx'
import './FinalProductionReport.css'

type Props = { onExport: (bytes: Uint8Array, name: string) => Promise<'saved' | 'download'>; onSessionExpired: () => void }

export default function FinalProductionReport({ onExport, onSessionExpired }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')
  const [report, setReport] = useState(emptyReport)
  const grid = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, limit: 0 })
  useEffect(() => {
    const element = grid.current
    if (!element) return
    const measure = () => setScroll({ top: element.scrollTop, limit: Math.max(0,element.scrollHeight - element.clientHeight) })
    const bounds = new ResizeObserver(measure)
    bounds.observe(element)
    if (element.firstElementChild) bounds.observe(element.firstElementChild)
    element.addEventListener('scroll',measure)
    return () => { bounds.disconnect(); element.removeEventListener('scroll',measure) }
  }, [])

  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<number>()
  const [saving, setSaving] = useState(false)
  const exporting = useRef(false)
  const active = useRef<AbortController | null>(null)
  const queued = useRef(new Set<string>())
  const displayed = useRef(new Set<string>())
  useEffect(() => () => active.current?.abort(), [])

  function clearInput() {
    setCode('')
    input.current?.focus()
  }
  async function query() {
    const plan = parsePlan(code)
    clearInput()
    setNotice('')
    if (!plan || displayed.current.has(plan) || queued.current.has(plan)) return
    queued.current.add(plan)
    if (active.current) return
    const request = new AbortController()
    active.current = request
    try {
      for (const next of queued.current) {
        const [date, sequence] = next.split('-')
        const parameters = new URLSearchParams({ date: date.slice(0,4) + '-' + date.slice(4,6) + '-' + date.slice(6), sequence })
        const response = await fetch('/api/pop/production-report?' + parameters, { cache: 'no-store', signal: request.signal })
        if (request.signal.aborted) return
        if (response.status === 401) { onSessionExpired(); return }
        if (!response.ok) throw new Error('report unavailable')
        const rows: ProductionRow[] = await response.json()
        if (request.signal.aborted) return
        if (rows.some(row => row.plan === next)) {
          displayed.current.add(next)
          setReport(prev => appendPlan(prev, date + sequence, rows).report)
          setSelected(prev => prev ?? 1)
        }
        queued.current.delete(next)
      }
    } catch {
      if (!request.signal.aborted) setNotice('조회 결과를 불러오지 못했습니다.')
    } finally {
      if (active.current === request) { active.current = null; queued.current.clear(); input.current?.focus() }
    }
  }
  async function save() {
    if (exporting.current || !report.rows.length) return
    exporting.current = true
    setSaving(true)
    setNotice('')
    try {
      const bytes = exportProductionXlsx(report)
      if (bytes && await onExport(bytes, 'ProductionData.xlsx') === 'saved') setNotice('저장이 완료 되었습니다.')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('엑셀 저장 중 오류가 발생했습니다.')
    } finally {
      exporting.current = false
      setSaving(false)
    }
  }
  return <section className="final-production" aria-label="최종생산조회">
    <form onSubmit={event => { event.preventDefault(); void query() }}>
      <input ref={input} aria-label="작업지시번호" placeholder="작업지시번호 스캔" value={code}
        inputMode="numeric" enterKeyHint="go" autoComplete="off" onChange={event => setCode(event.target.value)} />
      <button type="submit" hidden>조회</button>
      <button type="button" onClick={clearInput}>Clear</button>
      <button type="button" onClick={() => {
        active.current?.abort(); active.current = null; queued.current.clear(); displayed.current.clear()
        setReport(emptyReport); setSelected(undefined); setNotice(''); clearInput()
      }}>All Clear</button>
      <button type="button" onClick={() => void save()} disabled={saving}>엑셀저장</button>
    </form>
    <div className="production-scroll-frame"><div className="final-production-grid" ref={grid}><table aria-label="최종생산 조회 결과">
      <colgroup>{[75,150,75,100,120,200,70,70,246,119,40].map((width,i) =>
        <col key={i} style={{ width: (width / 1265 * 100) + '%' }} />)}</colgroup>
      <thead>{bands.map((tier, level) => <tr key={level}>{tier.map(cell =>
        <th key={cell.column} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>{cell.title}</th>)}</tr>)}</thead>
      <tbody>{report.rows.map(row => <Fragment key={row.index}>{bands.map((tier, level) =>
        <tr key={level} className={selected === row.index ? 'selected' : undefined} tabIndex={level === 0 ? 0 : undefined}
          onFocus={() => setSelected(row.index)} onClick={() => setSelected(row.index)}>{tier.map(cell =>
            <td key={cell.column} rowSpan={cell.rowSpan} colSpan={cell.colSpan} className={cell.key ?? 'spacer'}>
              {cell.key && row[cell.key]}</td>)}</tr>)}</Fragment>)}</tbody>
    </table></div>
      <div className="production-scrollbar"><button type="button" aria-label="위로 스크롤" disabled={!scroll.top}
        onClick={() => grid.current?.scrollBy({ top: -73 })}>▴</button>
        <input type="range" aria-label="조회 결과 스크롤" min={0} max={scroll.limit} value={scroll.top} disabled={!scroll.limit}
          onChange={e => grid.current?.scrollTo({ top: Number(e.target.value) })}/>
        <button type="button" aria-label="아래로 스크롤" disabled={scroll.top >= scroll.limit}
          onClick={() => grid.current?.scrollBy({ top: 73 })}>▾</button></div></div>
    <p role="status">{notice}</p>
  </section>
}
