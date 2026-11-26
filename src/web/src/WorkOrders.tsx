import ProcessPlans from './ProcessPlans'
import {loadScreen} from './processPlanApi'
import { Head, Pop } from './ProcessPlanFields'
import CommonNumericPad from './commonInput/CommonNumericPad'
import WorkRejections from './WorkRejections'
import GoodProductLocationDialog, { type GoodPlace } from './GoodProductLocationDialog'
import ProcessLotRows,{useProcessLotRows} from './processLot/ProcessLotRows'
import {key as stockKey,type Pick as LotPick} from './processLot/processStockTypes'
import ProductionMaterialGrid from './ProductionMaterialGrid'
import {pendingCommand,productionRequest,ProductionError} from './productionApi'
import type {ProductionBatch,ProductionRow,MaterialDraft,ManualIssue,ScannedIssue} from './productionApi'
import {ProductionStages,Tool,Scanner} from './ProductionGrid'
import './ProductionGrid.css'
import './WorkOrders.css'
import TouchField from './TouchField'
import ScanInput from './ScanInput'
import type { Route } from './scan-contract'
import { useEffect, useRef, useState } from 'react'

import { getSessionData, SessionExpired, SessionRequestError } from './workHistoryApi'
import { applyWorkOrderAction, loadWorkOrder, loadWorkOrders } from './workOrdersApi'
import type { MaterialAction, OrderStatus, StockLocation, WorkOrder, WorkOrderAction, WorkOrderDetail } from './workOrdersApi'

type Load<T> = { state: 'loading' | 'error' } | { state: 'ready'; data: T }

const labels: Record<OrderStatus, string> = { WAITING: '대기', IN_PROGRESS: '진행 중', PAUSED: '중지', COMPLETE: '완료' }
const actionMessages: Record<WorkOrderAction['action'], string> = {
  ISSUE_MATERIAL: '자재를 투입했습니다.',
  RETURN_MATERIAL: '자재를 반납했습니다.',
  START: '작업을 시작했습니다.',
  PAUSE: '작업을 중지했습니다.',
  RESUME: '작업을 재개했습니다.',
  CANCEL_START: '작업 시작을 취소했습니다.',
  COMPLETE: '작업을 완료했습니다.',
}
const quantity = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 })
const positionKey = ({ warehouse, location }: StockLocation) => JSON.stringify([warehouse, location])
const positionLabel = ({ warehouse, location }: StockLocation) => [warehouse, location].join(' / ')

export default function WorkOrders({ terminalId, workerId, workCode, processOne, processSlot, onSessionExpired }: { processSlot?:number|null; processOne?:boolean; terminalId: string; workerId: string; workCode?:string; onSessionExpired: () => void }) {
  const [scanRows,setScanRows]=useProcessLotRows()
  const manualKeys=useRef(new Map<string,Set<string>>())
  const manualFocus=useRef(new Map<string,string>())
  const actor = JSON.stringify([terminalId, workerId])
  const [pane,setPane]=useState<'choose'|'status'>()
  const [modal,setModal]=useState<'scan'|'lot'|'issue'|'return'>()
  const [cell,setCell]=useState<{row:WorkOrder;field:'good'|'arrangement'}>()
  const [goodPlaceRow,setGoodPlaceRow]=useState<WorkOrder>()
  const [goodPlaces,setGoodPlaces]=useState<Record<string,GoodPlace>>({})
  const [rejection,setRejection]=useState<WorkOrder>()
  const [ask,setAsk]=useState<{text:string;yes:()=>void}>()
  const [checked,setChecked]=useState<string[]>([])
  type RowMeta={date:string;sequence:number;revision:number;produced:number|null;bad:number;arrangement:number|null;remaining:number|null;started:string|null;group:string|null;goodPlace:GoodPlace|null}
  const [meta,setMeta]=useState<RowMeta[]>([])
  const [issueWarehouses,setIssueWarehouses]=useState<string[]>([])
  const [returnWarehouses,setReturnWarehouses]=useState<string[]>([])
  const [good,setGood]=useState<Record<string,string>>({})
  const [arrangement,setArrangement]=useState<Record<string,string>>({})
  const batchKey='process1-production:'+actor+':'+(workCode??'')
  const manualKey=batchKey+':manual:'+(processSlot??'')
  const [manualPending,setManualPending]=useState(()=>pendingCommand<ManualIssue>(manualKey))
  const sendingManual=useRef(false)
  const [pending,setPending]=useState(()=>pendingCommand<ProductionBatch>(batchKey))
  const sending=useRef(false)
  const [draftMaterials,setDraftMaterials]=useState<MaterialDraft[]>([])
  const [autoPrint,setAutoPrint]=useState(false)
  const [printingAllowed,setPrintingAllowed]=useState(false)
  const focusPolicy=useRef<'first'|'all'|null>('first')
  useEffect(()=>{
    const ctl=new AbortController()
    void loadScreen(ctl.signal,undefined,workCode).then(data=>{
      if(ctl.signal.aborted)return
      const plant=data.catalog.plantCode,code=workCode??data.catalog.workCode
      setPrintingAllowed(plant==='000001'&&['001','003','004','006'].includes(code)||plant==='000002'&&code==='001')
      setAutoPrint(plant==='000002'&&code==='001')
    }).catch(()=>{})
    return ()=>ctl.abort()
  },[workCode,terminalId])
  const [attempt, setAttempt] = useState(0)
  const [orders, setOrders] = useState<Load<WorkOrder[]>>({ state: 'loading' })
  const [selected, setSelected] = useState<WorkOrder>()
  const [detail, setDetail] = useState<Load<WorkOrderDetail>>({ state: 'loading' })
  const [detailAttempt, setDetailAttempt] = useState(0)

  const [scanNotice, setScanNotice] = useState('')
  const [lotCode, setLotCode] = useState('')
  const [stockPosition, setStockPosition] = useState('')
  const [materialQuantity, setMaterialQuantity] = useState('')

  const [actionNotice, setActionNotice] = useState('')
  const [applying, setApplying] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const activeAction = useRef<AbortController | null>(null)

  useEffect(() => () => activeAction.current?.abort(), [])

  useEffect(() => {
    const request = new AbortController()
    Promise.all([loadWorkOrders('',request.signal),getSessionData<RowMeta[]>('/api/pop/work-orders/production',request.signal),
      getSessionData<{returns:string[];issue:string[]}>('/api/pop/work-orders/production/roles',request.signal)]).then(([data,info,roles])=>{
      if (!request.signal.aborted) {
        setMeta(info)
        setReturnWarehouses(roles.returns);setIssueWarehouses(roles.issue)
        const policy=focusPolicy.current
        if(policy && data.length){
          setSelected(data[0]);setChecked((policy==='first'?data.slice(0,1):data).map(r=>r.planDate+'/'+r.planSequence));focusPolicy.current=null
        }
      }
      if (!request.signal.aborted) setOrders({ state: 'ready', data })
    }).catch((error) => {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setOrders({ state: 'error' })
    })
    return () => request.abort()
  }, [attempt, onSessionExpired])

  useEffect(() => {
    if (!selected) return
    const request = new AbortController()
    loadWorkOrder(selected, request.signal).then((data) => {
      if (!request.signal.aborted) setDetail({ state: 'ready', data })
    }).catch((error) => {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else setDetail({ state: 'error' })
    })
    return () => request.abort()
  }, [selected, detailAttempt, onSessionExpired])

  function refresh() {
    setSelected(undefined)
    setActionNotice('')
    setConfirmCancel(false)
    setOrders({ state: 'loading' })
    setAttempt((value) => value + 1)
  }

  function selectOrder(order: WorkOrder) {
    setLotCode('')
    setStockPosition('')
    setMaterialQuantity('')

    setActionNotice('')
    setConfirmCancel(false)
    setDetail({ state: 'loading' })
    setSelected(order)
    setDetailAttempt((value) => value + 1)
  }

  function handleScan(route: Route) {
    setScanNotice('')
    if (route.kind === 'work-order') {
      const order = orders.state === 'ready' && orders.data.find((entry) =>
        entry.planDate === route.planDate && entry.planSequence === route.sequence)
      if (order) {selectOrder(order);setModal(undefined)}
      else void getSessionData<WorkOrder>('/api/pop/work-orders/'+encodeURIComponent(route.planDate)+'/'+route.sequence+'/scan',new AbortController().signal,{method:'POST'})
        .then(row=>{setAttempt(n=>n+1);selectOrder(row);setModal(undefined)}).catch(err=>{if(err instanceof SessionExpired)onSessionExpired();else setScanNotice('작업지시를 찾을 수 없습니다.')})
    } else if (route.kind === 'lot') {
      const found = detail.state === 'ready' && detail.data.materials.find((entry) => entry.lotCode === route.code)
      if (!found) {
        setScanNotice('선택한 작업지시에서 LOT를 찾을 수 없습니다.')
        return
      }
      setLotCode(found.lotCode)
      setStockPosition('')
      setMaterialQuantity('')
      setScanNotice(found.positions.length > 1 ? '투입 위치를 선택해 주세요.' : 'LOT를 선택했습니다.')
    }
  }

  async function applyAction(current: WorkOrderDetail, action: WorkOrderAction) {
    if (activeAction.current) return
    const request = new AbortController()
    activeAction.current = request
    setApplying(true)
    setActionNotice('')
    setConfirmCancel(false)
    try {
      const data = await applyWorkOrderAction(current, action, request.signal)
      if (request.signal.aborted) return
      setDetail({ state: 'ready', data })

      setMaterialQuantity('')
      setOrders({ state: 'loading' })
      setAttempt((value) => value + 1)
      setActionNotice(actionMessages[action.action]);setModal(undefined)
    } catch (error) {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) {
        onSessionExpired()
      } else if (error instanceof SessionRequestError && error.status === 409) {
        setActionNotice('다른 요청으로 상태가 바뀌었습니다. 최신 상태를 표시합니다.')
        setDetail({ state: 'loading' })
        setDetailAttempt((value) => value + 1)
        setOrders({ state: 'loading' })
        setAttempt((value) => value + 1)
      } else if (error instanceof SessionRequestError && error.status === 400) {
        if (action.action === 'ISSUE_MATERIAL' || action.action === 'RETURN_MATERIAL') {
          setActionNotice('LOT 수량을 처리하지 못했습니다. 최신 재고와 투입 수량을 확인해 주세요.')
          setDetail({ state: 'loading' })
          setDetailAttempt((value) => value + 1)
          return
        }
        setActionNotice(action.action === 'COMPLETE'
          ? '실적수량은 계획수량 이내의 양수로, 소수 셋째 자리까지 입력해 주세요.'
          : '요청을 처리할 수 없습니다. 작업지시 상태를 다시 확인해 주세요.')
      } else {
        setActionNotice('응답을 확인하지 못했습니다. 다시 조회해 상태를 확인해 주세요.')
        setDetail({ state: 'loading' })
        setDetailAttempt((value) => value + 1)
        setOrders({ state: 'loading' })
        setAttempt((value) => value + 1)
      }
    } finally {
      if (activeAction.current === request) activeAction.current = null
      if (!request.signal.aborted) setApplying(false)
    }
  }

  const material = detail.state === 'ready' ? detail.data.materials.find((lot) => lot.lotCode === lotCode) : undefined
  const candidate = material?.positions.length === 1
    ? material.positions[0]
    : material?.positions.find(({ position }) => positionKey(position) === stockPosition)
  const canReturn = detail.state === 'ready'
    && (detail.data.plan.status === 'IN_PROGRESS' || detail.data.plan.status === 'PAUSED')
  const amount = Number(materialQuantity)
  const validMaterialQuantity = /^[0-9]+(?:\.[0-9]{1,3})?$/.test(materialQuantity)
    && Number.isFinite(amount) && amount > 0

  function moveMaterial(current: WorkOrderDetail, action: MaterialAction) {
    if (!material || !validMaterialQuantity) return
    const values = { lotCode: material.lotCode, quantity: amount }
    if (action === 'ISSUE_MATERIAL' && candidate && amount <= candidate.availableQuantity) {
      void applyAction(current, { action, ...values, ...candidate.position })
    }
    if (action === 'RETURN_MATERIAL' && canReturn && amount <= material.issuedQuantity) {
      void applyAction(current, { action, ...values })
    }
  }

  const current = selected && detail.state === 'ready' ? detail.data : undefined
  const scanScope=JSON.stringify([actor,workCode,processSlot,current?.plan.planDate,current?.plan.planSequence])
  const pickedLots=scanRows[scanScope]??[]
  const state = current?.plan.status
  const editable = !!current && state !== 'COMPLETE' && !applying && !confirmCancel
  const active = state === 'IN_PROGRESS'
  const paused = state === 'PAUSED'

  function chooseLot(code: string) {
    setLotCode(code)
    setStockPosition('')
  }

  const list=orders.state==='ready'?orders.data:[]
  const rowId=(o:WorkOrder)=>o.planDate+'/'+o.planSequence
  const someComplete=list.some(row=>row.status==='COMPLETE')
  const markedRows=list.filter(r=>checked.includes(rowId(r)))
  const readMeta=(r:WorkOrder)=>meta.find(m=>m.date===r.planDate&&m.sequence===r.planSequence)
  function issueLine(row:LotPick,source:'manual'|'scan'):ScannedIssue {
    if(!current)throw new Error('WORK_CHANGED')
    return {date:current.plan.planDate,sequence:current.plan.planSequence,warehouse:row.stock.warehouse,location:row.stock.location,
      lot:row.stock.lot,material:row.stock.material,quantity:row.quantity,slot:processSlot??undefined,source}
  }
  async function saveManual(cmd:ManualIssue){
    if(sendingManual.current)return
    sendingManual.current=true;setApplying(true);setManualPending(cmd)
    const line=cmd.line,scope=JSON.stringify([actor,workCode,processSlot,line.date,line.sequence])
    try{
      sessionStorage.setItem(manualKey,JSON.stringify(cmd))
      await productionRequest('/api/pop/work-orders/'+line.date+'/'+line.sequence+'/production-materials/manual',cmd,workCode)
      sessionStorage.removeItem(manualKey);setManualPending(undefined)
      const k=JSON.stringify([line.warehouse,line.location,line.lot,line.material])
      setScanRows(old=>({...old,[scope]:(old[scope]??[]).filter(r=>stockKey(r.stock)!==k)}))
      setAttempt(n=>n+1);setDetailAttempt(n=>n+1)
    }catch(e){
      if(e instanceof SessionExpired){onSessionExpired();return}
      if(e instanceof ProductionError && [400,403,404,409,422].includes(e.status)){
        sessionStorage.removeItem(manualKey);setManualPending(undefined);setAttempt(n=>n+1);setDetailAttempt(n=>n+1)
      }
      setActionNotice(e instanceof ProductionError?e.message:'응답을 확인할 수 없습니다. 같은 자재 요청으로 재시도하십시오.')
    }finally{sendingManual.current=false;setApplying(false)}
  }
  function applyManual(rows:LotPick[],focused?:LotPick){
    const tagged=manualKeys.current.get(scanScope)??new Set<string>()
    rows.forEach(row=>{if(!pickedLots.some(old=>stockKey(row.stock)===stockKey(old.stock)&&row.quantity===old.quantity))tagged.add(stockKey(row.stock))})
    manualKeys.current.set(scanScope,tagged)
    if(focused)manualFocus.current.set(scanScope,stockKey(focused.stock))
    const target=focused??rows.find(r=>stockKey(r.stock)===manualFocus.current.get(scanScope))
    if(current && (active||paused) && target){
      void saveManual({requestId:crypto.randomUUID(),revision:current.revision,line:issueLine(target,'manual')})
    }
  }
  const startAt=selected && readMeta(selected)?.started
  function focusWork(row:WorkOrder,check?:boolean){
    const k=rowId(row),g=readMeta(row)?.group,move=!selected || rowId(selected)!==k
    setChecked(old=>{
      const priorGroup=list.some(r=>old.includes(rowId(r))&&readMeta(r)?.group)
      const members=g?list.filter(r=>readMeta(r)?.group===g).map(rowId):[k]
      if(check===false)return old.filter(id=>!members.includes(id))
      if(!move && check!==true)return old
      if(g && priorGroup)return members
      const retained=!g&&move&&priorGroup?[]:old
      return [...new Set([...retained,...members])]
    })
    if(move)selectOrder(row)
  }
  async function runBatch(action:'START'|'PAUSE'|'RESUME'|'COMPLETE'){
    if(applying||manualPending||sending.current)return
    const selectedRows=!markedRows.length&&(action==='PAUSE'||action==='RESUME')?list.slice(0,1):markedRows
    if(!pending && !selectedRows.length){setActionNotice(action==='COMPLETE'?'작업완료 할 항목을 선택해주세요.':'작업지시서를 체크해주세요.');return}
    const values=(r:WorkOrder):ProductionRow=>({date:r.planDate,sequence:r.planSequence,revision:readMeta(r)?.revision??-1,
      good:good[rowId(r)]??null,arrangement:arrangement[rowId(r)]??null,
      goodPlace:processOne&&processSlot&&goodPlaces[rowId(r)]&&(action==='START'||action==='COMPLETE')
        ? {warehouse:goodPlaces[rowId(r)].warehouse,location:goodPlaces[rowId(r)].location,slot:processSlot}:undefined})
    const firstStart=action==='START'&&markedRows.every(row=>row.status==='WAITING')
    const materialDrafts=firstStart&&current?draftMaterials.filter(d=>current.plan.planDate===d.date&&current.plan.planSequence===d.sequence):[]
    const focus=selected?{date:selected.planDate,sequence:selected.planSequence}:undefined
    const scannedIssues=current && firstStart
      ?pickedLots.map(p=>issueLine(p,manualKeys.current.get(scanScope)?.has(stockKey(p.stock))?'manual':'scan')):undefined
    const cmd=pending??{requestId:crypto.randomUUID(),action,selected:selectedRows.map(values),scannedIssues,visible:list.map(values),autoPrint:action==='COMPLETE'&&autoPrint,materialDrafts,focus}
    try{sessionStorage.setItem(batchKey,JSON.stringify(cmd))}catch{setActionNotice('재시도 정보를 저장할 수 없습니다.');return}
    setPending(cmd);sending.current=true
    setApplying(true)
    try{
      const result=await productionRequest<{printStatus:string;device:string|null}>('/api/pop/work-orders/production',cmd,workCode)
      sessionStorage.removeItem(batchKey);setPending(undefined)
      if(result.printStatus==='SYNTHETIC_PRINTED')setActionNotice('합성 문서 프린터로 전송되었습니다.')
      else if(result.printStatus==='DOCUMENT_PRINTER_NOT_CONFIGURED')setActionNotice('문서 프린터를 설정하십시오.')
      else if(result.printStatus==='FONT_NOT_CONFIGURED')setActionNotice('출력 글꼴을 설정하십시오.')
      if(cmd.action==='START'||cmd.action==='COMPLETE')setScanRows(old=>{const next={...old};for(const r of cmd.selected)delete next[JSON.stringify([actor,workCode,processSlot,r.date,r.sequence])];return next})
      setGoodPlaces(old=>Object.fromEntries(Object.entries(old).filter(([key])=>!cmd.selected.some(r=>r.goodPlace && key===r.date+'/'+r.sequence))))
      setModal(undefined);setGood({});setArrangement({});setDraftMaterials(old=>old.filter(d=>!cmd.selected.some(r=>r.date===d.date&&r.sequence===d.sequence)));setAttempt(n=>n+1);setDetailAttempt(n=>n+1)
    }catch(e){
      if(e instanceof SessionExpired)onSessionExpired()
      else if(e instanceof ProductionError && [400,403,404,409,422].includes(e.status)){sessionStorage.removeItem(batchKey);setPending(undefined);setActionNotice(e.message);setAttempt(n=>n+1)}
      else setActionNotice('처리 결과를 확인할 수 없습니다. 동일 명령으로 다시 시도하십시오.')
    }finally{sending.current=false;setApplying(false)}
  }
  function confirm(text:string,yes:()=>void){setAsk({text,yes})}
  async function remove(requested:WorkOrder[]){
    if(!list.length || someComplete){setActionNotice(someComplete?'작업완료된 건이 존재합니다. 확인하십시오.':'작업 리스트를 스캔하여 주십시오.');return}
    if(applying)return
    setApplying(true);const ctl=new AbortController()
    try{
      const detailRows=await Promise.all(list.map(o=>loadWorkOrder(o,ctl.signal)))
      const visible=detailRows.map(d=>({date:d.plan.planDate,sequence:d.plan.planSequence,revision:d.revision}))
      const targets=visible.filter(k=>requested.some(o=>o.planDate===k.date&&o.planSequence===k.sequence))
      await getSessionData('/api/pop/work-orders/remove',ctl.signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),visible,selected:targets})})
      setGoodPlaces(old=>Object.fromEntries(Object.entries(old).filter(([key])=>!targets.some(r=>key===r.date+'/'+r.sequence))))
      setChecked([]);refresh()
    }catch(e){if(e instanceof SessionExpired)onSessionExpired();else setActionNotice('작업지시를 삭제할 수 없습니다. 상태를 확인하십시오.')}
    finally{setApplying(false)}
  }
  function openMaterial(type:'issue'|'return'){
    if(!current){setActionNotice('작업 리스트를 스캔하여 주십시오.');return}
    if(someComplete){setActionNotice('작업완료된 건이 존재합니다. 확인하십시오.');return}
    if(type==='return' && !returnWarehouses.length){setActionNotice('반납창고가 설정되지 않았습니다. 환경설정을 확인하십시오.');return}
    if(type==='issue'&&processOne&&!issueWarehouses.length){setActionNotice('투입창고가 설정되지 않았습니다. 환경설정을 확인하십시오.');return}
    setModal(type)
  }
  return <section className="prod-board" aria-label="작업지시 목록">
    <header className="prod-toolbar"><Scanner onClick={()=>{setScanNotice('');setModal('scan')}}/>
      <div className="prod-info"><span>재질　<b>{current?.plan.display?.quality||'-'}</b></span><span>시작시간　<b>{startAt?new Date(startAt).toLocaleTimeString('ko-KR',{hour12:false}):'-'}</b></span></div>
      {printingAllowed && <label className="prod-auto"><input type="checkbox" aria-label="생산계획 자동 프린트" checked={autoPrint} onChange={e=>setAutoPrint(e.target.checked)}/><span>생산계획<br/>자동 프린트</span></label>}
      <Tool code="START" label="작업 시작" disabled={applying||!!pending||!!manualPending||!(state==='WAITING'||active&&markedRows.some(r=>r.status==='WAITING'))} onClick={()=>confirm('작업 시작하시겠습니까?',()=>void runBatch('START'))}/>
      <Tool code={paused?'RESTART':'STOP'} label={paused?'재시작':'작업중단'} color="yellow" disabled={applying||!!pending||!!manualPending||!(active||paused)} onClick={()=>confirm(paused?'작업 재시작 하시겠습니까?':'작업 일시 중단 하시겠습니까?',()=>void runBatch(paused?'RESUME':'PAUSE'))}/>
      <Tool code="END" label="작업 완료" color="orange" disabled={applying||!!pending||!!manualPending||!active} onClick={()=>confirm('작업완료 하시겠습니까?',()=>void runBatch('COMPLETE'))}/>
      <Tool code="PLAN" label="생산계획" onClick={()=>setPane('choose')}/><Tool code="PLAN" label="계획현황" color="cyan" onClick={()=>setPane('status')}/>
      <Tool code="DELETE" label="일괄삭제" color="orange" disabled={applying} onClick={()=>{if(!list.length||someComplete){void remove(list);return}confirm('작업지시 번호를 일괄삭제 하시겠습니까?',()=>void remove(list))}}/>
      <Tool code="PRINT" label="프린트" color="green"/>
    </header>
    <div className="prod-middle"><div className="prod-tables"><div className="prod-scroll"><table aria-label="작업지시 목록"><thead><Head headers={['선택','순번','거래처명 / 수주번호','납기일','두께','폭','길이','수주량','생산잔량','생산수량','불량수량','창고명','로케이션','배치수','시작시간','선택삭제','생산그룹번호']}/></thead>
      <tbody>{list.map((row,i)=>{const k=rowId(row),chosen=selected && rowId(selected)===k,place=goodPlaces[k]??readMeta(row)?.goodPlace
        return <tr key={k} aria-current={!!chosen} onClick={()=>{if(!applying)focusWork(row)}}>
          <td><input type="checkbox" aria-label={row.orderNumber+' / '+row.orderLine} checked={checked.includes(k)} onClick={e=>e.stopPropagation()} onChange={e=>focusWork(row,e.target.checked)}/></td>
          <td>{i+1}</td><td>{row.display?.customer}<br/>{row.orderNumber} / {row.orderLine}</td><td>{row.display?.deliveryDate}</td><td>{row.display?.thickness}</td><td>{row.display?.width}</td><td>{row.display?.length}</td>
          <td>{row.plannedQuantity}</td><td>{readMeta(row)?.remaining==null?'':quantity.format(readMeta(row)!.remaining!)}</td>
          <td>{row.status!=='COMPLETE'?<button type="button" className="rev-num" aria-label={k+' 생산수량'} onClick={()=>setCell({row,field:'good'})}>{good[k]??readMeta(row)?.produced??''}</button>:readMeta(row)?.produced}</td>
          <td>{row.status==='IN_PROGRESS'||row.status==='PAUSED'?<button type="button" className="rev-num" aria-label={k+' 불량수량'} onClick={()=>setRejection(row)}>{readMeta(row)?.bad||''}</button>:readMeta(row)?.bad||''}</td>
          {(['warehouseName','locationName'] as const).map((field,idx)=><td key={field} className={processOne?'production-good-'+field:undefined}>
            {processOne && processSlot && row.status!=='COMPLETE' ? <button type="button" className="rev-num" disabled={applying||!!pending||!!manualPending}
              aria-label={k+(idx===0?' 창고명':' 로케이션')} onClick={()=>setGoodPlaceRow(row)}>{place?.[field]}</button>:processOne?place?.[field]:null}
          </td>)}
          <td>{row.status!=='COMPLETE'?<button type="button" className="rev-num" aria-label={k+' 배치수'} onClick={()=>setCell({row,field:'arrangement'})}>{arrangement[k]??readMeta(row)?.arrangement??''}</button>:readMeta(row)?.arrangement}</td>
          <td>{readMeta(row)?.started?new Date(readMeta(row)!.started!).toLocaleTimeString('ko-KR',{hour12:false}):''}</td>
          <td><button type="button" aria-label={k+' 선택삭제'} onClick={e=>{e.stopPropagation();void remove([row])}}>삭제</button></td><td>{readMeta(row)?.group}</td></tr>})}</tbody></table></div></div>
      <ProductionStages kind="" values={Object.fromEntries((current?.steps??[]).map(s=>[s.name,labels[s.status]]))}/></div>
    <ProductionMaterialGrid key={selected?rowId(selected):''} actor={actor} plan={current?.plan}
      visible={list.map(r=>({date:r.planDate,sequence:r.planSequence,revision:readMeta(r)?.revision??-1}))}
      hasCompleted={someComplete} locked={applying||!!pending||!!manualPending} attempt={detailAttempt} drafts={draftMaterials}
      onDraft={draft=>setDraftMaterials(old=>[...old.filter(d=>d.date!==draft.date||d.sequence!==draft.sequence||d.action!==draft.action),draft])}
      extraIssueRows={processOne && current && <ProcessLotRows key={scanScope} date={current.plan.planDate} sequence={current.plan.planSequence}
        rows={pickedLots} onRows={rows=>setScanRows(old=>({...old,[scanScope]:rows}))} open={modal==='lot'||modal==='issue'}
        slot={processSlot??undefined} mode={modal==='issue'?'manual':'scan'} onManualApplied={applyManual} onClose={()=>setModal(undefined)} onSessionExpired={onSessionExpired}/>}
      scanCount={pickedLots.length} checkedScanCount={pickedLots.filter(p=>p.checked).length} removeCheckedScans={()=>setScanRows(old=>({...old,[scanScope]:(old[scanScope]??[]).filter(p=>!p.checked)}))}
      onRefresh={()=>{setAttempt(n=>n+1);setDetailAttempt(n=>n+1)}} onAdd={openMaterial} onScan={()=>{if(processOne && (!current||someComplete))setActionNotice(someComplete?'작업완료된 건이 있으므로 자재투입 불가능합니다.':'작업 리스트를 스캔하여 주십시오.');else if(processOne&&!issueWarehouses.length)setActionNotice('투입창고가 설정되지 않았습니다. 환경설정을 확인하십시오.');else setModal('lot')}} onExpired={onSessionExpired}/>
    {pane && <ProcessPlans initial={pane} actor={actor} workCode={workCode} parentQualities={list.flatMap(o=>o.display?.quality?[o.display.quality]:[])} onClose={()=>{focusPolicy.current='all';setPane(undefined);setAttempt(n=>n+1)}}
      onAttached={keys=>{setAttempt(n=>n+1);setChecked(keys.map(k=>k.date+'/'+k.sequence))}} onSessionExpired={onSessionExpired}/>}
    {(modal==='scan'||modal==='lot'&&!processOne) && <Pop label={modal==='scan'?'작업지시 스캔':'투입 LOT 스캔'} kind="rev-prompt" onClose={()=>setModal(undefined)}>
      <ScanInput actor={actor} disabled={applying} modes={modal==='scan'?[{value:'work-order',label:'작업지시'}]:[{value:'lot',label:'LOT'}]} onRoute={r=>{handleScan(r);if(r.kind==='lot')setModal('issue')}}/>{scanNotice && <p>{scanNotice}</p>}<button type="button" onClick={()=>setModal(undefined)}>닫기</button></Pop>}
    {(modal==='issue'&&!processOne||modal==='return') && current && <Pop label={modal==='issue'?'투입자재 선택':'반납자재 선택'} kind="rev-lookup" onClose={()=>setModal(undefined)}>
      <label>LOT<select value={lotCode} onChange={e=>chooseLot(e.target.value)}><option value="">LOT 선택</option>{current.materials.map(l=><option key={l.lotCode}>{l.lotCode}</option>)}</select></label>
      {modal==='issue'?<label>창고 / 로케이션<select value={candidate?positionKey(candidate.position):''} onChange={e=>setStockPosition(e.target.value)}><option value="">위치 선택</option>{material?.positions.map(p=><option key={positionKey(p.position)} value={positionKey(p.position)}>{positionLabel(p.position)} · {p.availableQuantity}</option>)}</select></label>:<p>반납 위치 {positionLabel(current.returnPosition)}</p>}
      <TouchField label={modal==='issue'?'투입수량':'반납수량'} layout="decimal" value={materialQuantity} onValueChange={setMaterialQuantity}/>
      <footer><button type="button" disabled={!editable||!validMaterialQuantity||(modal==='issue'?!candidate||amount>candidate.availableQuantity:!canReturn||!material||amount>material.issuedQuantity)}
        onClick={()=>moveMaterial(current,modal==='issue'?'ISSUE_MATERIAL':'RETURN_MATERIAL')}>적용</button><button type="button" onClick={()=>setModal(undefined)}>닫기</button></footer></Pop>}
    {cell && <CommonNumericPad mode="decimal" onCancel={()=>setCell(undefined)} onApply={qty=>{
      const id=rowId(cell.row)
      if(cell.field==='good')setGood(draft=>({...draft,[id]:String(Math.min(Number(qty),readMeta(cell.row)?.remaining??cell.row.plannedQuantity))}))
      else setArrangement(draft=>({...draft,[id]:qty}))
      setCell(undefined)
    }}/>}
    {rejection && <WorkRejections actor={actor} path={'/api/pop/work-orders/'+rejection.planDate+'/'+rejection.planSequence+'/rejections'} onClose={()=>setRejection(undefined)}
      onError={text=>{setRejection(undefined);setActionNotice(text)}} onSaved={()=>{setRejection(undefined);setAttempt(n=>n+1);setDetailAttempt(n=>n+1);setActionNotice('적용 되었습니다.')}} onExpired={onSessionExpired}/>}
    {goodPlaceRow && processSlot && <GoodProductLocationDialog key={rowId(goodPlaceRow)} date={goodPlaceRow.planDate} sequence={goodPlaceRow.planSequence}
      slot={processSlot} draft={goodPlaces[rowId(goodPlaceRow)]} onClose={()=>setGoodPlaceRow(undefined)} onExpired={onSessionExpired}
      onApply={place=>{setGoodPlaces(old=>({...old,[rowId(goodPlaceRow)]:place}));setGoodPlaceRow(undefined)}}/>}
    {manualPending && <button type="button" className="prod-status" disabled={applying} onClick={()=>void saveManual(manualPending)}>같은 자재 요청 재시도</button>}
    {pending && <button type="button" className="prod-status" disabled={applying} onClick={()=>void runBatch(pending.action)}>동일 명령 재시도</button>}
    {ask && <Pop label="확인" kind="rev-prompt" onClose={()=>setAsk(undefined)}><p>{ask.text}</p><footer><button onClick={()=>{setAsk(undefined);ask.yes()}}>예</button><button onClick={()=>setAsk(undefined)}>아니오</button></footer></Pop>}
    {actionNotice && <Pop label="작업지시 안내" kind="rev-prompt" onClose={()=>setActionNotice('')}><p>{actionNotice}</p><button type="button" onClick={()=>setActionNotice('')}>확인</button></Pop>}
  </section>
}
