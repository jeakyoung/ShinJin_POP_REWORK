import { useLayoutEffect, useRef, useState } from 'react'
import GroupMaterialScan,{type GroupPick} from './GroupMaterialScan'
import {key as stockKey} from './processLot/processStockTypes'
import CommonScanDialog from './commonInput/CommonScanDialog'
import WorkRejections from './WorkRejections'
import TouchField from './TouchField'
import './processGroupScreen.css'
import GroupReturnGrid from './GroupReturnGrid'
import {returnProblem} from './groupReturn'
import type {Material,ReturnRow} from './groupReturn'
import ProcessPlans from './ProcessPlans'
import CommonNumericPad from './commonInput/CommonNumericPad'
import {InventoryMessage} from './InventoryDialogs'

type Stage = { process: string; warehouse: string; processCode?: string; warehouseCode?: string }
type Result = { groupId:string; plan: string; stage: Stage; good: number; bad: number }
type OrderRow={plan:string;barcode:string;planned:number;remaining:number;previousGood:number|null;spec:{qualityName:string;thickness:string;width:string};startTime:string}
type View = {
  focusGroups:Record<string,string[]>
  orders:OrderRow[]
  setting: { stages: Stage[]; inputLot: string; inputQty: number }
  scanned:GroupPick[]
  badTotals:Record<string,number>
  activeInput: { groupId: string; paused: boolean; quantity: number } | null
  material:Material|null; returns:ReturnRow[]; revision: number; ready: string[]; started: string[]; results: Result[]
}
type Transition = 'STOP' | 'RESTART'
type Props = { actor:string; workCode?:string; onSessionExpired: () => void }

export default function ProcessGroupDemo({ actor,workCode,onSessionExpired }: Props) {
  const [view, setView] = useState<View>()
  const [refresh, setRefresh] = useState(0)
  const [orderScan,setOrderScan]=useState(false)
  const [orderDraft,setOrderDraft]=useState<OrderRow[]>([])
  const [focus, setFocus] = useState('')
  const [amounts, setAmounts] = useState<Record<string, { good?: string }>>({})
  const [busy, setBusy] = useState(false)
  const [rejection,setRejection]=useState<string>()
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController | null>(null)
  const [draft,setDraft]=useState<ReturnRow[]>([])
  const [command,setCommand]=useState<'START'|'FINISH'|'DELETE'>('START')
  const [inputQty, setInputQty] = useState(0)
  const [inputs,setInputs]=useState<GroupPick[]>([])
  const [scan,setScan]=useState(false)
  const [inputPad, setInputPad] = useState<string>()
  const [transition, setTransition] = useState<Transition>()
  const [reverse,setReverse]=useState(false)
  const [error,setError]=useState('')
  const confirm = useRef<HTMLDialogElement>(null)
  const url = '/api/pop/process-group-demo'
  useLayoutEffect(() => {
    const controller = new AbortController()
    fetch(url, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (controller.signal.aborted) return
      if (response.status === 401) return onSessionExpired()
      if (!response.ok) throw Error()
      const current: View = await response.json()
      if (!controller.signal.aborted) {setOrderDraft([]);setView(current);setInputs(current.scanned);setInputQty(current.activeInput?.quantity ?? current.setting.inputQty);setDraft(current.returns??[]);setFocus(current.started[0]??current.ready[0]??'')}
    }).catch(() => { if (!controller.signal.aborted) setNotice('그룹 작업을 불러오지 못했습니다.') })
    return () => { controller.abort(); active.current?.abort() }
  }, [url, onSessionExpired, refresh])

  function setStockQuantity(id:string,value:number){
    setInputs(rows=>rows.map(row=>stockKey(row.stock)===id?{...row,quantity:Math.min(row.stock.available,value)}:row))
  }
  const finishing = !!view?.started.length
  const plans = view ? [...(finishing ? view.started : view.ready),...orderDraft.map(row=>row.plan)] : []
  const rowFor=(plan:string)=>view?.orders.find(row=>row.plan===plan)
  const focused=plans.includes(focus)?focus:plans[0]
  const selectedRow=rowFor(focused)
  const checked=plans.filter(plan=>view?.focusGroups[focused]?.includes(plan))
  const startedFocus=!!view?.started.includes(focused)
  const focusedDraft=orderDraft.find(row=>row.plan===focused)
  function focusRow(plan:string){
    if(plan===focused || !view)return
    const started=view.started.includes(plan)
    setFocus(plan)
    setInputs(started?view.scanned:[])
    setDraft(started?view.returns:[])
    setInputQty(started && view.activeInput?view.activeInput.quantity:view.setting.inputQty)
  }
  async function readOrder(raw?:string,signal?:AbortSignal):Promise<OrderRow|undefined>{
    const response=await fetch(url+'/order-scan'+(raw===undefined?'':'?raw='+encodeURIComponent(raw)),{cache:'no-store',signal})
    if(response.status===401){onSessionExpired();return}
    if(response.ok)return response.status===204?undefined:await response.json()
    const body=await response.json()
    const messages:Record<string,string>={GOOD_WAREHOUSE_REQUIRED:'양품창고가 설정되지 않았습니다. 환경설정을 확인하십시오.',
      WORK_ORDER_COMPLETE:'작업 완료된 건입니다. 확인 후 다시 스캔하십시오.',WORK_ORDER_IN_LIST:'이미 등록된 작업지시입니다.'}
    throw Error(messages[body.code]??'유효한 작업지시번호가 아닙니다.')
  }
  async function openOrderScan(){
    if(active.current)return
    const controller=new AbortController();active.current=controller;setBusy(true)
    try{await readOrder(undefined,controller.signal);if(!controller.signal.aborted)setOrderScan(true)}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'작업지시 조회 오류')}
    finally{if(active.current===controller)active.current=null;if(!controller.signal.aborted)setBusy(false)}
  }
  function goodValue(plan:string){
    return amounts[plan]?.good ?? String(view?.orders.find(row=>row.plan===plan)?.previousGood ?? '')
  }
  async function submit(action:'START'|'FINISH'|'DELETE'|'DELETE_RETURNS'|Transition, ids?:string[]) {
    if (!view || active.current) return false
    if(action==='FINISH'){
      if(orderDraft.length && view.started.some(plan=>Number(goodValue(plan))<1)){setError('생산수량을 입력하십시오.');return false}
      if(orderDraft.length){setError('작업 일괄 시작 후 작업 완료 가능합니다. 확인하십시오.');return false}
    }
    if(action==='START'||action==='FINISH'){
      if(action==='FINISH' && ((inputQty<1 && (view.setting.inputLot || !inputs.length)) || inputs.some(row=>row.quantity<1))){setError('투입수량을 입력하십시오.');return false}
      const problem=returnProblem(draft,info??null,action==='FINISH')
      if(problem){setError(problem);return false}
    }
    if(action==='DELETE'&&!checked.length){setError('삭제할 작업지시번호를 선택하십시오.');return false}
    const localPlanIds=orderDraft.map(row=>row.plan)
    const persistedSelection=checked.filter(plan=>!localPlanIds.includes(plan))
    if(action==='DELETE' && !persistedSelection.length){
      setOrderDraft(rows=>rows.filter(row=>!checked.includes(row.plan)))
      const nextFocus=plans.find(plan=>!checked.includes(plan))
      if(nextFocus)focusRow(nextFocus)
      else {setFocus('');setInputs([]);setDraft([]);setInputQty(view.setting.inputQty)}
      return true
    }
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setNotice('')
    try {
      const changingState = action==='STOP' || action==='RESTART'
      const lines = changingState ? undefined : action==='FINISH' ? view.started.map(plan => ({ plan, good:goodValue(plan)||null, bad:String(view.badTotals[plan]??0) })) : (action==='DELETE'?persistedSelection:checked).map(plan => ({ plan }))
      const response = await fetch(url+'?'+new URLSearchParams({...focused && {focus:focused},...focusedDraft && {order:focusedDraft.barcode}}), { method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',...(workCode?{'X-Pop-Work-Code':workCode}:{})},
        body:JSON.stringify({ action,revision:view.revision,lines,
          orderScans:action==='START'?orderDraft.filter(row=>checked.includes(row.plan)).map(row=>row.barcode):undefined,
          groupId:changingState || action==='FINISH' ? view.activeInput?.groupId : undefined,
          inputs:action==='START'||action==='FINISH'?inputs.map(({stock,quantity})=>({lot:stock.lot,warehouse:stock.warehouse,location:stock.location,material:stock.material,quantity})):undefined,
          inputQuantity:action==='START'||action==='FINISH' ? inputQty : undefined,
          returns:action==='START'||action==='FINISH'?draft:undefined,returnIds:ids }) })
      if(controller.signal.aborted)return false
      if(response.status===401){onSessionExpired();return false}
      if(response.status===422){
        const failure=await response.json().catch(()=>null)
        setError(failure?.code==='PRODUCTION_QUANTITY_REQUIRED'?'생산수량을 입력하십시오.':'입력값을 확인하십시오.')
        return false
      }
      if(response.status===409){
        const failure=await response.json().catch(()=>null)
        if(failure?.code==='GOOD_WAREHOUSE_REQUIRED'){setError('양품창고가 설정되지 않았습니다. 환경설정을 확인하십시오.');return false}
      }
      if(!response.ok)throw Error()
      const next:View=await response.json()
      if(controller.signal.aborted)return false
      setOrderDraft(action==='DELETE'?orderDraft.filter(row=>!checked.includes(row.plan)):[]);setView(next)
      if(changingState||action==='START'||action==='FINISH'||(action==='DELETE' && !(finishing?next.started:next.ready).length))setInputs(next.scanned)
      if(action!=='DELETE_RETURNS'){
        const sameGroup=action==='DELETE' && (finishing?next.started.length:next.ready.length)>0
        if(!sameGroup) {
          setDraft(next.returns)
          setInputQty(next.activeInput?.quantity ?? next.setting.inputQty)
        }
        setFocus(next.started[0]??next.ready[0]??'');setAmounts({})
      }
      if(changingState)setError(action==='STOP'?'작업 일시 중단 되었습니다.':'작업 재시작 되었습니다.')
      return true
    }catch{
      if(!controller.signal.aborted){setView(undefined);setNotice('처리 결과를 다시 조회하세요.')}
      return false
    }finally{
      if(active.current===controller)active.current=null
      if(!controller.signal.aborted)setBusy(false)
    }
  }
  async function remove(ids:string[]){
    const stored=ids.filter(id=>view?.returns.some(r=>r.id===id))
    if(stored.length && !await submit('DELETE_RETURNS',stored))return false
    setDraft(old=>old.filter(r=>!ids.includes(r.id)));return true
  }
  function ask(action:'START'|'FINISH'|'DELETE'){
    if(action==='DELETE'&&!checked.length){setError('삭제할 작업지시번호를 선택하십시오.');return}
    setCommand(action);confirm.current?.showModal()
  }
  const stages = view?.setting.stages ?? []
  const canStart = !busy && stages.length > 0 && !finishing && checked.length > 0
  const canFinish = !busy && finishing && !view.activeInput?.paused && view.started.every(plan=>checked.includes(plan))
  const title = command==='DELETE'?'선택한 작업지시 번호를 삭제 하시겠습니까?':command==='FINISH'?'그룹 실적 완료':'그룹 작업 시작'
  const info=selectedRow && view?.material?{...view.material,thickness:Number(selectedRow.spec.thickness),width:Number(selectedRow.spec.width)}:undefined
  return <section className="group5" aria-label="그룹 작업"><div className="group5-scroll"><div className="group5-form">
    <header className="group5-bar"><button className="group5-scan" aria-label="작업지시 스캔" disabled={busy || !view} onClick={()=>void openOrderScan()} />
      <span className="group5-grade">재질 :　<b>{selectedRow?.spec.qualityName??'-'}</b></span><span className="group5-thickness">두께　<b>{selectedRow?.spec.thickness??'-'}</b></span><span className="group5-width">폭　<b>{selectedRow?.spec.width??'-'}</b></span>
      <button className="group5-start" aria-label="그룹 작업 시작" disabled={!canStart} onClick={()=>ask('START')}>START<small>작업시작</small></button>
      <button className="group5-stop" disabled={busy || !startedFocus} onClick={()=>setTransition(view?.activeInput?.paused?'RESTART':'STOP')}>
        {view?.activeInput?.paused?'RESTART':'STOP'}<small>{view?.activeInput?.paused?'재시작':'작업중단'}</small></button>
      <button className="group5-finish" aria-label="그룹 실적 완료" disabled={!canFinish} onClick={()=>ask('FINISH')}>END<small>작업완료</small></button>
      <button className="group5-reverse" disabled={!view||busy} onClick={()=>setReverse(true)}>REVERSE<small>역발행</small></button>
      <button className="group5-delete" disabled={!plans.length||busy} onClick={()=>ask('DELETE')}>DELETE<small>선택삭제</small></button>
      <button className="group5-print" disabled>PRINT<small>프린트</small></button>
    </header>
    <div className="group5-grid"><table aria-label="그룹 작업지시"><colgroup>{[50,50,150,80,70,70,70,70,70,70,70,60,90,70,70,70,50].map((width,i)=><col key={i} style={{width}} />)}</colgroup>
    <thead><tr>{['선택','순번','거래처명 / 수주번호','납기일','두께','폭','길이','수주량','생산잔량','생산수량','불량수량','창고명','로케이션명','배치수','시작시간','종료시간',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
    <tbody>{plans.map((plan,i)=><tr key={plan} tabIndex={0} aria-selected={focused===plan} onFocus={()=>focusRow(plan)} onClick={()=>focusRow(plan)}><td><label><input aria-label={plan} type="checkbox" checked={checked.includes(plan)} readOnly tabIndex={-1}/>{plan}</label></td><td>{i+1}</td>
      {['','',rowFor(plan)?.spec.thickness,rowFor(plan)?.spec.width,'','',view?.orders.find(row=>row.plan===plan)?.remaining].map((value,col)=><td key={col}>{value}</td>)}
      <td><TouchField layout="decimal" label={plan+' 양품'} value={goodValue(plan)} disabled={busy}
        onValueChange={good=>setAmounts(old=>({...old,[plan]:{good}}))}/></td>
      <td>{view?.started.includes(plan) && <button type="button" disabled={busy} aria-label={plan+' 불량수량'} onClick={()=>setRejection(plan)}>{view.badTotals[plan]??0}</button>}</td>
      {Array.from({length:6},(_,col)=><td key={'tail'+col}>{col===3?rowFor(plan)?.startTime:''}</td>)}</tr>)}</tbody></table></div>
    <div className="group5-progress"><span>선택건<br/>공정진행현황</span><table aria-label="선택건 공정진행현황"><thead><tr>{['발주','소재입고','폭 절단','평탄','평면','측면','길이절단','포장'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody><tr>{Array.from({length:8},(_,i)=><td key={i}/>)}</tr></tbody></table><span>품목유형 :　<b>-</b></span></div>
    <div className="group5-material inputs"><header><strong>투입자재</strong><button disabled={busy || !view} onClick={()=>setScan(true)} aria-label="투입자재 스캔" className="material-scan"/><button disabled aria-label="투입자재 추가">＋</button><button disabled aria-label="투입자재 삭제">－</button></header>
      <table aria-label="투입자재"><colgroup>{[50,80,80,65,65,35,60,35].map((width,i)=><col key={i} style={{width}} />)}</colgroup>
        <thead><tr>{['선택','창고','로케이션','길이','재고'].map(h=><th key={h}>{h}</th>)}<th colSpan={3}>투입수량</th></tr></thead>
        <tbody>{!!plans.length && view?.setting.inputLot && <tr><td/><td/><td/><td/><td>{view.setting.inputQty}</td>
          <td><button disabled={busy} className="input-minus" aria-label="투입수량 감소" onClick={()=>setInputQty(n=>n<2?n:n-1)} /></td>
          <td><button disabled={busy} aria-label="투입수량 입력" onClick={()=>setInputPad('base')}>{inputQty}</button></td>
          <td><button disabled={busy} className="input-plus" aria-label="투입수량 증가" onClick={()=>setInputQty(n=>Math.min(view.setting.inputQty,n+1))} /></td>
        </tr>}{inputs.map(row=><tr key={stockKey(row.stock)} data-group-lot={row.stock.lot}>
          <td>✓</td><td>{row.stock.warehouse}</td><td>{row.stock.location}</td><td>{row.stock.length}</td>
          <td>{row.stock.available}</td><td><button disabled={busy} className="input-minus" aria-label={row.stock.location+' 투입수량 감소'} onClick={()=>setStockQuantity(stockKey(row.stock),row.quantity<2?row.quantity:row.quantity-1)}/></td>
          <td><button disabled={busy} aria-label={row.stock.location+' 투입수량 입력'} onClick={()=>setInputPad(stockKey(row.stock))}>{row.quantity}</button></td>
          <td><button disabled={busy} className="input-plus" aria-label={row.stock.location+' 투입수량 증가'} onClick={()=>setStockQuantity(stockKey(row.stock),row.quantity+1)}/></td></tr>)}</tbody></table>
      {scan && view && <GroupMaterialScan rows={inputs} focus={focused} order={focusedDraft?.barcode} code={workCode} onRows={setInputs}
        onClose={()=>setScan(false)} onExpired={onSessionExpired}/>}
      {inputPad && view && <CommonNumericPad mode="integer" onCancel={()=>setInputPad(undefined)}
        onApply={raw=>{
          const value=Number(raw)
          if(inputPad==='base')setInputQty(Math.min(value,view.setting.inputQty))
          else setStockQuantity(inputPad,value)
          setInputPad(undefined)
        }}/>}
    </div>
    {view && <GroupReturnGrid rows={draft} material={info??null} enabled={!!plans.length} hasInput={(!!view.setting.inputLot && view.setting.inputQty>0) || !!inputs.length} busy={busy} change={setDraft} remove={remove}/>}
    </div>
    {view && <div className="group5-details"><p>투입 LOT {view.setting.inputLot} · 수량 {inputQty}</p>
      <ol>{stages.map(s=><li key={s.process}>{s.process} · {s.warehouse}</li>)}</ol>
      {!stages.length && <p>공정·창고 순서가 설정되지 않아 그룹 작업을 시작할 수 없습니다.</p>}
      {!!view.results.length && <table><caption>계획별 공정 실적</caption><thead><tr>{['계획','공정','창고','양품','불량'].map(h=><th key={h}>{h}</th>)}</tr></thead>
      <tbody>{view.results.map((r,i)=><tr key={i} data-group={r.groupId}><th>{r.plan}</th><td>{r.stage.process}</td><td>{r.stage.warehouse}</td><td>{r.good}</td><td>{r.bad}</td></tr>)}</tbody></table>}</div>}
    </div><p role="status">{notice}</p>{notice && !view && <button onClick={()=>{setNotice('');setRefresh(n=>n+1)}}>다시 조회</button>}
    <dialog ref={confirm} className="floor-confirm" aria-label={title+' 확인'}><h3>{title} 확인</h3><p>{(command==='FINISH'?plans:checked).join(', ')}</p>
      <button onClick={()=>confirm.current?.close()}>취소</button><button disabled={busy} onClick={()=>{confirm.current?.close();void submit(command)}}>확정</button></dialog>
    {transition && <InventoryMessage text={transition==='STOP'?'작업 일시 중단 하시겠습니까?':'작업 재시작 하시겠습니까?'}
      onClose={()=>setTransition(undefined)} onYes={()=>{setTransition(undefined);void submit(transition)}} />}
    {orderScan && <CommonScanDialog mode="order" position={{left:70,top:490}} onEnter={async(raw,signal)=>{
      const row=await readOrder(raw,signal)
      if(!row || signal.aborted)return {next:'retry'}
      if(plans.includes(row.plan)){setError('이미 등록된 작업지시입니다.');return {next:'retry'}}
      setOrderDraft(old=>[...old,row]);focusRow(row.plan)
      return {next:'continue',closeResult:'ok'}
    }} onError={e=>setError(e instanceof Error?e.message:'작업지시 조회 오류')} onClose={()=>setOrderScan(false)}/>}
    {error && <InventoryMessage text={error} onClose={()=>setError('')}/>}
    {rejection && view?.activeInput && <WorkRejections actor={actor} path={url+'/groups/'+view.activeInput.groupId+'/plans/'+encodeURIComponent(rejection)+'/rejections'}
      onClose={()=>setRejection(undefined)} onSaved={saved=>{
        setRejection(undefined)
        if(saved.revision===view.revision+1){
          setView({...view,revision:saved.revision,badTotals:{...view.badTotals,[rejection]:saved.saved.total}})
        }else if(saved.revision>view.revision){
          setRefresh(n=>n+1)
        }
      }} onExpired={onSessionExpired}
      onError={message=>{setRejection(undefined);setError(message)}}/>}
    {reverse && view && <ProcessPlans source="frmProcess5" actor={actor} workCode={workCode ?? stages[0]?.processCode ?? ''} storagePrefix="pop-process5-plan:" initial="choose" parentQualities={info?[info.grade]:[]} onClose={()=>setReverse(false)} onAttached={()=>{}} onSessionExpired={onSessionExpired}/>}
  </section>
}
