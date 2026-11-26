import { useCallback, useEffect, useRef, useState } from 'react'
import WorkHistory from './history/WorkHistory'
import DemoLogin from './DemoLogin'
import WorkplaceClock from './WorkplaceClock'
import './workplaceFrame.css'
import WorkOrders from './WorkOrders'
import { canOpenProcessLot } from './processLot/processLotAccess'
import MachineCalls from './machine/MachineCalls'
import DrawingWork from './DrawingWork'
import PackingWork from './packing/PackingWork'
import Transfer from './Transfer'
import WorkPrint from './workprint/WorkPrint'
import EmployeePrint from './employeePrint/EmployeePrint'
import OutputPreview from './output/OutputPreview'
import Shipping from './Shipping'
import ProductionReportPage from './ProductionReportPage'
import Planning from './Planning'
import WorkBasket from './WorkBasket'
import ProcessGroupDemo from './ProcessGroupDemo'
import InventoryMoves from './InventoryMoves'
import RfidDemo from './RfidDemo'
import ProcurementReceiving from './procurement/ProcurementReceiving'
import { loadContext, loadSession, signOut } from './workHistoryApi'
import type { Identity, PopContext } from './workHistoryApi'
import Expendables from './management/Expendables'
import RepairHistory from './management/RepairHistory'

const menu = {
  생산: [
    ['orders', '작업지시', 'Process1_On_Icon'], ['basket', '003/103 장바구니', null],
    ['packing', '포장', 'Process6_On_Icon'], ['drawing', '도면가공', 'Process6_On_Icon'], ['history', '작업실적조회', 'Print1_On_Icon'],
    ['planning', '생산계획', null], ['process-group', '그룹 작업', null],
  ],
  물류: [
    ['transfer', '공장이송의뢰', 'Shipment1_On_Icon'], ['transferShip', '공장이송출고', 'Shipment4_On_Icon'],
    ['transferReceive', '공장이송입고', 'Shipment5_On_Icon'], ['procurement', 'ESCO 입고', 'Shipment5_On_Icon'],
    ['purchase', '발주입고', 'Shipment5_On_Icon'], ['inventory', '재고이동', 'Shipment6_On_Icon'],
    ['shipping', '출하', 'Shipment4_On_Icon'], ['transferQuick', '간편공장이송', 'Shipment5_On_Icon'],
  ],
  RFID: [
    ['rfid', 'TAG 등록', 'TagReg_In'], ['rfidMatch', '파렛트 매칭', 'PalletMatch_In'],
    ['rfidLoad', '파렛트 적재', 'PalletBox_In'], ['rfidMove', '입출고 수동등록', 'TagInOutReg_In'],
    ['rfidHistory', '입출고 현황', 'TagInOutList_In'],
  ],
  관리: [
    ['repairs', '설비 수리내역', 'Mng2_On_Icon'], ['supplies', '소모품 요청', 'expendables'],
    ['production-report', '최종생산조회', 'Process7_On_Icon'],
  ],
  인쇄: [['workPrint', '작업지시서', 'Print1_On_Icon'], ['employee-print', '사원번호 인쇄', 'OpmanBarCode_On']],
} as const
type Category = keyof typeof menu
type View = 'home' | 'output' | (typeof menu)[Category][number][0]
const processNames = ['폭 절단', '평탄', '평면', '측면', '길이절단'] as const
const categories: Category[] = ['생산', '물류', 'RFID', '관리', '인쇄']

export default function App() {
  const [context, setContext] = useState<PopContext>()
  const [sessionChecked, setSessionChecked] = useState(false)
  const [contextError, setContextError] = useState(false)
  const [contextAttempt, setContextAttempt] = useState(0)
  const [identity, setIdentity] = useState<Identity>()
  const [sessionNotice, setSessionNotice] = useState('')
  const [returnedFromMain, setReturnedFromMain] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [employeeEntry,setEmployeeEntry]=useState(false)
  const [view, setView] = useState<View>('home')
  const [processTitle, setProcessTitle] = useState<string>()
  const [processSlot, setProcessSlot] = useState<number>()
  const [category, setCategory] = useState<Category>('생산')
  const logoutDialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    loadSession(controller.signal).then(session => {
      if (controller.signal.aborted) return
      setSessionChecked(true)
      setIdentity(session)
      setView(session && new URLSearchParams(window.location.search).get('diagnostic')==='output'?'output':session?.initialView??'home')
      setProcessSlot(session?.processSlots?.length === 1 ? session.processSlots[0] : undefined)
      setProcessTitle(session?.processSlots?.length === 1 ? session.workNames?.[session.processSlots[0]] : undefined)
    }).catch(() => {
      if (!controller.signal.aborted) setContextError(true)
    })
    return () => controller.abort()
  }, [contextAttempt])

  useEffect(() => {
    if (!identity) return
    const controller = new AbortController()
    loadContext(controller.signal).then(data => {
      if (!controller.signal.aborted) setContext(data)
    }).catch(() => {
      if (!controller.signal.aborted) setContextError(true)
    })
    return () => controller.abort()
  }, [identity, contextAttempt])

  const expireSession = useCallback(() => {
    setEmployeeEntry(false)
    setIdentity(undefined)
    setContext(undefined)
    setSessionNotice('세션이 만료되었습니다. 다시 로그인해 주세요.')
  }, [])

  function returnHome() {
    setEmployeeEntry(false)
    setProcessTitle(undefined)
    setView('home')
  }
  async function logout() {
    setLoggingOut(true)
    setSessionNotice('')
    try {
      await signOut()
      setReturnedFromMain(true)
      setContext(undefined)
      setEmployeeEntry(false)
      setIdentity(undefined)
    } catch {
      setSessionNotice('로그아웃하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <main className="pop-shell">
      {identity ? <>
        <header className="authenticated-bar" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}shell/panel1.png)` }}>
          <div className="bar-company"><img src={`${import.meta.env.BASE_URL}shell/panel4.png`} alt="" />
            <strong>(주)신진에스엠</strong></div>
          <div className="bar-worker"><span>담당자</span>
            <strong>{identity.worker.name} {identity.worker.department}</strong></div>
          <h1>{view === 'home' ? 'Smart POP시스템' : (view==='output'?'출력 미리보기':processTitle ?? menu[category].find(([key]) => key === view)?.[1])}</h1>
          <WorkplaceClock />
          <div className="bar-actions">
            <button type="button" aria-label="메뉴 복귀" title="메뉴 복귀" disabled={loggingOut}
              onClick={returnHome}>
              <img src={`${import.meta.env.BASE_URL}shell/pnHome.png`} alt="" /></button>
            <button type="button" aria-label="로그아웃" title="로그아웃" disabled={loggingOut}
              onClick={() => logoutDialog.current?.showModal()}>
              <img src={`${import.meta.env.BASE_URL}shell/pnLogout.png`} alt="" /></button>
          </div>
        </header>
        <dialog ref={logoutDialog} className="logout-confirm" aria-labelledby="logout-prompt">
          <p id="logout-prompt">로그아웃 하시겠습니까?</p>
          <form method="dialog">
            <button type="submit" autoFocus>아니오</button>
            <button type="button" onClick={() => { logoutDialog.current?.close(); void logout() }}>예</button>
          </form>
        </dialog>
      </> : <header><p className="system-name">신진 생산관리</p><h1>POP 로그인</h1></header>}
      {(!sessionChecked || (identity && !context)) && (
        <section aria-live="polite">
          {contextError ? (
            <>
              <p>작업장 정보를 불러오지 못했습니다.</p>
              <button onClick={() => {
                setContextError(false)
                setContextAttempt((value) => value + 1)
              }}>다시 불러오기</button>
            </>
          ) : <p>작업장 정보를 불러오는 중입니다.</p>}
        </section>
      )}
      {sessionNotice && <p role="status" className="session-notice">{sessionNotice}</p>}
      {sessionChecked && !identity && <DemoLogin returning={returnedFromMain} onLogin={(session) => {
        setReturnedFromMain(false)
        setIdentity(session)
        setView(new URLSearchParams(window.location.search).get('diagnostic')==='output'?'output':session.initialView??'home')
        setProcessSlot(session.processSlots?.length === 1 ? session.processSlots[0] : undefined)
        setProcessTitle(session.processSlots?.length === 1 ? session.workNames?.[session.processSlots[0]] : undefined)
        setCategory('생산')
        setSessionNotice('')
      }} />}
      {identity && <div className="pop-shell workplace-client">
      {context && identity && view === 'home' && (
        <section aria-label="작업장 메뉴" className="workplace-menu">
          <nav aria-label="업무 분류" className="pop-categories">
            {categories.map(name => <button key={name} type="button" disabled={loggingOut}
              aria-pressed={name === category} onClick={() => setCategory(name)}>{name}</button>)}
          </nav>
          <nav aria-label={category + ' 업무'} className={category === '생산' ? 'pop-menu-tiles production-menu' : 'pop-menu-tiles'}>
            {category === '생산' ? <>
              {processNames.map((label, index) => {
                const slot = index + 1
                const center = identity.workCenterCode ?? ''
                const target: View = identity.groupWork ? 'process-group' : ['003', '103'].includes(center) ? 'basket' : 'orders'
                const enabled = identity.processSlots?.includes(slot) ?? false
                return <button key={slot} data-slot={slot} data-view={enabled ? target : undefined}
                  type="button" disabled={loggingOut || !enabled}
                  onClick={() => { setProcessTitle(identity.workNames?.[slot] ?? label); setProcessSlot(slot); setView(target) }}>
                  <img src={`${import.meta.env.BASE_URL}menu-icons/Process${slot}_${enabled ? 'On' : 'Off'}_Icon.png`} alt="" />
                  <span>{label}</span>
                </button>
              })}
              <button data-slot="robot" data-view="process-group" disabled={loggingOut || !identity.groupWork}
                onClick={() => { setProcessSlot(undefined); setProcessTitle(identity.terminal.workCenter); setView('process-group') }}>
                <img src={`${import.meta.env.BASE_URL}menu-icons/Process7_${identity.groupWork ? 'On' : 'Off'}_Icon.png`} alt="" /><span>로봇</span>
              </button>
              <button data-slot="pack" data-view="packing" disabled={loggingOut || !identity.packingMenu}
                onClick={() => { setProcessSlot(6); setProcessTitle(identity.workNames?.[6] ?? '포장'); setView('packing') }}>
                <img src={`${import.meta.env.BASE_URL}menu-icons/Process6_${identity.packingMenu ? 'On' : 'Off'}_Icon.png`} alt="" /><span>포장</span>
              </button>
              <button data-slot="drawing" data-view="drawing" disabled={loggingOut}
                onClick={() => { setProcessTitle('도면가공'); setView('drawing') }}>
                <img src={`${import.meta.env.BASE_URL}menu-icons/Process6_On_Icon.png`} alt="" /><span>도면가공</span>
              </button>
              <button data-slot="history" data-view="history" disabled={loggingOut}
                onClick={() => { setView('history'); setProcessTitle('작업실적조회') }}>
                <img src={`${import.meta.env.BASE_URL}menu-icons/Print1_On_Icon.png`} alt="" /><span>작업실적조회</span>
              </button>
            </> : menu[category].map(([key, label, icon]) => <button key={key} data-view={key} type="button" disabled={loggingOut}
                onClick={() => { setProcessTitle(undefined); if(key==='employee-print')setEmployeeEntry(true);else setView(key) }}>
                {icon && <img src={`${import.meta.env.BASE_URL}menu-icons/${icon}.png`} alt="" />}
                <span>{label}</span>
              </button>)}
          </nav>
        </section>
      )}
      {context && identity && view === 'inventory' && !loggingOut && (
        <InventoryMoves key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          actor={{ terminal: identity.terminal.id, worker: identity.worker.id }}
          onSessionExpired={expireSession} />
      )}
      {context && identity?.groupWork && view === 'process-group' && !loggingOut && (
        <ProcessGroupDemo actor={JSON.stringify([identity.terminal.id, identity.worker.id])} workCode={processSlot ? identity.workCodes?.[processSlot] ?? '' : undefined} key={JSON.stringify([identity.terminal.id, identity.worker.id])} onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'basket' && !loggingOut && (
        <WorkBasket key={JSON.stringify([identity.terminal.id, identity.worker.id, processSlot, processSlot && identity.workCodes?.[processSlot]])}
          processSlot={processSlot} workCode={processSlot ? identity.workCodes?.[processSlot] : undefined}
          actor={{ terminal: identity.terminal.id, worker: identity.worker.id }} onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'planning' && !loggingOut && (
        <Planning key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          actor={{ terminal: identity.terminal.id, worker: identity.worker.id }}
          onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'shipping' && !loggingOut && (
        <Shipping key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          actor={{ terminal: identity.terminal.id, worker: identity.worker.id }}
          onSessionExpired={expireSession} />
      )}
      {context && identity && (view === 'procurement' || view === 'purchase') && !loggingOut && (
        <ProcurementReceiving sourceType={view === 'purchase' ? 'PURCHASE_ORDER' : 'ESCO_SHIPMENT'} actor={{ terminalId: identity.terminal.id, workerId: identity.worker.id }}
          onSessionExpired={expireSession} />
      )}
      {context && identity && (view==='employee-print' || (view==='home' && employeeEntry)) && !loggingOut && (
        <EmployeePrint key={JSON.stringify([identity.terminal.id,identity.worker.id])}
          onEnter={()=>{setEmployeeEntry(false);setProcessTitle('사원번호 출력');setView('employee-print')}}
          onExit={returnHome} onSessionExpired={expireSession}/>
      )}
      {context && identity && view === 'workPrint' && !loggingOut && (
        <WorkPrint key={JSON.stringify([identity.terminal.id, identity.worker.id])} onExpired={expireSession} />
      )}
      {context && identity && view === 'output' && !loggingOut && (
        <OutputPreview key={JSON.stringify([identity.terminal.id, identity.worker.id])} onSessionExpired={expireSession} />
      )}
      {context && identity && (view === 'transfer' || view === 'transferShip' || view === 'transferReceive' || view === 'transferQuick') && !loggingOut && (
        <Transfer entry={view} key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          actor={{ terminalId: identity.terminal.id, workerId: identity.worker.id }}
          onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'packing' && !loggingOut && (
        <PackingWork key={JSON.stringify([identity.terminal.id, identity.worker.id])} sampleDate={context.sampleDate}
          identity={identity} onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'drawing' && !loggingOut && (
        <DrawingWork key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          workerId={identity.worker.id} terminalId={identity.terminal.id} onSessionExpired={expireSession} />
      )}
      {context && identity && view === 'orders' && !loggingOut && <WorkOrders processOne={canOpenProcessLot(identity,processSlot)} processSlot={processSlot} workCode={processSlot ? identity.workCodes?.[processSlot] ?? '' : ''} terminalId={identity.terminal.id} workerId={identity.worker.id} onSessionExpired={expireSession} />}
      {context && identity && (view === 'rfid' || view === 'rfidMatch' || view === 'rfidLoad' || view === 'rfidMove' || view === 'rfidHistory') && !loggingOut && (
        <RfidDemo entry={view} key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          actor={JSON.stringify([identity.terminal.id, identity.worker.id])} onSessionExpired={expireSession} />
      )}

      {context && identity && view === 'production-report' && !loggingOut && (
        <ProductionReportPage key={JSON.stringify([identity.terminal.id, identity.worker.id])}
          onSessionExpired={expireSession} />
      )}

      {context && identity && !loggingOut && view === 'supplies' && (
        <Expendables actor={{ terminalId: identity.terminal.id, workerId: identity.worker.id }} onSessionExpired={expireSession} />
      )}
      {context && identity && !loggingOut && view === 'repairs' && <RepairHistory onSessionExpired={expireSession} />}
      {context && identity && view === 'history' && !loggingOut &&
        <WorkHistory key={JSON.stringify([identity.terminal.id, identity.worker.id])} worker={identity.worker} onSessionExpired={expireSession} />}
      </div>}
      {identity && !loggingOut && <div className="workplace-equipment-dock"><MachineCalls key={identity.terminal.id + '-' + identity.worker.id} onSessionExpired={expireSession} /></div>}
    </main>
  )
}
