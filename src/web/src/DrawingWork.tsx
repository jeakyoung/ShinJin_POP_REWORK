import { pendingDrawing, submitDrawing } from './drawingPending'
import type { DrawingScope, PendingDrawing } from './drawingPending'
import TouchField from './TouchField'
import './floor-work.css'
import './drawing-floor.css'
import FloorConfirm from './FloorConfirm'
import DrawingPauseButton, { DrawingDecisionButton } from './DrawingPauseButton'
import DrawingNumber from './DrawingNumber'
import ProductionPlaceDialog from './ProductionPlaceDialog'
import type { PlaceWarehouse } from './ProductionPlaceDialog'
import DrawingBulkDelete from './DrawingBulkDelete'
import ProcessLotRows from './processLot/ProcessLotRows'
import type { Stock, Pick as StockPick } from './processLot/processStockTypes'
import ProcessPlans from './ProcessPlans'
import type { PlanKey } from './planningApi'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { SessionExpired } from './workHistoryApi'
import DrawingGroupWork from './DrawingGroupWork'
import { drawingRequest as request, drawingApi as api, drawingStates as states, DrawingError } from './drawingApi'
import type { DrawingDetail as Detail, DrawingGoodPlace, DrawingMaterial as Material } from './drawingApi'

type DisplayFields = { orderNumber: string; orderSequence: number; customer: string; material: string; kind: string;
  dueDate: string; thickness: number; width: number; length: number; returnWarehouse: string; returnLocation: string; qualityCode?: string }
type Option = { display?: DisplayFields; key: string; fgUse2: string; item: string; cutLot: string; orderQuantity: number;
  goodPlaces?:{warehouses:(PlaceWarehouse & {status:string;etc:string})[];initial:DrawingGoodPlace|null} }
type StockView = Pick<Material, 'lot' | 'warehouse' | 'item' | 'location'> & {
  thickness: number | null; width: number | null; length: number | null; available: number
}
const stockId = (row: Pick<Material, 'lot' | 'warehouse' | 'item' | 'location'>) => JSON.stringify([row.lot,row.warehouse,row.item,row.location || ''])
type Scan = { accepted: boolean; scanToken: string; materials: Material[]; stockDetails: StockView[] }
type WorkGroup = { id:string; members: {key:string; snapshot:Detail}[] }
type Action = 'PACK1_START' | 'PACK1_FINISH' | 'DRAW_START' | 'DRAW_PAUSE' | 'DRAW_RESUME' | 'DRAW_FINISH' | 'PACK2_START' | 'PACK2_FINISH' | 'STANDARD_PACK_START' | 'STANDARD_PACK_PAUSE' | 'STANDARD_PACK_RESUME' | 'STANDARD_PACK_FINISH'
type ReturnLine = { warehouse: string; location: string; material: string; thickness: number; width: number; length: number; quantity: number }
type DraftReturn = ReturnLine & { id: string; checked: boolean }
const returnValue = (row:DraftReturn):ReturnLine => ({warehouse:row.warehouse,location:row.location,material:row.material,
  thickness:row.thickness,width:row.width,length:row.length,quantity:row.quantity})
type Input = { returns?: ReturnLine[]; goodPlace?:{warehouse:string;location:string}; action: Action; lot?: string; qty?: number; goodQty?: number; scanToken?: string; inputs?: Material[] }
type Command = Input & { requestId: string; expectedVersion: number }

const url = (key: string) => api + '/plans/' + encodeURIComponent(key)
const messages: Record<string, string> = {
  STALE_VERSION: '다른 요청이 먼저 반영되었습니다. 최신 상태를 표시합니다.',
  TERMINAL_MISMATCH: '다른 단말에서 진행 중인 단계입니다.',
  PACK_QTY_MUST_MATCH_REMAINING: '2차 포장에는 남은 산출량 전부를 입력하세요.',
  PACK_QTY_EXCEEDED: '포장 수량이 가용량을 초과합니다.',
  ORDER_NOT_DRAWING: '도면가공 대상 수주가 아닙니다.',
  ORDER_NOT_REGISTERED: '등록되지 않는 작업지시번호입니다. 다시 스캔하십시오.',
  MATERIAL_NOT_REGISTERED: '해당 작업지시번호는 환경설정에서 등록되지 않는 재질입니다.',
  MATERIAL_MISMATCH: '동일한 재질이 아닙니다. 확인 후 다시 스캔하십시오.',
  ALREADY_PACKED: '이미 출하 인계가 생성됐습니다.',
  INSUFFICIENT_INPUT: '투입 수량이 재고를 초과합니다.',
  SCAN_TOKEN_INVALID: '스캔이 만료되었습니다. 다시 스캔하세요.',
}
type DailyRecord = {
  drawingDailyId: string | null; version: number; operator: string; terminal: string; recordedAt: string
}

function DrawingDaily({ plan, busy, onSessionExpired }: { plan: string; busy: boolean; onSessionExpired: () => void }) {
  const [records, setRecords] = useState<DailyRecord[]>()
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState(0)
  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    request<{ records: DailyRecord[] }>(url(plan) + '/audit', controller.signal).then(data => {
      if (!controller.signal.aborted) setRecords(data.records.filter(row => row.drawingDailyId))
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setNotice('생산일보를 조회하지 못했습니다.')
    })
    return () => controller.abort()
  }, [plan, query, onSessionExpired])
  return <fieldset><legend>도면가공 생산일보</legend>
    <button type="button" disabled={busy} onClick={() => {
      setRecords(undefined)
      setNotice('')
      setQuery(value => value + 1)
    }}>생산일보 조회</button>
    <p role="status">{notice || (records ? records.length + '건' : query ? '조회 중' : '')}</p>
    {!!records?.length && <div className="floor-table"><table>
      <thead><tr><th>일보 번호</th><th>작업자</th><th>단말</th><th>기록 시각</th></tr></thead>
      <tbody>{records.map(row => <tr key={row.version}><td>{row.drawingDailyId}</td>
        <td>{row.operator}</td><td>{row.terminal}</td><td>{row.recordedAt}</td></tr>)}</tbody>
    </table></div>}
  </fieldset>
}

export default function DrawingWork({ terminalId, workerId, onSessionExpired }: { terminalId: string; workerId: string; onSessionExpired: () => void }) {
  const [plans, setPlans] = useState<Option[]>([])
  const [planDialog,setPlanDialog] = useState<'choose'|'status'>()
  const [returnPlaces,setReturnPlaces] = useState<PlaceWarehouse[]>([])
  const [returnEditor,setReturnEditor] = useState<string>()
  const [goodEditor,setGoodEditor] = useState<Option>()
  const [goodDrafts,setGoodDrafts] = useState<Record<string,DrawingGoodPlace>>({})
  const [active, setActive] = useState<string[]>([])
  const [selected, setSelected] = useState<Option>()
  const [detail, setDetail] = useState<Detail>()
  const showFixtureTools = new URLSearchParams(window.location.search).get('drawingFixture') === '1'
  const [materialScanOpen,setMaterialScanOpen] = useState(false)
  const [runningDraft,setRunningDraft] = useState<{key:string;version:number;rows:Material[];fields:StockView[]}>()
  const [manualOpen,setManualOpen] = useState(false)
  const [checkedInputs,setCheckedInputs] = useState<Record<string,string[]>>({})
  const scanner = useRef<HTMLDialogElement>(null)
  const skipDialog = useRef<HTMLDialogElement>(null)
  const barcode = useRef<HTMLInputElement>(null)
  const [scanNotice, setScanNotice] = useState('')
  const [scan, setScan] = useState<Scan>()
  const [confirm, setConfirm] = useState<{ option: Option; fresh: Detail }>()
  useEffect(() => {
    const dialog = skipDialog.current
    if (confirm && !dialog?.open) dialog?.showModal()
    if (!confirm && dialog?.open) dialog.close()
  }, [confirm])
  const [listed, setListed] = useState<Option[]>([])
  const [unchecked,setUnchecked]=useState<string[]>([])
  const [workGroup,setWorkGroup]=useState<WorkGroup>()
  const gridScope: DrawingScope = [terminalId,workerId,'group','checked-work-grid']
  const [groupRetry,setGroupRetry]=useState<PendingDrawing|undefined>(()=>pendingDrawing(gridScope))
  const remaining = useRef<Option[]>([])
  const skipChoice = useRef<'DECLINE' | 'ACCEPT' | undefined>(undefined)
  const orderScans = useRef(new Map<string, { scan: Scan; materials: Material[]; version: number }>())
  const [qty, setQty] = useState('')
  const amounts=useRef(new Map<string,string>())
  const [materials, setMaterials] = useState<Material[]>([])
  const [returnRetry,setReturnRetry]=useState<PendingDrawing>()
  const [returnsByPlan, setReturnsByPlan] = useState<Record<string, DraftReturn[]>>({})
  const [pickedLot, setPickedLot] = useState<string>()
  const [savedStock,setSavedStock] = useState<{plan:string;version:number;inputs:Material[];details:StockView[]}>()
  const [notice, setNotice] = useState('')
  const actor = JSON.stringify([terminalId,workerId])
  const [deleting,setDeleting] = useState(()=>!!sessionStorage.getItem('drawing-delete-list:'+actor))
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<PendingDrawing>()
  useEffect(() => {
    if (!busy && !confirm && scanner.current?.open) barcode.current?.focus()
  }, [busy, confirm])
  const current = useRef<AbortController | null>(null)
  const selectedKey = useRef<string | undefined>(undefined)

  const scope = (key: string): DrawingScope => [terminalId, workerId, 'plan', key]
  const restoreFirst = useEffectEvent((options: Option[], running: string[]) => {
    if (selectedKey.current) return
    const option = options.find(plan => pendingDrawing(scope(plan.key)))
    const listedActive = options.filter(plan => running.includes(plan.key))
    setListed(listedActive)
    if (option ?? listedActive[0]) void load(option ?? listedActive[0])
  })
  useLayoutEffect(() => () => current.current?.abort(), [])

  function showError(error: unknown) {
    if (error instanceof SessionExpired) onSessionExpired()
    else if (error instanceof DrawingError) setNotice(messages[error.message] ?? '요청을 처리할 수 없습니다. 입력과 작업 상태를 확인하세요.')
    else setNotice('서버 응답을 확인하지 못했습니다.')
  }

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([request<Option[]>(api + '/plans', controller.signal), request<string[]>(api + '/active', controller.signal),
      request<PlaceWarehouse[]>(api + '/return-places', controller.signal)])
      .then(([options, running, places]) => { setPlans(options); setActive(running); setReturnPlaces(places); restoreFirst(options, running) })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof SessionExpired) onSessionExpired()
        else setNotice('도면가공 계획을 조회하지 못했습니다.')
      })
    return () => { controller.abort(); current.current?.abort() }
  }, [onSessionExpired])

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (current.current) return
    const controller = new AbortController()
    current.current = controller
    setBusy(true)
    setNotice('')
    try { await task(controller.signal) } catch (error) {
      if (!controller.signal.aborted) showError(error)
    } finally {
      current.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function load(option: Option) {
    await run(async (signal) => {
      selectedKey.current = option.key
      setRunningDraft(undefined)
      setSelected(option)
      setDetail(undefined)
      setScan(undefined)
      setConfirm(undefined)
      setRetry(pendingDrawing(scope(option.key)))
      setQty('')
      const [fresh, running] = await Promise.all([
        request<Detail>(url(option.key), signal), request<string[]>(api + '/active', signal),
      ])
      setDetail(fresh)
      const scanned = orderScans.current.get(option.key)
      if (scanned && scanned.version === fresh.version && !pendingDrawing(scope(option.key))) {
        setScan(scanned.scan)
        setMaterials(scanned.materials)
      }
      setListed(rows => rows.some(row => row.key === option.key) ? rows : [...rows, option])
      setActive(running)
      setQty(fresh.state === 'PACK1_ACTIVE' ? String(option.orderQuantity) : amounts.current.get(option.key) ?? '')
    })
  }

  function goodPlace(option:Option) {
    const saved=option.key===selected?.key ? detail?.goodPlace : selectedGroup?.members.find(row=>row.key===option.key)?.snapshot.goodPlace
    return goodDrafts[option.key] ?? saved ?? option.goodPlaces?.initial
  }
  function goodCodes(option:Option) {
    return placeCodes(goodPlace(option))
  }
  function placeCodes(place:DrawingGoodPlace | null | undefined) {
    return place && {warehouse:place.warehouse,location:place.location} || undefined
  }
  async function openGood(option:Option) {
    if (option.key!==selected?.key) await load(option)
    await run(async signal=>{
      const fresh=await request<Detail>(url(option.key),signal)
      if (!['CUT_READY','DRAW_READY','DRAW_ACTIVE','DRAW_PAUSED'].includes(fresh.state)
          || (fresh.ownerTerminalId && fresh.ownerTerminalId!==terminalId)) return
      setDetail(fresh)
      setGoodEditor(option)
    })
  }

  async function attachPlans(keys:PlanKey[]) {
    const controller = new AbortController()
    try {
      const options = await request<Option[]>(api+'/plans',controller.signal)
      const matched = options.filter(option => {
        const [, , date, sequence] = option.key.split('/')
        return keys.some(key=>key.date.replaceAll('-','')===date && key.sequence===Number(sequence))
      })
      setPlans(options)
      const additions = matched.filter(option => !listed.some(row => row.key === option.key))
      if (!additions.length) {
        setNotice('이미 스캔된 작업지시번호입니다. 확인하십시오.')
        return
      }
      for (const option of additions) {
        const fresh = await request<Detail>(url(option.key),controller.signal)
        if (fresh.state !== 'DRAW_READY') continue
        const prepared = await request<Scan>(url(option.key)+'/scan',controller.signal,{decision:'PROBE'})
        orderScans.current.set(option.key,{scan:prepared,materials:prepared.materials,version:fresh.version})
      }
      setListed(rows => [...rows,...additions.filter(option=>!rows.some(row=>row.key===option.key))])
      await load(additions[0])
    } catch(error) { showError(error) }
  }

  function openScanner() {
    setScanNotice('')
    remaining.current = []
    skipChoice.current = undefined
    if (barcode.current) barcode.current.value = ''
    scanner.current?.showModal()
    barcode.current?.focus()
  }

  async function readBarcode(value: string) {
    if (current.current) return
    const match = /^(\d{8})(\d{1,6})$/.exec(value)
    const options = match ? plans.filter(plan => {
      const [, , date, sequence] = plan.key.split('/')
      return date === match[1] && Number(sequence) === Number(match[2])
    }) : []
    if (value.length === 16 && value[6] === 'S') {
      await run(async signal => {
        setScanNotice('')
        try {
          const matches = await request<{ key: string }[]>(api + '/order-scan', signal, { barcode: value, listed: listed.map(row => row.key) })
          if (!matches.length) {
            setScanNotice('이미 스캔된 작업지시번호입니다. 확인하십시오.')
            barcode.current?.select()
            return
          }
          remaining.current = matches.map(match => {
            const option = plans.find(plan => plan.key === match.key)
            if (!option) throw new DrawingError('ORDER_NOT_REGISTERED')
            return option
          })
          await nextOrderRows(signal)
        } catch (error) {
          remaining.current = []
          if (!(error instanceof DrawingError)) throw error
          setScanNotice(messages[error.message] ?? '작업 상태를 확인하십시오.')
          barcode.current?.select()
        }
      })
      return
    }
    if (options.length !== 1) {
      setScanNotice('등록되지 않는 작업지시번호입니다. 다시 스캔하십시오.')
      barcode.current?.select()
      return
    }
    const option = options[0]
    // Resolve against the authenticated plan list, then recheck the current server state.
    await run(async signal => {
      const fresh = await request<Detail>(url(option.key), signal)
      signal.throwIfAborted()
      if (pendingDrawing(scope(option.key)) || (fresh.ownerTerminalId && fresh.ownerTerminalId !== terminalId)
          || !['CUT_READY', 'DRAW_READY'].includes(fresh.state) || option.fgUse2 === 'PACK') {
        setScanNotice('작업 상태를 확인하십시오.')
        return
      }
      await probe(option, 'PROBE', signal, fresh)
    })
  }

  async function answerSkip(decision: 'DECLINE' | 'ACCEPT') {
    if (!confirm) return
    await run(async signal => {
      if (remaining.current.length) {
        skipChoice.current = decision
        await nextOrderRows(signal)
      } else await probe(confirm.option, decision, signal, confirm.fresh)
    })
  }

  async function nextOrderRows(signal: AbortSignal) {
    while (remaining.current.length) {
      const option = remaining.current[0]
      const fresh = await request<Detail>(url(option.key), signal)
      if (pendingDrawing(scope(option.key)) || (fresh.ownerTerminalId && fresh.ownerTerminalId !== terminalId)
          || !['CUT_READY', 'DRAW_READY'].includes(fresh.state)) {
        remaining.current = []
        setConfirm(undefined)
        setScanNotice('작업 상태를 확인하십시오.')
        return
      }
      if (fresh.state === 'CUT_READY' && !skipChoice.current) {
        setConfirm({ option, fresh })
        return
      }
      const choice = fresh.state === 'CUT_READY' && skipChoice.current ? skipChoice.current : 'PROBE'
      await probe(option, choice, signal, fresh)
      remaining.current.shift()
    }
  }

  async function probe(option: Option, decision: 'PROBE' | 'DECLINE' | 'ACCEPT', signal: AbortSignal, fresh?: Detail) {
    let result: Scan | undefined
    try {
      result = await request<Scan>(url(option.key) + '/scan', signal, { decision })
    } catch (error) {
      if (!(error instanceof DrawingError && error.message === 'PACK1_CONFIRM_REQUIRED')) throw error
    }
    let rows = result?.materials ?? []
    if (result?.accepted && !rows.length) {
      const audit = await request<{ inventory: Material[] }>(url(option.key) + '/audit', signal)
      rows = audit.inventory.filter(row => row.lot === option.cutLot && row.item === option.item && row.qty > 0)
        .map(row => ({ ...row, qty: 0 }))
    }
    signal.throwIfAborted()
    if (!result && fresh) {
      setConfirm({ option, fresh })
      return
    }
    if (result && !result.accepted) {
      setConfirm(undefined)
      setScanNotice('1차 포장 생략을 취소했습니다.')
      return
    }
    if (fresh) {
      if (result?.accepted) orderScans.current.set(option.key, { scan: result, materials: rows, version: fresh.version })
      setListed(list => list.some(row => row.key === option.key) ? list : [...list, option])
      selectedKey.current = option.key
      setSelected(option)
      setDetail(fresh)
      setRetry(undefined)
      setQty(amounts.current.get(option.key) ?? '')
    }
    setConfirm(undefined)
    setScan(result?.accepted ? result : undefined)
    setMaterials(rows)
    if (barcode.current) { barcode.current.value = ''; barcode.current.focus() }
    setScanNotice(result?.accepted ? '작업지시번호가 확인되었습니다.' : '')
  }

  async function send(option: Option, pending: PendingDrawing, replay: boolean) {
    await run(async (signal) => {
      let fresh: Detail
      try {
        const result = await submitDrawing<Detail>(scope(option.key), url(option.key) + '/commands',
          signal, pending, replay, setRetry)
        if (!result || signal.aborted) return
        fresh = replay ? await request<Detail>(url(option.key), signal) : result
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof DrawingError && ['STALE_VERSION', 'TERMINAL_MISMATCH', 'ALREADY_PACKED', 'SCAN_TOKEN_INVALID'].includes(error.message)) {
          setScan(undefined)
          setConfirm(undefined)
          const latest = await request<Detail>(url(option.key), signal)
          setDetail(latest)
          setQty(latest.state === 'PACK1_ACTIVE' ? String(option.orderQuantity) : amounts.current.get(option.key) ?? '')
          setActive(await request<string[]>(api + '/active', signal))
        }
        throw error
      }
      selectedKey.current=option.key;setSelected(option)
      setDetail(fresh)
      setScan(undefined)
      setConfirm(undefined)
      if (!['DRAW_PAUSE','DRAW_RESUME'].includes(pending.action)) setQty(fresh.state === 'PACK1_ACTIVE' ? String(option.orderQuantity) : amounts.current.get(option.key) ?? '')
      setActive(await request<string[]>(api + '/active', signal))
    })
  }

  function command(action: Input) {
    if (!selected || !detail) return
    const command: Command = { ...action, ...(action.action==='DRAW_FINISH'?{goodPlace:goodCodes(selected)}:{}),
      expectedVersion: detail.version, requestId: crypto.randomUUID() }
    void send(selected, { action: command.action, body: JSON.stringify(command) }, false)
  }

  useEffect(()=>{
    const controller=new AbortController()
    if(detail?.activeGroupId) {
      request<WorkGroup>(api+'/groups/'+encodeURIComponent(detail.activeGroupId),controller.signal)
        .then(group=>{if(!controller.signal.aborted)setWorkGroup(group)})
        .catch((error:unknown)=>{if(!controller.signal.aborted && error instanceof SessionExpired)onSessionExpired()})
    } else setWorkGroup(undefined)
    return ()=>controller.abort()
  },[detail?.activeGroupId,detail?.version,onSessionExpired])

  const checkedRows=listed.filter(row=>!unchecked.includes(row.key))
  const grouped=!!detail?.activeGroupId
  const selectedGroup=grouped && workGroup?.id===detail?.activeGroupId ? workGroup : undefined

  async function sendGrid(pending:PendingDrawing,replay=false) {
    await run(async signal=>{
      const group=await submitDrawing<WorkGroup>(gridScope,api+'/work-grid/commands',signal,pending,replay,setGroupRetry)
      if(!group)return
      const key=selectedKey.current ?? group.members[0].key
      const matched=group.members.find(row=>row.key===key) ?? group.members[0]
      const option=plans.find(row=>row.key===matched.key)
      if(!option)return
      const keys=group.members.map(row=>row.key)
      setListed(rows=>[...rows,...plans.filter(row=>keys.includes(row.key) && !rows.some(existing=>existing.key===row.key))])
      setSelected(option);selectedKey.current=option.key
      setDetail(await request<Detail>(url(option.key),signal))
      setQty(amounts.current.get(option.key) ?? '')
      setScan(undefined);setConfirm(undefined);setWorkGroup(group)
      setActive(await request<string[]>(api+'/active',signal))
    })
  }

  function commandGrid(action:'DRAW_START'|'DRAW_PAUSE'|'DRAW_RESUME') {
    if(action==='DRAW_START') {
      const members=checkedRows.map(row=>{
        const prepared=orderScans.current.get(row.key)
        return prepared && {key:row.key,expectedVersion:prepared.version,scanToken:prepared.scan.scanToken,inputs:prepared.materials,
          goodPlace:goodCodes(row)}
      })
      if(members.some(row=>!row)) {setNotice('작업지시와 투입자재를 확인하십시오.');return}
      void sendGrid({action,body:JSON.stringify({requestId:crypto.randomUUID(),action,members,returns:checkedRows.flatMap(row=>(returnsByPlan[row.key] ?? []).map(returnValue))})})
      return
    }
    if(!selectedGroup)return
    const members=selectedGroup.members.filter(row=>row.snapshot.activeGroupId===selectedGroup.id).map(row=>({key:row.key,expectedVersion:row.snapshot.version}))
    void sendGrid({action,body:JSON.stringify({groupId:selectedGroup.id,requestId:crypto.randomUUID(),action,members})})
  }

  async function finishChecked() {
    if (!checkedRows.length) {setNotice('작업완료 할 항목을 선택해주세요.');return}
    let pending: PendingDrawing | undefined
    let target: Option | undefined
    await run(async signal=>{
      const rows=await Promise.all(checkedRows.map(async option=>({
        option, snapshot: option.key===selected?.key && detail ? detail
          : selectedGroup?.members.find(member=>member.key===option.key)?.snapshot ?? await request<Detail>(url(option.key),signal),
        goodQty:Number(option.key===selected?.key ? qty : amounts.current.get(option.key))
      })))
      const first=rows[0], unit=first.snapshot.productionGroupNo
      if (rows.some(row=>row.snapshot.productionGroupNo!==unit)) {setNotice('같은 작업그룹끼리 작업완료 가능합니다.');return}
      if (!unit || rows.some(row=>row.snapshot.state!=='DRAW_ACTIVE')) {setNotice('작업 시작 후 종료 해주세요.');return}
      if (rows.some(row=>!Number.isFinite(row.goodQty)||row.goodQty<1)) {setNotice('생산수량을 입력하십시오.');return}
      if (rows.some(row=>row.snapshot.ownerTerminalId!==terminalId || pendingDrawing(scope(row.option.key))) ||
          pendingDrawing(returnScope(unit)) || pendingDrawing(gridScope)) {setNotice('진행 중인 요청을 확인하십시오.');return}
      const lines: ReturnLine[]=returnsByPlan[unit]?.map(returnValue) ??
        (await request<{returns:ReturnLine[]}>(url(first.option.key)+'/audit',signal)).returns
      if (lines.some(row=>row.warehouse!=='013' && !row.location)) {setNotice('반납 입력된 자재의 대한 창고, 로케이션을 설정해주십시오.');return}
      if (lines.some(row=>row.warehouse!=='013' && row.quantity<1)) {setNotice('반납수량을 입력하십시오.');return}
      if (lines.some(row=>!row.material || [row.thickness,row.width,row.length].some(v=>v<=0) || row.quantity<0)) {
        setNotice('반납자재의 규격과 수량을 확인하십시오.');return
      }
      const action='DRAW_FINISH', requestId=crypto.randomUUID()
      const members=rows.map(({option,snapshot,goodQty})=>({key:option.key,expectedVersion:snapshot.version,goodQty,
        goodPlace:placeCodes(goodDrafts[option.key] ?? snapshot.goodPlace ?? option.goodPlaces?.initial)}))
      if(first.snapshot.activeGroupId) {
        pending={action,body:JSON.stringify({action,requestId,groupId:first.snapshot.activeGroupId,members})}
      } else {
        target=first.option
        selectedKey.current=target.key;setSelected(target);setDetail(first.snapshot);setQty(String(first.goodQty))
        pending={action,body:JSON.stringify({action,requestId,expectedVersion:first.snapshot.version,
          goodQty:first.goodQty,goodPlace:members[0].goodPlace,returns:lines})}
      }
    })
    if(pending) {
      if(target) await send(target,pending,false)
      else await sendGrid(pending)
    }
  }

  function changeInput(index: number, value: string) {
    const available = scan?.stockDetails.find(field=>stockId(field)===stockId(materials[index]))?.available
    const entered = Number(value)
    const quantity = available != null && entered > available ? available : entered === 0 ? 1 : entered
    const updated = materials.map((line, i) => i === index ? { ...line, qty: quantity } : line)
    setMaterials(updated)
    const saved = selected && orderScans.current.get(selected.key)
    if (saved && saved.scan.scanToken === scan?.scanToken) saved.materials = updated
  }

  const [startTime, setStartTime] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setStartTime('')
    if (selected && detail && detail.version > 0) {
      request<{ records: {action: string; recordedAt: string}[]; returns: ReturnLine[]; goodQuantity: number; drawingInputs: Material[]; stockDetails: StockView[] }>(url(selected.key) + '/audit', controller.signal)
        .then(log => {
          if (controller.signal.aborted) return
          setSavedStock({plan:selected.key,version:detail.version,inputs:log.drawingInputs,details:log.stockDetails})
          if (log.records.some(record => record.action === 'DRAW_FINISH')) {
            setQty(String(log.goodQuantity)); amounts.current.set(selected.key,String(log.goodQuantity))
          }
          const unit = detail.productionGroupNo ?? selected.key
          const stored = log.returns.map((row,i)=>({...row,id:String(i),checked:false}))
          if (detail.productionGroupNo) setReturnsByPlan(values => values[unit] ? values : {...values,[unit]:stored})
          const start = log.records.find(record => record.action === 'DRAW_START')
          if (start) setStartTime(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit',
            minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(start.recordedAt)))
        }).catch((error: unknown) => { if (!controller.signal.aborted && error instanceof SessionExpired) onSessionExpired() })
    }
    return () => controller.abort()
  }, [selected, detail, onSessionExpired])

  const persisted = selected && detail && savedStock?.plan===selected.key && savedStock.version===detail.version ? savedStock : undefined
  const draft = selected && detail && runningDraft?.key === selected.key && runningDraft.version === detail.version ? runningDraft : undefined
  const shownInputs = scan ? materials : draft?.rows ?? persisted?.inputs ?? []
  const inputFields = scan ? scan.stockDetails : draft?.fields ?? persisted?.details ?? []
  const focusedMaterial = shownInputs.find(line=>stockId(line)===pickedLot) ?? shownInputs[0]
  const focusedStock = focusedMaterial && inputFields.find(line=>stockId(line)===stockId(focusedMaterial))
  const returnKey = detail?.productionGroupNo ?? selected?.key
  const returnLines = returnKey ? returnsByPlan[returnKey] ?? [] : []
  const returnScope = (unit:string): DrawingScope => [terminalId,workerId,'returns',unit]
  useEffect(()=>{
    setReturnRetry(detail?.productionGroupNo ? pendingDrawing([terminalId,workerId,'returns',detail.productionGroupNo]) : undefined)
  },[detail?.productionGroupNo,terminalId,workerId])
  const editableReturns = !!selected?.display && !!detail &&
    (detail.state === 'DRAW_ACTIVE' || detail.state === 'DRAW_PAUSED' || !!scan)
  const editedReturn = returnLines.find(row=>row.id===returnEditor)
  async function persistReturns(unit:string,pending:PendingDrawing,replay=false) {
    await run(async signal=>{
      const result = await submitDrawing<Detail>(returnScope(unit),api+'/returns',signal,pending,replay,setReturnRetry)
      if (!result) return
      if (selected) setDetail(await request<Detail>(url(selected.key),signal))
    })
  }
  function changeReturns(next: DraftReturn[],save=false) {
    if (!returnKey || !selected) return
    setReturnsByPlan(values=>({...values,[returnKey]:next}))
    if (!save || !detail?.productionGroupNo || next.some(row=>!row.material || row.thickness<=0 || row.width<=0 || row.length<=0)) return
    const lines=next.map(returnValue)
    void persistReturns(returnKey,{action:'SAVE_RETURNS',body:JSON.stringify({
      key:selected.key,expectedVersion:detail.version,requestId:crypto.randomUUID(),returns:lines
    })})
  }
  function addReturn() {
    const info = selected?.display
    if (!info || !editableReturns) return
    if (!focusedMaterial) { setNotice('투입자재가 없습니다. 자재 투입 후 진행하십시오.'); return }
    if (!info.returnWarehouse || !returnPlaces.length) { setNotice('반납창고가 설정되지 않았습니다. 환경설정을 확인하십시오.'); return }
    if (focusedStock?.thickness == null || focusedStock.width == null) {
      setNotice('투입자재 규격을 확인하십시오.'); return
    }
    const useOrder = focusedStock.thickness === focusedStock.width && [3,7].includes(focusedStock.width)
    const material = info.qualityCode === '014' || info.qualityCode === '015' ? 'S45C' : info.material
    changeReturns([...returnLines, { id: crypto.randomUUID(), checked: true, warehouse: info.returnWarehouse,
      location: info.returnLocation, material, thickness: useOrder ? info.thickness : focusedStock.thickness, width: useOrder ? info.width : focusedStock.width, length: 0, quantity: 1 }])
  }
  async function editReturnNumber(row:DraftReturn,field:'thickness'|'width'|'length'|'quantity',value:string) {
    const orderValue = field==='thickness' || field==='width' ? selected?.display?.[field] : undefined
    const updated = {...row,[field]:Number(value)===0 && orderValue!==undefined ? orderValue : Number(value)}
    if (field!=='quantity' && selected && shownInputs[0] && returnPlaces.some(wh=>wh.code===row.warehouse && wh.locations.some(l=>l.code===row.location))) {
      let received=false
      await run(async signal=>{
        const result=await request<{material:string}>(api+'/return-material',signal,
          {key:selected.key,inputItem:shownInputs[0].item,row:returnValue(updated)})
        if (result.material) updated.material=result.material
        received=true
      })
      if (!received) return
    }
    changeReturns(returnLines.map(line=>line.id===row.id ? updated : line),true)
  }
  function applyInputs(next: Material[]) {
    setMaterials(next)
    const saved = selected && orderScans.current.get(selected.key)
    if (saved) saved.materials = next
  }
  const materialPath = api+'/material-scan'
  const materialQuery = '?plan='+encodeURIComponent(selected?.key ?? '')
  async function anyFinished(signal:AbortSignal) {
    const details = await Promise.all(listed.map(row=>request<Detail>(url(row.key),signal)))
    return details.some(row=>['PACK2_READY','PACK2_ACTIVE','SHIP_READY'].includes(row.state))
  }
  function openMaterialScan(manual = false) {
    if (!listed.length || !selected) { setNotice('작업 리스트를 스캔하여 주십시오.'); return }
    void run(async signal => {
      if (await anyFinished(signal)) {
        setNotice('작업완료된 건이 있으므로 자재투입 불가능합니다.'); return
      }
      const context = await request<{issue:unknown[]}>(materialPath+materialQuery,signal)
      if (!context.issue.length) { setNotice('투입창고가 설정되지 않았습니다. 환경설정을 확인하십시오.'); return }
      if (manual) setManualOpen(true)
      else setMaterialScanOpen(true)
    })
  }
  function scannedRows(picks: StockPick[]) {
    if (!selected || !detail) return
    const rows = picks.map(({stock,quantity})=>({lot:stock.lot,warehouse:stock.warehouse,item:stock.material,location:stock.location || null,qty:quantity}))
    const fields = picks.map(({stock},i)=>({...rows[i],thickness:stock.thickness,width:stock.width,length:stock.length,available:stock.available}))
    checkInputs(rows.filter((_,i)=>picks[i].checked).map(stockId))
    if (scan) {
      const next = {...scan,stockDetails:[...scan.stockDetails.filter(s=>!fields.some(f=>stockId(f)===stockId(s))),...fields]}
      setScan(next)
      const saved = orderScans.current.get(selected.key)
      if (saved) saved.scan = next
      applyInputs(rows)
    } else setRunningDraft({key:selected.key,version:detail.version,rows,fields})
  }
  const inputScope = selected?.key ?? ''
  const checkedIds = checkedInputs[inputScope] ?? []
  function checkInputs(ids:string[]) {
    setCheckedInputs(prev=>({...prev,[inputScope]:ids}))
  }
  const locallyOwned = !detail?.ownerTerminalId || detail.ownerTerminalId === terminalId
  const disabled = busy || deleting || !locallyOwned || !!retry || !!groupRetry || !!returnRetry
  const multipleStart=checkedRows.length>1
  const canStart=checkedRows.length>0 && checkedRows.every(row=>{ const member=orderScans.current.get(row.key); return !!member && member.materials.length>0 && member.materials.every(input=>input.qty>0) })
  const validQty = Number(qty) > 0 && Number.isFinite(Number(qty))
  return (
    <section className="floor-work drawing-floor" aria-labelledby="drawing-title">
      <h2 id="drawing-title" className="drawing-accessible">도면가공</h2>
      <div className="drawing-viewport"><div className="drawing-original">
        <div className="drawing-commands">
          <button className="drawing-order-scan" type="button" aria-label="008 스캔" disabled={busy || deleting || !plans.length} onClick={openScanner} />
          <div className="drawing-material-status"><span>재질 :</span><b>{selected?.display?.material ?? '-'}</b>
            <span>시작시간 :</span><b>{startTime || '-'}</b></div>
          <DrawingDecisionButton className="drawing-start" label={'START\n작업시작'} question="작업 시작하시겠습니까?"
            disabled={disabled || grouped || !canStart || (detail?.state!=='DRAW_READY' && detail?.state!=='CUT_READY')}
            onConfirm={()=>{
              if (checkedRows.some(option=>(returnsByPlan[option.key] ?? []).some(row=>row.thickness<=0 || row.width<=0 || row.length<=0))) {
                setNotice('반납자재의 규격을 확인하십시오.');return
              }
              if(multipleStart)commandGrid('DRAW_START')
              else {
                const option=checkedRows[0], prepared=option && orderScans.current.get(option.key)
                if(prepared) {
                  const action:Command={action:'DRAW_START',scanToken:prepared.scan.scanToken,inputs:prepared.materials,returns:(returnsByPlan[option.key] ?? []).map(returnValue),goodPlace:goodCodes(option),
                    requestId:crypto.randomUUID(),expectedVersion:prepared.version}
                  void send(option,{action:action.action,body:JSON.stringify(action)},false)
                }
              }
            }}/>
          <DrawingPauseButton paused={detail?.state === 'DRAW_PAUSED'}
            disabled={disabled || !selected || (grouped && !selectedGroup) || (detail?.state !== 'DRAW_ACTIVE' && detail?.state !== 'DRAW_PAUSED')}
            prepare={open=>void run(async signal=>{
              if (!listed.length) {setNotice('작업 리스트를 스캔하여 주십시오.');return}
              const inputs = selected && !scan && !draft && !persisted
                ? (await request<{drawingInputs:Material[]}>(url(selected.key)+'/audit',signal)).drawingInputs
                : shownInputs
              if (!inputs.length) {setNotice('투입자재를 투입하여 주십시오.');return}
              if (await anyFinished(signal)) {setNotice('작업완료된 건이 존재합니다. 확인하십시오.');return}
              open()
            })}
            onConfirm={()=>{
              const action=detail?.state==='DRAW_PAUSED'?'DRAW_RESUME':'DRAW_PAUSE'
              if(grouped) commandGrid(action)
              else command({action})
            }}/>
          <div className="drawing-end"><DrawingDecisionButton label={'END\n작업완료'} question="작업완료 하시겠습니까?"
            disabled={disabled || detail?.state !== 'DRAW_ACTIVE' || (grouped && !selectedGroup)}
            onConfirm={()=>void finishChecked()}/></div>
          <button type="button" className="drawing-plan" disabled={busy || deleting} onClick={()=>setPlanDialog('choose')}>PLAN<br />생산계획</button>
          <button type="button" className="drawing-status" disabled={busy || deleting} onClick={()=>setPlanDialog('status')}>PLAN<br />계획현황</button>
          <DrawingBulkDelete keys={listed.map(row => row.key)} actor={actor} disabled={busy || !locallyOwned || !!retry}
            onExpired={onSessionExpired} onPending={setDeleting} onDone={() => {
              selectedKey.current=undefined;orderScans.current.clear();amounts.current.clear();setCheckedInputs({})
              setListed([]);setSelected(undefined);setDetail(undefined);setScan(undefined);setConfirm(undefined);setGoodDrafts({})
              setUnchecked([]);setQty('');setMaterials([]);setReturnsByPlan({});setStartTime('');setActive([])
            }} />
          <button type="button" className="drawing-print">PRINT<br />프린트</button>
        </div>
        <div className="drawing-orders"><table aria-label="작업지시"><thead><tr>
          {['선택', '순번', '거래처명 / 수주번호', '납기일', '두께', '폭', '길이', '수주량', '생산잔량', '생산수량', '불량수량', '창고명', '로케이션', '배치수', '시작시간', '선택삭제', '생산그룹번호'].map(column => <th key={column}>{column}</th>)}
        </tr></thead><tbody>{listed.map((option, index) => {
          const chosen = option.key === selected?.key
          return <tr key={option.key} aria-current={chosen ? 'true' : undefined} onClick={() => { if (!busy && !chosen) void load(option) }}>
            <td><input type="checkbox" checked={!unchecked.includes(option.key)} disabled={busy}
              aria-label={option.key} onClick={event=>event.stopPropagation()} onChange={event=>{
                setUnchecked(keys=>event.target.checked?keys.filter(key=>key!==option.key):[...keys,option.key])
                if(!chosen) void load(option)
              }} /></td>
            <td>{index + 1}</td><td>{option.display?.customer}<br />{option.display && option.display.orderNumber + '-' + option.display.orderSequence}</td>
            <td>{option.display?.dueDate}</td><td>{option.display?.thickness}</td><td>{option.display?.width}</td><td>{option.display?.length}</td>
            <td>{option.orderQuantity}</td><td>{chosen && detail && ['CUT_READY', 'DRAW_READY', 'DRAW_ACTIVE', 'DRAW_PAUSED'].includes(detail.state) ? option.orderQuantity : ''}</td>
            <td>{<DrawingNumber label={'008 양품 수량'+(chosen?'':' '+(index+1)+'행')} mode="decimal" value={chosen?qty:amounts.current.get(option.key) ?? ''}
              disabled={disabled || (chosen && !!detail && !['CUT_READY','DRAW_READY','DRAW_ACTIVE','DRAW_PAUSED'].includes(detail.state))}
              onApply={value=>{
                const next=String(Math.min(Number(value),option.orderQuantity))
                amounts.current.set(option.key,next)
                if(chosen) setQty(next)
                else void load(option)
              }} />}</td>
            <td></td>{(['warehouseName','locationName'] as const).map(field=><td key={field}>
              <button type="button" className="drawing-place-cell" aria-label={(index+1)+'행 '+(field==='warehouseName'?'양품 창고':'양품 로케이션')}
                disabled={disabled || (chosen && !!detail && !['CUT_READY','DRAW_READY','DRAW_ACTIVE','DRAW_PAUSED'].includes(detail.state))}
                onClick={event=>{event.stopPropagation();void openGood(option)}}>{goodPlace(option)?.[field]}</button></td>)}
            <td></td><td>{chosen && startTime}</td><td></td><td>{chosen && detail?.productionGroupNo}</td>
          </tr>
        })}</tbody></table></div>
        <div className="drawing-progress"><span>선택건<br />공정진행현황</span><table><thead><tr>
          {['발주','소재입고','폭 절단','평탄','평면A','평면B','측면','4면가공','길이절단','포장','도면가공'].map(step => <th key={step}>{step}</th>)}
          </tr></thead><tbody><tr>{Array.from({ length: 11 }, (_, i) => <td key={i}>{i === 10 && detail && ['DRAW_ACTIVE','DRAW_PAUSED','PACK2_READY','PACK2_ACTIVE','SHIP_READY'].includes(detail.state) ?
            detail.state === 'DRAW_ACTIVE' ? '진행' : detail.state === 'DRAW_PAUSED' ? '중단' : '완료' : ''}</td>)}</tr></tbody></table>
            <span>품목유형 :　<b>{selected?.display?.kind ?? '-'}</b></span></div>
        <div className="drawing-materials">
          <div><header><span>투입자재</span><span>두께　<b>{selected?.display?.thickness ?? '-'}</b></span><span>폭　<b>{selected?.display?.width ?? '-'}</b></span>
            <div className="drawing-material-actions"><button aria-label="투입자재 스캔" className="drawing-lot-scan" disabled={disabled} onClick={()=>openMaterialScan()} />
              <button aria-label="투입자재 추가" disabled={disabled || !scan} onClick={()=>openMaterialScan(true)}>＋</button>
              <DrawingDecisionButton label="−" ariaLabel="투입자재 삭제" disabled={disabled || !scan} question="선택한 투입자재를 삭제하시겠습니까?"
                canOpen={()=>{
                  if (!materials.length) {setNotice('투입자재를 확인하십시오.');return false}
                  if (!materials.some(row=>checkedIds.includes(stockId(row)))) {setNotice('삭제할 투입자재를 선택하십시오.');return false}
                  return true
                }} onConfirm={()=>void run(async signal=>{
                  if(await anyFinished(signal)){setNotice('작업완료된 건이 있으므로 자재삭제 불가능합니다.');return}
                  applyInputs(materials.filter(row=>!checkedIds.includes(stockId(row))))
                  checkInputs([]);setPickedLot(undefined)
                })}/></div></header><table aria-label="투입자재"><thead><tr>
            <th>선택</th><th>창고</th><th>두께</th><th>폭</th><th>길이</th><th>재고</th><th>투입수량</th><th>로케이션명</th><th>LOTNO</th>
          </tr></thead><tbody>{shownInputs.map((row,index) => {
            const id=stockId(row)
            const stock=inputFields.find(entry=>stockId(entry)===id)
            return <tr key={id} onClick={()=>setPickedLot(id)}>
              <td><input type="checkbox" aria-label={row.lot+' 선택'} checked={checkedIds.includes(id)}
                onClick={event=>event.stopPropagation()} onChange={event=>{checkInputs(event.target.checked?[...checkedIds,id]:checkedIds.filter(key=>key!==id));setPickedLot(id)}} /></td>
              <td title={row.lot}>{row.warehouse}</td><td>{stock?.thickness}</td><td>{stock?.width}</td>
              <td>{stock?.length}</td><td>{stock?.available}</td><td>{scan ?
                <DrawingNumber label={[row.lot,row.warehouse,row.item,row.location].filter(Boolean).join(' · ')}
                  mode="integer" value={String(row.qty)} disabled={disabled} onApply={value=>changeInput(index,value)} /> : row.qty}</td><td>{row.location}</td><td>{row.lot}</td>
            </tr>
          })}</tbody></table></div>
          <div><header><span>반납자재</span><button type="button" className="drawing-return-label">라벨출력</button><div className="drawing-material-actions">
            <button aria-label="반납자재 추가" disabled={disabled || !editableReturns} onClick={addReturn}>＋</button>
            <DrawingDecisionButton label="−" ariaLabel="반납자재 삭제" question="선택한 반납자재를 삭제하시겠습니까?"
              disabled={disabled || !editableReturns} canOpen={()=>{
                if (!returnLines.some(row=>row.checked)) {setNotice('삭제할 반납자재를 선택하십시오.');return false}
                if (returnLines.some(row=>row.checked && row.warehouse==='013')) {setNotice('산철, 분철은 삭제할 수 없습니다.');return false}
                return true
              }} onConfirm={()=>changeReturns(returnLines.filter(row=>!row.checked),true)} />
          </div></header><table aria-label="반납자재"><thead><tr>
            {['선택','창고','로케이션','재질','두께','폭','길이','반납수량'].map(name => <th key={name}>{name}</th>)}
          </tr></thead><tbody>{returnLines.map((row, i) => <tr key={row.id}>
            <td><input type="checkbox" aria-label={'반납 '+(i+1)+'행 선택'} checked={row.checked} disabled={disabled || !editableReturns}
              onChange={() => changeReturns(returnLines.map(line => line.id === row.id ? {...line,checked:!line.checked} : line))} /></td>
            {(['warehouse','location'] as const).map(field=>{
              const warehouse=returnPlaces.find(w=>w.code===row.warehouse)
              const text=field==='warehouse' ? warehouse?.name : warehouse?.locations.find(l=>l.code===row.location)?.name
              return <td key={field}><button type="button" className="drawing-place-cell" aria-label={'반납 '+(i+1)+'행 '+(field==='warehouse'?'창고':'로케이션')}
                disabled={disabled || !editableReturns || row.warehouse==='013'} onClick={()=>setReturnEditor(row.id)}>{text}</button></td>
            })}<td>{row.material}</td>
            {(['thickness','width','length','quantity'] as const).map((field, j) => <td key={field}>
              <DrawingNumber mode={field==='quantity'?'integer':'decimal'} value={String(row[field])}
                label={'반납 '+(i+1)+'행 '+['두께','폭','길이','반납수량'][j]} disabled={disabled || !editableReturns || (row.warehouse==='013' && field!=='quantity')}
                onApply={value=>void editReturnNumber(row,field,value)} />
            </td>)}</tr>)}</tbody></table></div>
        </div>
      </div></div>
      {goodEditor && <ProductionPlaceDialog warehouseLabel="양품 창고" locationLabel="양품 로케이션" retainOpeningLocation
        warehouses={goodEditor.goodPlaces?.warehouses ?? []} initial={goodPlace(goodEditor) ?? {warehouse:'',location:''}}
        onClose={()=>setGoodEditor(undefined)} onApply={(warehouse,location)=>{
          if (!detail) return
          void run(async signal=>{
            const resolved=await request<DrawingGoodPlace>(api+'/good-place',signal,{
              key:goodEditor.key,version:detail.version,opening:goodCodes(goodEditor),selected:{warehouse,location}})
            setGoodDrafts(values=>({...values,[goodEditor.key]:resolved}))
            setGoodEditor(undefined)
          })
        }} />}
      {editedReturn && <ProductionPlaceDialog warehouseLabel="반납창고" locationLabel="반납 로케이션" retainOpeningLocation
        warehouses={returnPlaces} initial={{warehouse:editedReturn.warehouse,location:editedReturn.location}}
        onClose={()=>setReturnEditor(undefined)} onApply={(warehouse,location)=>{
          changeReturns(returnLines.map(line=>line.id===editedReturn.id ? {...line,warehouse,location,length:0,material:''} : line))
          setReturnEditor(undefined)
        }} />}
      {planDialog && <ProcessPlans source="frmProcess7" initial={planDialog} apiBase="/api/drawing-008/planning" workCode="008"
        storagePrefix="pop-drawing-008-plan:" actor={actor} parentQualities={listed.flatMap(option=>option.display ? [option.display.material] : [])}
        onClose={()=>setPlanDialog(undefined)} onAttached={keys=>void attachPlans(keys)} onSessionExpired={onSessionExpired} />}
      {(manualOpen || materialScanOpen) && selected && <ProcessLotRows open mode={manualOpen?"manual":"scan"} date="" sequence={0} renderRows={false}
        source={{path:manualOpen?api+"/manual-material":materialPath,suffix:materialQuery,headers:{}}}
        lookupScan={(raw,signal)=>request<Stock[]>(materialPath+materialQuery+'&lot='+encodeURIComponent(raw),signal)}
        rows={shownInputs.map(row=>{
          const field=inputFields.find(f=>stockId(f)===stockId(row))
          return {checked:checkedIds.includes(stockId(row)),quantity:row.qty,stock:{lot:row.lot,warehouse:row.warehouse,location:row.location ?? '',
            material:row.item,name:row.item,quality:selected.display?.material ?? '',workStatus:'',
            thickness:field?.thickness ?? 0,width:field?.width ?? 0,length:field?.length ?? 0,available:field?.available ?? 0}}
        })} onRows={scannedRows} onManualApplied={(_,focus)=>{if(focus)setPickedLot(stockId({lot:focus.stock.lot,warehouse:focus.stock.warehouse,item:focus.stock.material,location:focus.stock.location}))}} onSessionExpired={onSessionExpired} onClose={()=>{setManualOpen(false);setMaterialScanOpen(false)}}/>}
      <dialog ref={scanner} className="drawing-scan-dialog" aria-label="작업지시 번호를 스캔하세요."
        onClose={event => { if (event.target===event.currentTarget) setConfirm(undefined) }} onCancel={event => { if (busy) event.preventDefault() }}>
        <input ref={barcode} aria-label="작업지시 번호" placeholder="작업지시 번호를 스캔하세요." disabled={busy || !!confirm}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void readBarcode(event.currentTarget.value) } }} />
        <dialog ref={skipDialog} className="drawing-skip" aria-label="1차 포장 생략 확인" onCancel={event => { event.preventDefault(); if (!busy) void answerSkip('DECLINE') }}>
          <p>1차 포장이 진행되지 않았습니다. 그대로 진행하시겠습니까?</p>
          <button type="button" disabled={busy} onClick={() => void answerSkip('ACCEPT')}>예</button>
          <button type="button" disabled={busy} onClick={() => void answerSkip('DECLINE')}>아니오</button>
        </dialog>
        <output role="status">{scanNotice || notice}</output>
        <button type="button" disabled={busy} onClick={() => scanner.current?.close()}>닫기</button>
      </dialog>
      {showFixtureTools && <>
      <p>008 진행 목록 {active.length ? active.join(', ') : '없음'}</p>
      <fieldset><legend>작업 선택</legend>
      <label>계획 선택
        <select disabled={busy} value={selected?.key ?? ''} onChange={(event) => {
          const option = plans.find((plan) => plan.key === event.target.value)
          if (option) void load(option)
        }}>
          <option value="" disabled>계획 선택</option>
          {plans.map((plan) => <option key={plan.key} value={plan.key}>{plan.key} · {plan.item} · {plan.fgUse2}</option>)}
        </select>
      </label>
      {selected && <button type="button" disabled={busy} onClick={() => void load(selected)}>계획 새로 조회</button>}
      </fieldset>
      {selected && detail && (
        <>
          <fieldset className="floor-stage"><legend>선택 계획 · {selected.key}</legend>
          <p>{states[detail.state]} · 버전 {detail.version}{detail.bypassedPack1 && ' · 1차 포장 생략'}</p>
          {!locallyOwned && <p>진행 단말 {detail.ownerTerminalId}</p>}
          {detail.state === 'CUT_READY' && selected.fgUse2 !== '001' && selected.fgUse2 !== 'PACK' &&
            <button type="button" disabled={disabled} onClick={() => command({ action: 'PACK1_START' })}>1차 포장 시작</button>}
          {(detail.state === 'PACK1_ACTIVE' || detail.state === 'PACK2_READY' || detail.state === 'PACK2_ACTIVE') && (
            <TouchField label="포장 수량" layout="decimal" type="number" min="0.001" step="0.001" value={qty} disabled={disabled}
                placeholder={detail.state.startsWith('PACK2') ? '비우면 남은 산출량 전부' : undefined}
                onValueChange={setQty} />
          )}
          {detail.state === 'PACK1_ACTIVE' &&
            <FloorConfirm label="1차 포장 완료" summary={[selected.key, qty || '남은 산출량 전부'].join(' · ')} disabled={disabled || !validQty} onConfirm={() => command({ action: 'PACK1_FINISH', lot: selected.cutLot, qty: Number(qty) })} />}
          {detail.state === 'PACK2_READY' &&
            <button type="button" disabled={disabled} onClick={() => command({ action: 'PACK2_START' })}>2차 포장 시작</button>}
          {(detail.state === 'PACK2_READY' || detail.state === 'PACK2_ACTIVE') &&
            <FloorConfirm label="2차 포장 완료" summary={[selected.key, qty || '남은 산출량 전부'].join(' · ')} disabled={disabled || (!!qty && !validQty)} onConfirm={() => command({ action: 'PACK2_FINISH', qty: qty ? Number(qty) : undefined })} />}
          {selected.fgUse2 === 'PACK' && detail.state === 'CUT_READY' &&
            <button type="button" disabled={disabled} onClick={() => command({ action: 'STANDARD_PACK_START' })}>일반 포장 시작</button>}
          {detail.state === 'STANDARD_PACK_PAUSED' &&
            <FloorConfirm label="작업 재시작" summary={selected.key} disabled={disabled}
              onConfirm={() => command({ action: 'STANDARD_PACK_RESUME' })} />}
          {detail.state === 'STANDARD_PACK_ACTIVE' && <>
            <FloorConfirm label="작업 일시 중단" summary={selected.key} disabled={disabled}
              onConfirm={() => command({ action: 'STANDARD_PACK_PAUSE' })} />
            <TouchField label="일반 포장 수량" layout="decimal" type="number" min="0.001" step="0.001" value={qty} disabled={disabled}
                onValueChange={setQty} />
            <FloorConfirm label="일반 포장 완료" summary={[selected.key, qty || '남은 산출량 전부'].join(' · ')} disabled={disabled || !validQty} onConfirm={() => command({ action: 'STANDARD_PACK_FINISH', lot: selected.cutLot, qty: Number(qty) })} />
          </>}
          </fieldset>
          <DrawingDaily key={selected.key + '/' + detail.version} plan={selected.key} busy={busy} onSessionExpired={onSessionExpired} />
          {detail.shipment && <p>출하 인계 {detail.shipPlanId} · {detail.shipment.material.lot} · {detail.shipment.material.qty}
            {detail.shipment.deferred && ' · 이월'}</p>}
        </>
      )}
      </>}
      {selected && retry && <button type="button" disabled={busy} onClick={() => void send(selected, retry, true)}>같은 요청 다시 보내기</button>}
      {showFixtureTools && <DrawingGroupWork workerId={workerId} terminalId={terminalId} onSessionExpired={onSessionExpired}
        onPlan={(key) => {
          const option = plans.find((plan) => plan.key === key)
          if (option) void load(option)
        }}
        onChanged={async (keys, signal) => {
          const key = selectedKey.current
          setActive(await request<string[]>(api + '/active', signal))
          if (!key || !keys.includes(key)) return
          const fresh = await request<Detail>(url(key), signal)
          if (selectedKey.current !== key || current.current) return
          setDetail(fresh)
          setScan(undefined)
          setConfirm(undefined)
          setQty('')
        }} />}
      {returnRetry && detail?.productionGroupNo && <button type="button" disabled={busy}
        onClick={()=>void persistReturns(detail.productionGroupNo!,returnRetry,true)}>반납 저장 결과 재확인</button>}
      {groupRetry && <button type="button" disabled={busy} onClick={()=>void sendGrid(groupRetry,true)}>작업 결과 재확인</button>}
      {(busy || notice) && <p className="drawing-feedback" role="status">{busy ? '처리 중입니다.' : notice}</p>}
    </section>
  )
}
