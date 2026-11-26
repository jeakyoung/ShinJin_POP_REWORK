import { Head,Num,Pop } from './ProcessPlanFields'
import ProcessPlans from './ProcessPlans'
import {ProductionStages,Tool,Scanner} from './ProductionGrid'
import './ProductionGrid.css'
import './work-basket.css'
import TouchField from './TouchField'
import BasketMaterialDialog from './BasketMaterialDialog'
import BasketReturnGrid from './BasketReturnGrid'
import './floor-work.css'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BasketApiError, basketScanner, loadBasket, loadBasketGroup, scanBasketOrder, sendBasketCommand, stockPickerSource, lookupBasketReturns } from './basketApi'
import ProcessLotRows from './processLot/ProcessLotRows'
import type {Pick} from './processLot/processStockTypes'
import CommonNumericPad from './commonInput/CommonNumericPad'
import { Dialog } from './workprint/WorkPrintParts'
import { box } from './workprint/workPrintLayout'
import './workprint/work-print.css'
import type { Action, Actor, BasketView, Command, Issue, PlanKey, ReturnLine, ReturnInput } from './basketApi'

const planId = (key: PlanKey) => key.date + '/' + key.sequence
const lotLabel = (lot: BasketView['materials'][number]['lot']) => [lot.item, lot.lot, lot.warehouse, lot.position].join(' / ')
const issueFromPick = ({stock,quantity}:Pick):Issue => ({lot:{item:stock.material,lot:stock.lot,warehouse:stock.warehouse,position:stock.location},quantity:String(quantity)})

function readPending(key: string): Command | undefined {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as Command : undefined
  } catch {
    return undefined
  }
}

export default function WorkBasket({ actor,processSlot,workCode,onSessionExpired }: { actor:Actor;processSlot?:number|null;workCode?:string; onSessionExpired: () => void }) {
  const process=useMemo(()=>({slot:processSlot,workCode}),[processSlot,workCode])
  const storageKey = 'synthetic-basket-retry:' + JSON.stringify([actor.terminal,actor.worker,processSlot,workCode])
  const [view, setView] = useState<BasketView>()
  const [scan, setScan] = useState('')
  const [scanOrder,setScanOrder]=useState('')
  const scanAttempt=useRef(0)
  const scanPending=useRef(false)
  const [visible, setVisible] = useState<string[]>([])
  const [checked, setChecked] = useState<string[]>([])
  const [focused, setFocused] = useState('')
  const [issue, setIssue] = useState('0')
  const [quantity, setQuantity] = useState('')
  const [returnLot, setReturnLot] = useState('')
  const [returnQty, setReturnQty] = useState('')
  const [length, setLength] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [returns, setReturns] = useState<ReturnLine[]>([])
  const inFlight = useRef(false)
  const [pending, setPending] = useState(() => readPending(storageKey))
  const [confirmation,setConfirmation]=useState<{text:string;yes:()=>void}>()
  const [modal,setModal]=useState<'scan'|'issue'|'return'|'plan'|'manual'>()
  const [manual,setManual]=useState<{owner:string;rows:Pick[]}>()
  const [heldReturns,setHeldReturns]=useState<{rows:BasketView['groups'][number]['returns'];sequences:number[]}>()
  const [returnDrafts,setReturnDrafts]=useState<ReturnLine[]>()
  const returnContext=useRef(0)
  const [returnPad,setReturnPad]=useState<{index:number;input:ReturnInput;rows:ReturnLine[];revision:number}>()
  const [returnFocus,setReturnFocus]=useState(0)
  const [returnAmount,setReturnAmount]=useState<{index:number;rows:ReturnLine[];revision:number}>()
  const boardRef=useRef<HTMLElement>(null)
  const [detailsBound,setDetailsBound]=useState(!processSlot)
  const [materialFocus,setMaterialFocus]=useState(0)
  const [dimensions,setDimensions]=useState<Record<string,string>>({})
  const [dimensionEdit,setDimensionEdit]=useState<string>()
  const [amounts,setAmounts]=useState<Record<string,string>>({})
  const [pickedIssues,setPickedIssues]=useState<number[]>([])
  const [pickedReturns,setPickedReturns]=useState<number[]>([])
  const [materialTarget, setMaterialTarget] = useState<{ id: string; key: PlanKey }>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const lifetime = useRef({ active: false })
  const initialScan = useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
  useLayoutEffect(() => {
    const mount = { active: true }
    lifetime.current = mount
    return () => { mount.active = false }
  }, [storageKey])

  useEffect(() => {
    let active = true
    void loadBasket(process).then(next => {
      if (active) {
        setView(next)
        const groups=new Set(next.groups.filter(g=>g.terminal===next.actor.terminal).map(g=>g.id))
        const keys=next.work.filter(w=>w.groupId && groups.has(w.groupId) && w.phase!=='COMPLETED').map(w=>planId(w.plan.key))
        setVisible(keys);setFocused(keys[0]??'')
        if(!keys.length && process.slot)initialScan.current=setTimeout(()=>{if(active)void openScanner()},500)
      }
    }).catch((error: unknown) => {
      if (!active) return
      if (error instanceof BasketApiError && error.status === 401) onSessionExpired()
      else setNotice(String(error))
    })
    return () => { active = false; clearTimeout(initialScan.current) }
  }, [process,onSessionExpired])

  const sameActor = view?.actor.terminal === actor.terminal && view.actor.worker === actor.worker

  function clearPending(command: Command) {
    if (readPending(storageKey)?.requestId !== command.requestId) return
    sessionStorage.removeItem(storageKey)
    setPending(current => current?.requestId === command.requestId ? undefined : current)
  }

  async function submit(action?: Action, group?: { id: string; key?: PlanKey; revision: number },
      returnEdit?: Command['returnEdit'], rowKey?:PlanKey, focusedIssue?:Pick, removal?:Command['removal'],returnGrid?:ReturnLine[]) {
    if (!view || !sameActor || !view.canWrite || inFlight.current) return
    const rows = view.work.map(row => row.plan.key).filter(key => visible.includes(planId(key)))
    const saving = action === 'SAVE_BASKET'
    const command = pending ?? (action && {
      action, requestId: crypto.randomUUID(), expectedRevision: group?.revision ?? view.revision,
      visible: group?.key ? [group.key] : rows, groupId: group?.id, returnEdit, removal,
      selected: rowKey?[rowKey]:saving || action==='DELETE_UNFINISHED'?rows.filter(key => checked.includes(planId(key))):[],
      amounts: action==='FINISH_BASKET'?rows.map(key=>({key,quantity:amounts[planId(key)]??'0'})):undefined,
      issues: saving ? issues : focusedIssue ? [issueFromPick(focusedIssue)] : [],
      manualSequence:focusedIssue?focusedIssue.materialSequence??0:undefined,
      returns: returnGrid??(saving ? returns : []),
    })
    if (!command) return
    const mount = lifetime.current
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(command))
    } catch {
      setNotice('요청 복구 정보를 저장할 수 없습니다.')
      return
    }
    inFlight.current = true
    setBusy(true)
    setPending(command)
    try {
      const result = await sendBasketCommand(command,process)
      if (!mount.active) return
      clearPending(command)
      const removing=command.action==='REMOVE_ISSUE_ROWS'||command.action==='REMOVE_RETURN_ROWS'
      const clearing=command.action==='CLEAR_BASKET_ISSUES'||command.action==='CLEAR_BASKET_RETURNS'
      if(!removing && !(clearing && result.groupId) && command.action!=='ADD_MANUAL_ISSUE' && command.action!=='SET_RETURN_QUANTITY' && command.action!=='SAVE_RETURN_GRID'){
        setManual(undefined);setPickedIssues([]);setMaterialFocus(0);setPickedReturns([]);setHeldReturns(undefined)
        setReturnDrafts(undefined)
      }
      if (command.action === 'SAVE_BASKET') {
        setIssues([])
        setReturns([])
      }
      if (command.action === 'DELETE_UNFINISHED' || command.action==='DELETE_ROW') {
        const affected = new Set(result.affected.map(planId))
        setChecked(current => current.filter(id => !affected.has(id)))
        setVisible(current=>current.filter(id=>!affected.has(id)))
      }
      if (clearing) {
        setMaterialTarget(undefined)
        setNotice('')
        if (result.groupId && view.revision === command.expectedRevision) {
          // ComBasketAdd only clears the two parent grids when the entire group disappears.
          setManual({owner:result.groupId,rows:currentPicks})
          setHeldReturns({rows:displayReturns.map(r=>({...r,quantity:Number(r.quantity),length:Number(r.length)})),sequences:returnSequences})
          try {
            const detail = await loadBasketGroup(result.groupId,process)
            if (!mount.active) return
            if (detail.revision === result.revision) {
              setView({ ...view, revision: detail.revision, materials: detail.materials,
                groups: view.groups.map(item => item.id === detail.group.id ? detail.group : item) })
              return
            }
          } catch (error) {
            if (!(error instanceof BasketApiError && [404,409].includes(error.status))) throw error
          }
        }
        if (!result.groupId) {
          setIssues([])
          setReturns([])
          setDetailsBound(!process.slot)
          setChecked([]);setFocused(visible[0]??'')
        }
      } else if(removing && command.removal){
        if(command.action==='REMOVE_ISSUE_ROWS')removeIssueSelection(command.removal.checked)
        else {
          if(returnDrafts)setReturnDrafts(returnDrafts.filter((_,i)=>!command.removal!.checked.includes(i)))
          if(!returnsLive){
            const deleted=command.removal.checked
            setHeldReturns({rows:displayReturns.filter((_,i)=>!deleted.includes(i)).map(r=>({...r,quantity:Number(r.quantity),length:Number(r.length)})),
              sequences:returnSequences.filter((_,i)=>!deleted.includes(i))})
          }
          setPickedReturns([])
        }
        setNotice('삭제 되었습니다.')
      } else if (command.action === 'SET_RETURN_QUANTITY' || command.action==='ADD_MANUAL_ISSUE' || command.action==='SAVE_RETURN_GRID') setNotice('')
      else setNotice('처리 완료 · 버전 ' + result.revision)
      const next = await loadBasket(process)
      if (mount.active){
        setView(next)
        if(command.action==='SAVE_RETURN_GRID'){
          const updated=next.groups.find(g=>g.id===command.groupId)
          setPickedReturns([]);setHeldReturns(undefined);setReturnFocus(0)
          setReturnDrafts(updated?.startedAt?undefined:updated?.productionReturns.map(r=>({...r.line,material:r.material,sequence:r.sequence,length:String(r.line.length),quantity:String(r.line.quantity)})))
        }
      }
    } catch (error) {
      if (!mount.active) return
      setMaterialTarget(undefined)
      if (error instanceof BasketApiError && error.status === 401) {
        onSessionExpired()
      } else {
        setNotice(error instanceof BasketApiError && error.message==='ISSUE_SEQUENCE_CONFLICT'?'TPR601M 0 INSERT ERROR':String(error))
        if (error instanceof BasketApiError && [400, 403, 404, 409, 422].includes(error.status)) {
          clearPending(command)
          if (error.status === 409) {
            try {
              const next = await loadBasket(process)
              if (mount.active) setView(next)
            } catch (refreshError) {
              if (mount.active && refreshError instanceof BasketApiError && refreshError.status === 401) onSessionExpired()
            }
          }
        }
      }
    } finally {
      inFlight.current = false
      if (mount.active) setBusy(false)
    }
  }

  if(!view || !sameActor)return <section aria-label="작업 장바구니"><p role="status">{notice||'조회 중'}</p></section>
  const list=view.work.filter(r=>visible.includes(planId(r.plan.key)))
  const row=list.find(r=>planId(r.plan.key)===focused)
  function mergedCell(index:number,value:(entry:BasketView['work'][number])=>unknown,content:ReactNode) {
    const entry=list[index],merge=entry.plan.columns?.mergeKey
    if(!merge)return <td>{content}</td>
    const matches=(other:BasketView['work'][number])=>other.plan.columns?.mergeKey===merge && value(other)===value(entry)
    if(index>0 && matches(list[index-1]))return null
    let span=1
    while(index+span<list.length && matches(list[index+span]))span++
    return <td rowSpan={span}>{content}</td>
  }
  function checkRow(target:BasketView['work'][number]) {
    const id=planId(target.plan.key)
    setChecked(current=>{
      const matches=list.filter(other=>other===target || target.groupId && other.groupId===target.groupId
        || target.plan.columns?.mergeKey && other.plan.columns?.mergeKey===target.plan.columns.mergeKey).map(other=>planId(other.plan.key))
      const retained=target.groupId?[]:current.filter(value=>!matches.includes(value))
      return current.includes(id)?retained:[...retained,...matches]
    })
  }
  const group=view.groups.find(g=>g.id===row?.groupId)
  function saveBasket() {
    if(!list.length){setNotice('수주번호를 스캔하십시오.');return}
    if(!checked.length){setNotice('선택된 수주가 없습니다.\n확인하십시오.');return}
    if(group?.startedAt){setNotice('작업 시작된 건입니다.\n작업시작 취소 후 다시 진행하십시오.');return}
    if(!issues.length){setNotice('투입자재를 선택 해주세요.');return}
    if(returns.some(line=>Number(line.length)===0)){setNotice('반납자재의 길이 설정을 확인해주세요.');return}
    void submit('SAVE_BASKET')
  }
  function removeRow(entry:BasketView['work'][number]){
    if(entry.groupId || entry.phase!=='READY'){void submit('DELETE_ROW',undefined,undefined,entry.plan.key);return}
    const id=planId(entry.plan.key),remaining=list.filter(r=>planId(r.plan.key)!==id)
    setVisible(remaining.map(r=>planId(r.plan.key)))
    setChecked(current=>current.filter(key=>key!==id))
    if(focused===id)setFocused(remaining.length?planId(remaining[Math.min(list.indexOf(entry),remaining.length-1)].plan.key):'')
  }
  const locked=busy||Boolean(pending)||!view.canWrite
  const running=list.length>0 && list.every(r=>r.phase==='STARTED')
  const paused=list.length>0 && list.every(r=>r.phase==='PAUSED')
  const anyComplete=list.some(r=>r.phase==='COMPLETED')
  const materialOwner=group?.id??'draft'
  const sourceIssues=!detailsBound?[]:group?.startedAt&&group.productionIssues&&(processSlot||group.productionIssues.length)?group.productionIssues.map(r=>r.line):group?.issues??issues
  const currentPicks:Pick[]=manual?.owner===materialOwner?manual.rows:sourceIssues.map(({lot,quantity},index)=>{
    const entry=view.materials.find(m=>lotLabel(m.lot)===lotLabel(lot)),d=entry?.display
    return {stock:{warehouse:lot.warehouse,location:lot.position,material:lot.item,lot:lot.lot,
      warehouseName:d?.warehouseName,locationName:d?.locationName,quality:d?.qualityName??'',name:'',workStatus:'',
      thickness:d?.thickness??0,width:d?.width??0,length:d?.length??0,available:entry?.available??0},quantity:Number(quantity),checked:pickedIssues.includes(index),
      materialSequence:group?.startedAt?group.productionIssues?.[index]?.sequence:group?.issueSequences[index]}
  })
  const displayIssues=currentPicks.map(issueFromPick),displayReturns=!detailsBound?[]:returnDrafts??heldReturns?.rows??group?.returns??returns
  const returnSequences=returnDrafts?.map(r=>r.sequence??0)??heldReturns?.sequences??group?.returnSequences??displayReturns.map(()=>0)
  function setMaterialRows(rows:Pick[]){
    setManual({owner:materialOwner,rows})
    setPickedIssues(rows.flatMap((r,i)=>r.checked?[i]:[]))
    if(!group)setIssues(rows.map(issueFromPick))
  }
  function applyManual(rows:Pick[],lastNew?:Pick){
    const selected=lastNew??rows[materialFocus]??rows[0]
    if(!selected || !row)return
    setMaterialFocus(rows.indexOf(selected))
    if(group)void submit('ADD_MANUAL_ISSUE',{id:group.id,key:row.plan.key,revision:view!.revision},undefined,undefined,selected)
  }
  const selectedColumns=list.filter(work=>checked.includes(planId(work.plan.key))).map(work=>work.plan.columns)
  function maxDimension(field:'width'|'thickness') {
    const values=selectedColumns.flatMap(columns=>columns?.[field]==null?[]:[columns[field]])
    return values.length?Math.max(...values):''
  }
  function dimension(type:'issue'|'return',field:'width'|'thickness'){
    return dimensions[type+field]??String(maxDimension(field))
  }
  function focusPlan(id:string){
    returnContext.current++
    setDetailsBound(true);setDimensions({});setManual(undefined);setIssues([]);setPickedIssues([]);setMaterialFocus(0)
    setReturns([]);setPickedReturns([]);setHeldReturns(undefined);setReturnDrafts(undefined);setReturnFocus(0)
    setFocused(id)
    if(process.slot){
      const mount=lifetime.current
      void loadBasket(process).then(next=>{
        if(mount.active)setView(current=>current && current.revision>next.revision?current:next)
      }).catch(error=>{
        if(!mount.active)return
        if(error instanceof BasketApiError && error.status===401)onSessionExpired()
        else setNotice('작업 자재를 재조회할 수 없습니다.')
      })
    }
  }
  const returnsLive=!!group?.startedAt && (row?.phase==='STARTED' || row?.phase==='PAUSED')
  const liveReturnGrid=returnsLive && !returnDrafts
  function nativeReturns():ReturnLine[]{
    if(liveReturnGrid && detailsBound)return group!.productionReturns.map(r=>({...r.line,material:r.line.material,sequence:r.sequence,
      quantity:String(r.line.quantity),length:String(r.line.length)}))
    return displayReturns.map((r,i)=>({...r,sequence:returnSequences[i]??0,quantity:String(r.quantity),length:String(r.length)}))
  }
  function storeReturnRows(rows:ReturnLine[]){
    setReturnDrafts(rows)
    if(!group)setReturns(rows)
  }
  function returnInput():ReturnInput|undefined{
    if(!list.length || !row){setNotice('수주 리스트를 스캔하여 주십시오.');return}
    if(dimension('return','thickness')==='' && dimension('return','width')===''){setNotice('작업 리스트를 선택하여 주십시오.');return}
    if(!currentPicks.length){setNotice('투입자재가 없습니다.\n자재 투입 후 진행하십시오.');return}
    if(list.some(r=>checked.includes(planId(r.plan.key))&&r.phase==='COMPLETED')){setNotice('작업완료된 건이 존재합니다.\n관리자에게 문의하십시오.');return}
    return {firstPlan:list[0].plan.key,firstIssue:displayIssues[0].lot,focusedIssue:displayIssues[materialFocus]?.lot??displayIssues[0].lot}
  }
  async function addNativeReturn(){
    const input=returnInput()
    if(!input || !row || busy)return
    const mount=lifetime.current
    const context=returnContext.current
    setBusy(true)
    try{
      const found=await lookupBasketReturns(row.plan.key,input,process)
      if(!mount.active || context!==returnContext.current)return
      const previous=nativeReturns()
      const rows=[...previous,...found.map(material=>({lot:material.lot,material,sequence:0,quantity:'1',length:'0'}))]
      storeReturnRows(rows);setPickedReturns([...pickedReturns,...found.map((_,i)=>previous.length+i)])
      setReturnFocus(rows.length-1)
      setReturnPad({index:rows.length-1,input,rows,revision:view!.revision})
    }catch(error){
      if(!mount.active)return
      if(error instanceof BasketApiError && error.status===401)onSessionExpired()
      else setNotice(error instanceof BasketApiError && error.status===409?'반납창고가 설정되지 않았습니다.\n환경설정을 확인하십시오.':'반납자재를 조회할 수 없습니다.')
    }finally{if(mount.active)setBusy(false)}
  }
  function editReturnLength(index:number){
    const input=returnInput(),rows=nativeReturns()
    if(input && rows[index] && rows[index].lot.warehouse!=='013')setReturnPad({index,input,rows,revision:view!.revision})
  }
  async function persistReturnRows(rows:ReturnLine[],revision:number){
    storeReturnRows([...rows])
    if(group && row && rows.every(r=>Number(r.length)>0 && r.material?.thickness!==0 && r.material?.width!==0))
      await submit('SAVE_RETURN_GRID',{id:group.id,key:row.plan.key,revision},undefined,undefined,undefined,undefined,rows)
  }
  function finishReturnAmount(value?:string){
    const pad=returnAmount
    setReturnAmount(undefined)
    if(!pad)return
    const rows=pad.rows.map((r,i)=>i===pad.index?{...r,quantity:value??r.quantity}:r)
    void persistReturnRows(rows,pad.revision)
  }
  async function finishReturnLength(value?:string){
    const pad=returnPad
    setReturnPad(undefined)
    if(!pad || !row)return
    const line=pad.rows[pad.index]
    if(!line)return
    const length=Number(value??line.length)
    const rows=[...pad.rows]
    rows[pad.index]={...line,length:String(length)}
    storeReturnRows(rows)
    requestAnimationFrame(()=>boardRef.current?.querySelector<HTMLButtonElement>('[aria-label="반납길이 '+(pad.index+1)+'행"]')?.focus({preventScroll:true}))
    if(!length || line.material?.thickness===0 || line.material?.width===0)return
    const mount=lifetime.current
    const context=returnContext.current
    setBusy(true)
    try{
      const result=await lookupBasketReturns(row.plan.key,{...pad.input,position:line.lot.position,length,row:line.material},process)
      if(!mount.active || context!==returnContext.current)return
      const material=result.at(-1)
      if(material)rows[pad.index]={...rows[pad.index],lot:material.lot,material}
      await persistReturnRows(rows,pad.revision)
    }catch(error){
      if(!mount.active)return
      if(error instanceof BasketApiError && error.status===401)onSessionExpired()
      else setNotice('반납품목을 조회할 수 없습니다.')
    }finally{if(mount.active)setBusy(false)}
  }
  async function openScanner() {
    clearTimeout(initialScan.current)
    const attempt=++scanAttempt.current
    scanPending.current=false
    const mount=lifetime.current
    setScan('')
    if(!process.slot){setModal('scan');return}
    try {
      const ready=await basketScanner(process)
      if(!mount.active||attempt!==scanAttempt.current)return
      if(ready.configured)setModal('scan')
      else setNotice('양품창고가 설정되지 않았습니다.\n환경설정을 확인하십시오.')
    } catch(error) {
      if(mount.active && error instanceof BasketApiError && error.status===401)onSessionExpired()
      else if(mount.active)setNotice('양품창고를 확인할 수 없습니다.')
    }
  }
  function closeScanner() {
    scanAttempt.current++
    scanPending.current=false
    setModal(undefined)
  }
  const applyScan=async()=>{
    if(process.slot){
      if(list.length){setScan('');setNotice('스캔된 데이터가 존재합니다.\n확인하십시오.');return}
      if(scanPending.current)return
      scanPending.current=true
      const attempt=scanAttempt.current
      const mount=lifetime.current
      try {
        const result=await scanBasketOrder(scan,process)
        if(!mount.active||attempt!==scanAttempt.current)return
        const ids=result.keys.map(planId)
        const rows=view.work.filter(work=>ids.includes(planId(work.plan.key)))
        const focus=rows.find(work=>!work.groupId)??rows[0]
        if(!focus)return
        const chosen=rows.filter(work=>work===focus || focus.groupId && work.groupId===focus.groupId ||
          focus.plan.columns?.mergeKey && work.plan.columns?.mergeKey===focus.plan.columns.mergeKey)
        setDetailsBound(true);setVisible(ids);setChecked(chosen.map(work=>planId(work.plan.key)));setFocused(planId(focus.plan.key));setScanOrder(result.orderNo)
        setScan('');setModal(undefined);setNotice('')
      } catch(error){
        if(!mount.active||attempt!==scanAttempt.current)return
        setScan('')
        if(error instanceof BasketApiError && error.status===401){onSessionExpired();return}
        const messages:Record<string,string>={ORDER_BARCODE_LENGTH:'수주번호를 스캔하여주십시오.',ORDER_NOT_FOUND:'수주정보를 찾을 수 없습니다.',
          MATERIAL_NOT_CONFIGURED:'해당 작업지시번호는 환경설정에서 등록되지 않는 재질입니다.\n확인 후 다시 스캔하십시오.',
          ORDER_FINISHED:'해당 공정에서 완료 된 수주건 입니다.',GOOD_WAREHOUSE_REQUIRED:'양품창고가 설정되지 않았습니다.\n환경설정을 확인하십시오.'}
        setNotice(error instanceof BasketApiError?messages[error.message]??'수주번호를 확인할 수 없습니다.':'수주번호를 확인할 수 없습니다.')
      } finally {if(attempt===scanAttempt.current)scanPending.current=false}
      return
    }
    const found=view.work.find(w=>planId(w.plan.key)===scan.trim())
    if(!found){setNotice('작업지시 번호를 확인하십시오.');return}
    const ids=(found.groupId?view.work.filter(w=>w.groupId===found.groupId):[found]).map(w=>planId(w.plan.key))
    setVisible(current=>[...new Set([...current,...ids])]);setChecked(current=>[...new Set([...current,...ids])])
    setFocused(planId(found.plan.key));setScan('');setModal(undefined);setNotice('')
  }
  function popup(type:'issue'|'return'){
    if(type==='return' && process.slot){void addNativeReturn();return}
    if(!list.length){setNotice('수주 리스트를 스캔하여 주십시오.');return}
    if(type==='issue' && process.slot && row){
      if(anyComplete){setNotice('작업 완료된 건이 있으므로 자재 투입 불가능합니다.');return}
      if(!checked.length){setNotice('적용할 양품 항목을 선택하십시오.');return}
      const source=stockPickerSource(row.plan.key,checked,process),mount=lifetime.current
      void fetch(source.path+source.suffix,{headers:source.headers,credentials:'same-origin',cache:'no-store'}).then(response=>{
        if(!mount.active)return
        if(response.status===401){onSessionExpired();return}
        if(response.ok)setModal('manual')
        else setNotice(response.status===409?'투입창고가 설정되지 않았습니다.\n환경설정을 확인하십시오.':'자재 조회 오류 ('+response.status+')')
      }).catch(()=>{if(mount.active)setNotice('투입창고를 확인할 수 없습니다.')})
      return
    }
    if(anyComplete){setNotice('작업완료된 건이 존재합니다. 확인하십시오.');return}
    if(group && row?.phase==='BASKETED'){setMaterialTarget({id:group.id,key:row.plan.key});return}
    if(!group){setModal(type);return}
    setNotice('작업 중인 그룹의 자재 정보를 확인하십시오.')
  }
  function removeIssueSelection(selected:number[]){
    const kept=currentPicks.filter((_,i)=>!selected.includes(i)).map(r=>({...r,checked:false}))
    setMaterialRows(kept)
    setMaterialFocus(Math.max(0,Math.min(kept.length-1,materialFocus-selected.filter(i=>i<materialFocus).length)))
  }
  function removeDraft(type:'issue'|'return'){
    const issueList=type==='issue', selected=issueList?pickedIssues:pickedReturns
    const rows=issueList?currentPicks.map(p=>p.materialSequence??0):liveReturnGrid&&detailsBound?group!.productionReturns.map(r=>r.sequence)
      :returnSequences.slice(0,displayReturns.length)
    if(!rows.length){setNotice(issueList?'투입자재를 확인하십시오.':'반납 자재 정보를 확인하십시오.');return}
    if(issueList && group && selected.length===rows.length){setNotice('1개 이상의 투입자재는 필수 입니다.');return}
    if(anyComplete){setNotice(issueList?'작업 완료된 건이 있으므로 자재 삭제 불가능합니다.':'작업완료가 되었습니다. 삭제할 수 없습니다.');return}
    const returnLines=liveReturnGrid?group!.productionReturns.map(r=>r.line):displayReturns
    if(!issueList && selected.some(i=>returnLines[i]?.lot.warehouse==='013')){setNotice('산철, 분철은 삭제할 수 없습니다.');return}
    if(!selected.length){setNotice(issueList?'삭제할 투입자재를 선택하십시오.':'삭제할 반납자재를 선택하십시오.');return}
    setConfirmation({text:issueList?'선택한 투입 자재를 삭제하시겠습니까?':'선택한 반납자재를 삭제하시겠습니까?',yes:()=>{
      if(group){void submit(issueList?'REMOVE_ISSUE_ROWS':'REMOVE_RETURN_ROWS',{id:group.id,revision:view!.revision},undefined,undefined,undefined,{rows,checked:selected});return}
      if(issueList)removeIssueSelection(selected)
      else {storeReturnRows(nativeReturns().filter((_,i)=>!selected.includes(i)));setPickedReturns([])}
      setNotice('삭제 되었습니다.')
    }})
  }
  return <section ref={boardRef} className="prod-board basket-board" aria-label="작업 장바구니">
    <header className="prod-toolbar"><Scanner onClick={()=>void openScanner()}/><div className="prod-info"><span>시작시간 :</span><b>{group?.startedAt?new Date(group.startedAt).toLocaleTimeString('ko-KR',{hour12:false}):'-'}</b></div>
      <Tool code="BASKET ADD" label="장바구니 담기" disabled={locked || view.mode!=='BASKET' || row?.phase!=='READY'} onClick={saveBasket}/>
      <Tool code="START" label="작업 시작" disabled={locked||view.mode!=='BASKET'||!list.length||!list.every(work=>work.groupId)||list.every(work=>work.phase==='STARTED'||work.phase==='PAUSED'||work.phase==='COMPLETED')} onClick={()=>void submit('START_BASKET')}/>
      <Tool code={paused?'RESTART':'STOP'} label={paused?'재시작':'작업중단'} color="yellow" disabled={locked||(!running&&!paused)} onClick={()=>setConfirmation({text:paused?'재시작 하시겠습니까?':'작업중단 하시겠습니까?',yes:()=>void submit(paused?'RESUME_BASKET':'PAUSE_BASKET')})}/>
      <Tool code="END" label="작업 완료" color="orange" disabled={locked||!running} onClick={()=>setConfirmation({text:'작업완료 하시겠습니까?',yes:()=>void submit('FINISH_BASKET')})}/>
      <Tool code="PLAN" label="생산계획" onClick={()=>setModal('plan')}/>
      <Tool code="DELETE" label="일괄삭제" color="orange" disabled={locked||!list.length} onClick={()=>setConfirmation({text:'작업지시 번호를 일괄삭제 하시겠습니까?',yes:()=>void submit('DELETE_UNFINISHED')})}/>
      <Tool code="PRINT" label="프린트" color="green"/></header>
    <div className="prod-middle"><div className="prod-tables"><div className="prod-scroll"><table aria-label="조회 목록과 작업 선택"><colgroup>{[50,105,90,60,60,75,60,60,60,60,60,70,70,100,100].map((width,i)=><col key={i} style={{width}}/>)}</colgroup><thead><Head headers={['선택','작업그룹번호','재질명','두께','폭','길이','수주','생산','잔량','불량','배치','시작시간','선택삭제','창고명','로케이션명']}/></thead>
      <tbody>{list.map((r,index)=>{const id=planId(r.plan.key),g=view.groups.find(v=>v.id===r.groupId);return <tr key={id} aria-current={row===r} onClick={()=>{focusPlan(id);checkRow(r)}}>
        {mergedCell(index,other=>checked.includes(planId(other.plan.key)),<input aria-label={id+' 선택'} type="checkbox" checked={checked.includes(id)} onChange={()=>{}}/>)}
        {mergedCell(index,other=>other.groupId,r.groupId && r.phase==='BASKETED'?<button type="button" onClick={()=>setMaterialTarget({id:r.groupId!,key:r.plan.key})}>{r.groupId}</button>:r.groupId)}
        {mergedCell(index,other=>other.plan.columns?.qualityName,r.plan.columns?.qualityName)}
        {mergedCell(index,other=>other.plan.columns?.thickness,r.plan.columns?.thickness)}
        {mergedCell(index,other=>other.plan.columns?.width,r.plan.columns?.width)}
        <td>{r.plan.columns?.length}</td><td/><td>{r.phase==='STARTED'||r.phase==='PAUSED'?<Num label={id+' 생산수량'} value={amounts[id]??'0'} onChange={s=>setAmounts({...amounts,[id]:s})}/>:r.produced}</td>
        <td/><td/><td/><td>{g?.startedAt?new Date(g.startedAt).toLocaleTimeString('ko-KR',{hour12:false}):''}</td>
        <td><button type="button" aria-label={id+' 선택삭제'} disabled={locked} onClick={e=>{e.stopPropagation();removeRow(r)}}>삭제</button></td><td/><td/></tr>})}</tbody></table></div>
      <div className="prod-summary" aria-label="선택 작업 정보">{[row?.plan.columns?.customer,row&&(scanOrder||row.plan.order),row?.plan.columns?.orderDate,row?.plan.columns?.dueDate,row?.plan.columns?.remark].map((value,i)=><span key={i}>{value}</span>)}</div></div><ProductionStages/></div>
    <div className="prod-panes">{(['issue','return'] as const).map(type=>{const isIssue=type==='issue',title=isIssue?'투입자재':'반납자재'
      return <section key={type} className="prod-pane"><header><h3>{title}</h3><span>두께</span><button className="basket-metric" aria-label={title+' 두께'} onClick={()=>setDimensionEdit(type+'thickness')}>{dimension(type,'thickness')}</button><span>폭</span><button className="basket-metric" aria-label={title+' 폭'} onClick={()=>setDimensionEdit(type+'width')}>{dimension(type,'width')}</button>
        <button className="prod-sign" aria-label={title+' 추가'} type="button" disabled={locked||!row||row.phase==='PAUSED'||anyComplete} onClick={()=>popup(type)} /><button type="button" className="prod-sign" aria-label={title+' 삭제'} disabled={locked||!row||row.phase==='PAUSED'||anyComplete} onClick={()=>removeDraft(type)} /></header>
        {!isIssue && liveReturnGrid && group?<BasketReturnGrid rows={detailsBound?group.productionReturns:[]} selected={pickedReturns} onSelect={setPickedReturns} onLength={process.slot?editReturnLength:undefined} revision={view.revision} disabled={locked||!view.returnCandidates.length||anyComplete}
          onSave={(sequence,q,revision)=>void submit('SET_RETURN_QUANTITY',{id:group.id,revision},{sequence,quantity:q})}/>:
        <div className="prod-scroll"><table aria-label={title+' 목록'}><thead><Head headers={isIssue?['선택','창고','두께','폭','길이','재고','투입수량','로케이션','Lot no']:['선택','창고','로케이션','재질','두께','폭','길이','반납수량']}/></thead>
          <tbody>{(isIssue?displayIssues:displayReturns).map((line,i)=>{
            const stock=isIssue?currentPicks[i].stock:undefined
            const spec=('material' in line?line.material:undefined)??view.materials.find(m=>lotLabel(m.lot)===lotLabel(line.lot))?.display
            return <tr key={i} aria-current={isIssue?i===materialFocus:i===returnFocus} onClick={()=>{if(stock)setMaterialFocus(i);else setReturnFocus(i)}}><td><input type="checkbox" aria-label={title+' '+(i+1)+' 선택'} checked={(isIssue?pickedIssues:pickedReturns).includes(i)}
            onChange={e=>{if(isIssue)setMaterialRows(currentPicks.map((p,n)=>n===i?{...p,checked:e.target.checked}:p))
              else setPickedReturns(e.target.checked?[...pickedReturns,i]:pickedReturns.filter(v=>v!==i))}}/></td>
            <td>{stock?.warehouseName??spec?.warehouseName??line.lot.warehouse}</td>
            {stock?<><td>{spec?.thickness}</td><td>{spec?.width}</td><td>{spec?.length}</td><td>{stock.available}</td>
              <td>{line.quantity}</td><td>{stock.locationName??line.lot.position}</td><td>{line.lot.lot}</td></>:
              <><td>{spec?.locationName??line.lot.position}</td><td>{spec?.qualityName}</td><td>{spec?.thickness}</td><td>{spec?.width}</td>
                <td>{'length' in line && (process.slot?<button type="button" aria-label={'반납길이 '+(i+1)+'행'}
                  disabled={locked||anyComplete} onClick={()=>editReturnLength(i)}>{line.length}</button>:line.length)}</td>
                <td>{process.slot?<button type="button" aria-label={'반납수량 '+(i+1)+'행'} disabled={locked||anyComplete}
                  onClick={()=>setReturnAmount({index:i,rows:nativeReturns(),revision:view.revision})}>{line.quantity}</button>:line.quantity}</td></>}
            </tr>})}</tbody></table></div>}</section>})}</div>
    {returnAmount && <CommonNumericPad mode="decimal" onApply={s=>finishReturnAmount(s)} onCancel={()=>finishReturnAmount()}/>}
    {returnPad && <CommonNumericPad mode="preset" onApply={s=>void finishReturnLength(s)} onCancel={()=>void finishReturnLength()}/>}
    {modal==='manual' && row && <ProcessLotRows open mode="manual" renderRows={false} date={row.plan.key.date} sequence={row.plan.key.sequence}
      source={{...stockPickerSource(row.plan.key,checked,process),initialSize:{thickness:dimension('issue','thickness'),width:dimension('issue','width')}}} rows={currentPicks} onRows={setMaterialRows} onManualApplied={applyManual}
      onClose={()=>setModal(undefined)} onSessionExpired={onSessionExpired}/>}
    {dimensionEdit && <CommonNumericPad mode="decimal" onApply={value=>{setDimensions({...dimensions,[dimensionEdit]:Number(value)===0?'':value});setDimensionEdit(undefined)}} onCancel={()=>setDimensionEdit(undefined)}/>}
    {modal==='scan' && <Dialog name="ComOrderNoScan" width={880} height={300} scan close={closeScanner}>
      <input autoFocus aria-label="수주번호 스캔" style={box('ComOrderNoScan','txtBarCode')} placeholder="수주번호를 스캔하세요." value={scan} onChange={e=>setScan(e.target.value)}
        onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void applyScan()}}}/>
      <button style={box('ComOrderNoScan','btnScannerClose')} onClick={closeScanner}>닫기</button></Dialog>}
    {(modal==='issue'||modal==='return') && <Pop label={modal==='issue'?'투입자재 선택':'반납자재 선택'} kind="rev-lookup" onClose={()=>setModal(undefined)}>
      {modal==='issue'?<><label>투입 LOT<select value={issue} onChange={e=>setIssue(e.target.value)}>{view.materials.map((m,i)=><option key={lotLabel(m.lot)} value={i}>{lotLabel(m.lot)} · {m.available}</option>)}</select></label>
        <TouchField label="투입수량" layout="decimal" value={quantity} onValueChange={setQuantity}/></>:
      <><label>반납 LOT<select value={returnLot} onChange={e=>setReturnLot(e.target.value)}><option value="">선택</option>{view.returnCandidates.map((m,i)=><option key={lotLabel(m)} value={i}>{lotLabel(m)}</option>)}</select></label>
        <TouchField label="반납수량" layout="decimal" value={returnQty} onValueChange={setReturnQty}/><TouchField label="반납길이" layout="decimal" value={length} onValueChange={setLength}/></>}
      <footer><button type="button" disabled={locked||(modal==='issue'?!quantity:!returnQty||!length||returnLot==='')} onClick={()=>{
        if(modal==='issue'){const m=view.materials[Number(issue)];if(!m)return;setIssues([...issues,{lot:m.lot,quantity}]);setQuantity('')}
        else {setReturns([...returns,{lot:view.returnCandidates[Number(returnLot)],quantity:returnQty,length}]);setReturnQty('');setLength('')}setModal(undefined)
      }}>적용</button><button type="button" onClick={()=>setModal(undefined)}>닫기</button></footer></Pop>}
    {modal==='plan' && <ProcessPlans workCode={workCode} initial="choose" actor={JSON.stringify([actor.terminal,actor.worker])} parentPlans={list.map(r=>r.plan.key)}
      parentQualities={list.map(r=>r.plan.columns?.quality??'')} onClose={()=>setModal(undefined)} onAttached={()=>{}} onSessionExpired={onSessionExpired} source="frmProcess3"/>}
    {confirmation && <Pop label="확인" kind="rev-prompt" onClose={()=>setConfirmation(undefined)}><p>{confirmation.text}</p><footer><button type="button" onClick={()=>{setConfirmation(undefined);confirmation.yes()}}>예</button><button type="button" onClick={()=>setConfirmation(undefined)}>아니오</button></footer></Pop>}
    {notice && !materialTarget && <Dialog name="작업 안내" width={683} height={376} close={()=>setNotice('')}>
      <div className="wp-message"><p>{notice}</p><button type="button" onClick={()=>setNotice('')}>확인</button></div></Dialog>}
    {pending && <button type="button" className="prod-status" disabled={busy||!view.canWrite} onClick={()=>void submit()}>같은 요청 재시도</button>}
    {materialTarget && <BasketMaterialDialog process={process} groupId={materialTarget.id} canWrite={view.canWrite} locked={busy} message={notice} onClose={()=>setMaterialTarget(undefined)}
      onSessionExpired={onSessionExpired} onClear={(action,revision)=>void submit(action,{...materialTarget,revision})}/>}
  </section>
}
