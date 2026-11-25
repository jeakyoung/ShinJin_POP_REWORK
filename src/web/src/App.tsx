import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import DemoLogin from './DemoLogin'
import WorkOrders from './WorkOrders'
import DrawingWork from './DrawingWork'
import Transfer from './Transfer'
import OutputPreview from './output/OutputPreview'
import Shipping from './Shipping'
import InventoryMoves from './InventoryMoves'
import RfidDemo from './RfidDemo'
import ProcurementReceiving from './procurement/ProcurementReceiving'
import { loadContext, loadSession, loadWorkHistory, SessionExpired, signOut } from './workHistoryApi'
import type { Identity, PopContext, WorkEntry } from './workHistoryApi'

type Result =
  | { state: 'idle' | 'loading' | 'error' }
  | { state: 'ready'; rows: WorkEntry[] }

const quantity = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 })

export default function App() {
  const [context, setContext] = useState<PopContext>()
  const [contextError, setContextError] = useState(false)
  const [contextAttempt, setContextAttempt] = useState(0)
  const [identity, setIdentity] = useState<Identity>()
  const [sessionNotice, setSessionNotice] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [view, setView] = useState<'history' | 'orders' | 'drawing' | 'transfer' | 'rfid' | 'shipping' | 'output' | 'procurement' | 'inventory'>('history')
  const [date, setDate] = useState('')
  const [result, setResult] = useState<Result>({ state: 'idle' })
  const activeSearch = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([loadContext(controller.signal), loadSession(controller.signal)]).then(([data, session]) => {
      if (controller.signal.aborted) return
      setContext(data)
      setIdentity(session)
      setDate(data.sampleDate)
    }).catch(() => {
      if (!controller.signal.aborted) setContextError(true)
    })
    return () => controller.abort()
  }, [contextAttempt])

  useEffect(() => () => activeSearch.current?.abort(), [])

  const clearResult = useCallback(() => {
    activeSearch.current?.abort()
    setResult({ state: 'idle' })
  }, [])

  const expireSession = useCallback(() => {
    setIdentity(undefined)
    setSessionNotice('세션이 만료되었습니다. 다시 로그인해 주세요.')
    clearResult()
  }, [clearResult])

  async function logout() {
    setLoggingOut(true)
    setSessionNotice('')
    clearResult()
    try {
      await signOut()
      setIdentity(undefined)
    } catch {
      setSessionNotice('로그아웃하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setLoggingOut(false)
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!identity || !date || loggingOut) return

    activeSearch.current?.abort()
    const controller = new AbortController()
    activeSearch.current = controller
    setResult({ state: 'loading' })
    try {
      const rows = await loadWorkHistory(date, controller.signal)
      if (!controller.signal.aborted) setResult({ state: 'ready', rows })
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof SessionExpired) {
        expireSession()
      } else {
        setResult({ state: 'error' })
      }
    } finally {
      if (activeSearch.current === controller) activeSearch.current = null
    }
  }

  return (
    <main>
      <header>
        <p className="system-name">신진 생산관리</p>
        <h1>{identity && view === 'inventory' ? '재고이동' : identity && view === 'procurement' ? 'ESCO·발주입고' : identity && view === 'output' ? '합성 출력' : identity && view === 'shipping' ? '출하' : identity && view === 'rfid' ? 'RFID·파렛트' : identity && view === 'transfer' ? '공장이송' : identity && view === 'drawing' ? '도면가공 008' : identity && view === 'orders' ? '작업지시' : '작업이력'}</h1>
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
      {sessionNotice && <p role="status" className="session-notice">{sessionNotice}</p>}
      {context && !identity && <DemoLogin context={context} onLogin={(session) => {
        setIdentity(session)
        setView('history')
        setSessionNotice('')
        setDate(context.sampleDate)
        clearResult()
      }} />}
      {context && identity && (
        <section aria-label="단말 및 메뉴">
          <div className="session-header">
            <div>
              <p>{identity.worker.name} · {identity.worker.department}</p>
              <p>{identity.terminal.factory} · {identity.terminal.workCenter} · {identity.terminal.name}</p>
            </div>
            <button type="button" disabled={loggingOut} onClick={logout}>로그아웃</button>
          </div>
          <nav aria-label="업무 화면" className="pop-nav">
            <button type="button" aria-pressed={view === 'history'} disabled={loggingOut} onClick={() => {
              setView('history')
            }}>작업이력</button>
            <button type="button" aria-pressed={view === 'orders'} disabled={loggingOut} onClick={() => {
              clearResult()
              setView('orders')
            }}>작업지시</button>
            <button type="button" aria-pressed={view === 'drawing'} disabled={loggingOut} onClick={() => {
              clearResult()
              setView('drawing')
            }}>도면가공 008</button>
            <button type="button" aria-pressed={view === 'transfer'} disabled={loggingOut} onClick={() => {
              clearResult()
              setView('transfer')
            }}>공장이송</button>
          <button type="button" aria-pressed={view === 'rfid'} disabled={loggingOut} onClick={() => { clearResult(); setView('rfid') }}>RFID·파렛트</button>
            <button type="button" aria-pressed={view === 'shipping'} disabled={loggingOut} onClick={() => {
              clearResult()
              setView('shipping')
            }}>출하</button>
            <button type="button" aria-pressed={view === 'output'} disabled={loggingOut} onClick={() => {
              clearResult()
              setView('output')
            }}>합성 출력</button>
            <button type="button" aria-pressed={view === 'procurement'} disabled={loggingOut} onClick={() => {
              clearResult()
              setView('procurement')
            }}>ESCO·발주입고</button>
            <button type="button" aria-pressed={view === 'inventory'} disabled={loggingOut} onClick={() => {
              clearResult()
              setView('inventory')
            }}>재고이동</button>
          </nav>
        </section>
      )}
      {context && identity && view === 'inventory' && !loggingOut && (
        <InventoryMoves key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          actor={{ terminal: identity.terminal.id, worker: identity.worker.id }}
          onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'shipping' && !loggingOut && (
        <Shipping key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          actor={{ terminal: identity.terminal.id, worker: identity.worker.id }}
          onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'procurement' && !loggingOut && (
        <ProcurementReceiving actor={{ terminalId: identity.terminal.id, workerId: identity.worker.id }}
          onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'output' && !loggingOut && (
        <OutputPreview key={JSON.stringify([identity.terminal.id, identity.worker.id])} onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'transfer' && !loggingOut && (
        <Transfer key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          actor={{ terminalId: identity.terminal.id, workerId: identity.worker.id }}
          onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'drawing' && !loggingOut && (
        <DrawingWork terminalId={identity.terminal.id} onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'orders' && !loggingOut && <WorkOrders actor={JSON.stringify([identity.terminal.id, identity.worker.id])} onSessionExpired={expireSession} />}
      {context && identity && view === 'rfid' && !loggingOut && (
        <RfidDemo key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          actor={JSON.stringify([identity.terminal.id, identity.worker.id])} onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'history' && (
        <section aria-labelledby="filter-title">
          <h2 id="filter-title">조회 조건</h2>
          <form onSubmit={search}>
            <label>작업일
              <input required type="date" value={date} onChange={(event) => { setDate(event.target.value); clearResult() }} />
            </label>
            <button disabled={!date || loggingOut || result.state === 'loading'}>조회</button>
          </form>
        </section>
      )}
      {context && identity && view === 'history' && (
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
