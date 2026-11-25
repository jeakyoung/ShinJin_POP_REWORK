import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { loadContext, loadWorkHistory } from './workHistoryApi'
import type { PopContext, WorkEntry } from './workHistoryApi'

type Result =
  | { state: 'idle' | 'loading' | 'error' }
  | { state: 'ready'; rows: WorkEntry[] }

const quantity = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 })

export default function App() {
  const [context, setContext] = useState<PopContext>()
  const [contextError, setContextError] = useState(false)
  const [contextAttempt, setContextAttempt] = useState(0)
  const [terminalId, setTerminalId] = useState('')
  const [workerId, setWorkerId] = useState('')
  const [date, setDate] = useState('')
  const [result, setResult] = useState<Result>({ state: 'idle' })
  const activeSearch = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    loadContext(controller.signal).then((data) => {
      if (controller.signal.aborted) return
      const first = data.terminals[0]
      setContext(data)
      setTerminalId(first?.id ?? '')
      setWorkerId(first?.workers[0]?.id ?? '')
      setDate(data.sampleDate)
    }).catch(() => {
      if (!controller.signal.aborted) setContextError(true)
    })
    return () => controller.abort()
  }, [contextAttempt])

  useEffect(() => () => activeSearch.current?.abort(), [])

  const terminal = context?.terminals.find((item) => item.id === terminalId)
  const worker = terminal?.workers.find((item) => item.id === workerId)

  function clearResult() {
    activeSearch.current?.abort()
    setResult({ state: 'idle' })
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!terminal || !worker || !date) return

    activeSearch.current?.abort()
    const controller = new AbortController()
    activeSearch.current = controller
    setResult({ state: 'loading' })
    try {
      const rows = await loadWorkHistory({ terminalId, workerId, date }, controller.signal)
      if (!controller.signal.aborted) setResult({ state: 'ready', rows })
    } catch {
      if (!controller.signal.aborted) setResult({ state: 'error' })
    } finally {
      if (activeSearch.current === controller) activeSearch.current = null
    }
  }

  return (
    <main>
      <header>
        <p className="system-name">신진 생산관리</p>
        <h1>작업이력</h1>
        <p>합성 데이터로 조회 흐름을 확인하는 화면입니다.</p>
      </header>
      {!context && (
        <section aria-live="polite">
          {contextError ? (
            <>
              <p>단말 설정을 불러오지 못했습니다.</p>
              <button onClick={() => {
                setContextError(false)
                setContextAttempt((value) => value + 1)
              }}>다시 불러오기</button>
            </>
          ) : <p>단말 설정을 불러오는 중입니다.</p>}
        </section>
      )}
      {context && (
        <section aria-labelledby="filter-title">
          <h2 id="filter-title">조회 조건</h2>
          <form onSubmit={search}>
            <label>POP 단말
              <select value={terminalId} onChange={(event) => {
                const next = context.terminals.find((item) => item.id === event.target.value)
                setTerminalId(event.target.value)
                setWorkerId(next?.workers[0]?.id ?? '')
                clearResult()
              }}>
                {context.terminals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>작업자
              <select value={workerId} onChange={(event) => { setWorkerId(event.target.value); clearResult() }}>
                {terminal?.workers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>작업일
              <input required type="date" value={date} onChange={(event) => { setDate(event.target.value); clearResult() }} />
            </label>
            <button disabled={!worker || !date || result.state === 'loading'}>조회</button>
          </form>
          {terminal && <p className="context">{terminal.factory} · {terminal.workCenter} · {worker?.department}</p>}
        </section>
      )}
      {context && (
        <section aria-labelledby="results-title">
          <h2 id="results-title">조회 결과</h2>
          <p role="status">
            {result.state === 'idle' && '조회 버튼을 누르면 작업이력을 표시합니다.'}
            {result.state === 'loading' && '작업이력을 조회 중입니다.'}
            {result.state === 'error' && '작업이력을 불러오지 못했습니다. 다시 조회해 주세요.'}
            {result.state === 'ready' && (result.rows.length === 0 ? '조건에 맞는 작업이력이 없습니다.' : `${result.rows.length}건`)}
          </p>
          {result.state === 'ready' && result.rows.length > 0 && (
            <div className="table-scroll">
              <table aria-labelledby="results-title">
                <thead><tr>
                  <th scope="col">수주번호</th><th scope="col">품목</th><th scope="col">공정</th>
                  <th scope="col" className="numeric">계획</th><th scope="col" className="numeric">실적</th>
                  <th scope="col">구분</th><th scope="col">창고</th><th scope="col">작업시간</th>
                </tr></thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.orderNumber}</td><td>{row.itemName}</td><td>{row.processName}</td>
                      <td className="numeric">{quantity.format(row.plannedQuantity)}</td>
                      <td className="numeric">{quantity.format(row.actualQuantity)}</td>
                      <td>{row.movement}</td><td>{row.warehouse}</td><td>{row.startedAt}–{row.finishedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
