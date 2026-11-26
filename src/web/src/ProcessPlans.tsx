import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {PlanningError} from './planningApi'
import type {PlanKey} from './planningApi'
import {apply,loadScreen} from './processPlanApi'
import type {PlanScreen,ProcessCommand} from './processPlanApi'
import {Pop} from './ProcessPlanFields'
import ProcessPlanIssue from './ProcessPlanIssue'
import {ProcessStock,SpecRegister} from './ProcessPlanSpec'
import type {SpecRow} from './ProcessPlanSpec'
import ProcessPlanStatus from './ProcessPlanStatus'
import './ProcessPlans.css'

const errors:Record<string,string>={ ALREADY_ATTACHED:'이미 스캔된 작업지시번호입니다. 확인하십시오.',COMPLETED_PLAN:'작업 완료된 건입니다.',
  DOCUMENT_PRINTER_NOT_CONFIGURED:'문서 프린터를 설정하십시오.',FONT_NOT_CONFIGURED:'출력 글꼴을 설정하십시오.',QUALITY_OUT_OF_SCOPE:'환경설정에서 등록되지 않은 재질입니다.',STALE_REVISION:'다른 작업이 먼저 반영되었습니다. 다시 확인하십시오.',
  INSUFFICIENT_MATERIAL:'투입수량이 재고수량보다 높습니다.',MIXED_OUTPUT_ORDER:'다중 출력은 동일한 수주번호로만 출력 가능합니다.',
  PLAN_QUANTITY_EXCEEDED:'대상 계획의 남은 수량을 초과했습니다.',SPEC_UNCHANGED:'변경할 규격을 입력하십시오.', INVALID_OUTPUT_SELECTION:'선택한 출력 항목을 확인하십시오.'}
type Props={source?:'frmProcess1'|'frmProcess3'|'frmProcess5'|'frmProcess7'; apiBase?:string;workCode?:string;storagePrefix?:string; initial:'choose'|'status';actor:string;parentQualities:string[];parentPlans?:PlanKey[];onClose:()=>void;onAttached:(k:PlanKey[])=>void;onSessionExpired:()=>void}
export default function ProcessPlans({initial,actor,parentQualities,parentPlans,onClose,onAttached,onSessionExpired,source='frmProcess1',apiBase,workCode,storagePrefix='pop-process1-plan:'}:Props) {
  const [mode,setMode]=useState<'choose'|'plan'|'stock'|'spec'>(initial==='choose'?'choose':'plan')
  const [tab,setTab]=useState<'register'|'status'>(initial==='choose'?'register':'status')
  const [specRows,setSpecRows]=useState<SpecRow[]>([])
  const [loaded,setData]=useState<PlanScreen>(),[busy,setBusy]=useState(false)
  const [alert,setAlert]=useState<{text:string;accept?:()=>void}>()

  const data=loaded && source==='frmProcess5' && parentQualities.length ? {...loaded,initialQuality:parentQualities[0]} : loaded
  const key=storagePrefix+actor
  const [formVersion,setFormVersion]=useState(0)
  const [retry,setRetry]=useState<ProcessCommand|undefined>(()=>{try{return JSON.parse(sessionStorage.getItem(key)??'null')??undefined}catch{return undefined}})
  const mounted=useRef({active:true})
  const lock=useRef(false)
  useLayoutEffect(()=>{const token={active:true};mounted.current=token;return()=>{token.active=false}},[])
  useEffect(()=>{const controller=new AbortController()
    void loadScreen(controller.signal,apiBase,workCode).then(v=>{if(!controller.signal.aborted)setData(v)}).catch(e=>{if(!controller.signal.aborted){if(e instanceof PlanningError&&e.status===401)onSessionExpired();else setAlert({text:'계획을 조회할 수 없습니다.'})}})
    return()=>controller.abort()
  },[onSessionExpired,apiBase,workCode])
  function ask(text:string,accept?:()=>void){setAlert({text,accept})}
  function dismiss(){if(lock.current)return
    if(mode==='spec'){setMode('stock');setTab('register');setSpecRows([])}else onClose()}
  async function run(command:ProcessCommand,after?:()=>void){
    if(lock.current || !data?.planning.canWrite)return
    if(source==='frmProcess3' && command.action==='BATCH' && !command.parentPlans)command={...command,parentPlans:parentPlans??[]}
    const token=mounted.current
    try{sessionStorage.setItem(key,JSON.stringify(command))}catch{ask('재시도 정보를 저장할 수 없습니다.');return}
    lock.current=true;setBusy(true);setRetry(command)
    let committed=false
    function clear(){if(JSON.parse(sessionStorage.getItem(key)??'null')?.requestId===command.requestId)sessionStorage.removeItem(key);setRetry(undefined)}
    try{
      const result=await apply(command,apiBase,workCode);committed=true
      const next=await loadScreen(undefined,apiBase,workCode)
      if(!token.active)return
      setData(next);clear()
      if(result.pdf)ask('합성 문서 프린터로 전송되었습니다.')
      if(result.attached)onAttached(result.attached)
      if(result.skipped?.length)ask(result.skipped.map(code=>errors[code]??code).join(' '))
      if(after)after()
      else if(command.action==='BATCH' && command.rows.every(r=>r.action==='CHANGE_SPEC')){
        setMode('stock');setSpecRows([]);ask('발행 되었습니다.')
      }else if(command.action!=='OUTPUT')setFormVersion(n=>n+1)
    }catch(e){
      if(!token.active)return
      if(e instanceof PlanningError && e.status===401){onSessionExpired();return}
      if(!committed && e instanceof PlanningError && [400,403,404,409,422].includes(e.status)){clear();const next=await loadScreen(undefined,apiBase,workCode).catch(()=>undefined);if(!token.active)return;if(next)setData(next)}
      ask(e instanceof PlanningError?(errors[e.message]??'요청 결과를 확인하십시오. '+e.message):'요청 결과를 확인할 수 없습니다. 동일 명령으로 다시 시도하십시오.')
    }finally{if(token.active){lock.current=false;setBusy(false)}}
  }
  const label=mode==='choose'?'생산계획':mode==='stock'?'규격 변경 생성':mode==='spec'?'규격변경':tab==='status'?'계획현황':'계획분 생성'
  return <Pop label={label} kind={mode==='choose'?'rev-choose':mode==='stock'?'rev-stock':'rev-main'} onClose={dismiss}>
    {mode==='choose'?<><div><button type="button" onClick={()=>{setMode('plan');setTab('register')}}>계획분 생성</button><button type="button" onClick={()=>setMode('stock')}>규격 변경 생성</button></div><footer><button type="button" onClick={dismiss}>닫기</button></footer></>
    :!data?<p>조회 중</p>:<fieldset key={formVersion} disabled={busy||!!retry} className="rev-sheet">
      {mode!=='stock' && <nav aria-label="계획 탭">{(['register','status'] as const).map(t=><button type="button" key={t} aria-pressed={t===tab} onClick={()=>setTab(t)}>{t==='register'?'등록':'현황'}</button>)}</nav>}
      {mode==='stock'?<ProcessStock data={data} start={rows=>{setSpecRows(rows);setTab('register');setMode('spec')}} ask={ask} dismiss={dismiss}/>:
        tab==='status'?<ProcessPlanStatus data={data} source={source} spec={mode==='spec'} ask={ask} run={run} dismiss={dismiss}/>:
        mode==='spec'?<SpecRegister data={data} rows={specRows} setRows={setSpecRows} run={run} ask={ask} dismiss={dismiss} done={()=>{setMode('stock');setSpecRows([]);ask('발행 되었습니다.')}}/>:
        <ProcessPlanIssue data={data} run={run} ask={ask} dismiss={dismiss} apiBase={apiBase} useIssuePad={source==='frmProcess1'||source==='frmProcess5'} parentQualities={source==='frmProcess1'?data.parentQualities:parentQualities}/>}
    </fieldset>}
    {retry && <button type="button" disabled={busy} onClick={()=>void run(retry)}>동일 명령 재시도</button>}
    {alert && <Pop label="확인" kind="rev-prompt" onClose={()=>setAlert(undefined)}><p>{alert.text}</p><footer>{alert.accept && <button type="button" onClick={()=>{setAlert(undefined);alert.accept?.()}}>예</button>}
      <button type="button" onClick={()=>setAlert(undefined)}>{alert.accept?'아니오':'확인'}</button></footer></Pop>}
  </Pop>
}
