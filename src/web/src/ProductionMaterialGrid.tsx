import {useEffect,useRef,useState} from 'react'
import CommonNumericPad from './commonInput/CommonNumericPad'
import {Head,Pop} from './ProcessPlanFields'
import {Scanner} from './ProductionGrid'
import {pendingCommand,ProductionError,productionRequest} from './productionApi'
import type {MaterialDraft,MaterialGridRow,MaterialKind,MaterialPatch,MaterialSpec,ProductionRow} from './productionApi'
import type {WorkOrder} from './workOrdersApi'
import {SessionExpired} from './workHistoryApi'

type Field='quantity'|'thickness'|'width'|'length'
type Command={requestId:string;action:MaterialKind;remove:boolean;lines:MaterialPatch[];visible:Pick<ProductionRow,'date'|'sequence'|'revision'>[]}
type Props={actor:string;plan?:WorkOrder;visible:Command['visible'];hasCompleted:boolean;locked:boolean;attempt:number;drafts:MaterialDraft[];
  extraIssueRows?:React.ReactNode;scanCount:number;checkedScanCount:number;removeCheckedScans:()=>void;onDraft:(draft:MaterialDraft)=>void;onRefresh:()=>void;onAdd:(type:'issue'|'return')=>void;onScan:()=>void;onExpired:()=>void}
const id=(r:MaterialGridRow)=>r.date+'/'+r.sequence+'/'+r.event.revision
const label:Record<Field,string>={quantity:'수량',thickness:'두께',width:'폭',length:'길이'}
const emptySpec:MaterialSpec={quality:null,thickness:null,width:null,length:null}

export default function ProductionMaterialGrid({actor,plan,visible,hasCompleted,locked,attempt,drafts,extraIssueRows,scanCount,checkedScanCount,removeCheckedScans,onDraft,onRefresh,onAdd,onScan,onExpired}:Props){
  const path=plan?'/api/pop/work-orders/'+plan.planDate+'/'+plan.planSequence+'/production-materials':''
  const pendingKey='process-production-material:'+actor+':'+path
  const [rows,setRows]=useState<MaterialGridRow[]>([]),[picks,setPicks]=useState<string[]>([])
  const [cell,setCell]=useState<{row:MaterialGridRow;field:Field}>(),[edits,setEdits]=useState<Record<string,MaterialPatch>>({})
  const [message,setMessage]=useState(''),[confirm,setConfirm]=useState<MaterialKind>()
  const [busy,setBusy]=useState(false),[pending,setPending]=useState(()=>pendingCommand<Command>(pendingKey))
  const alive=useRef({active:true}),sending=useRef(false)
  useEffect(()=>{const token={active:true};alive.current=token;return()=>{token.active=false}},[path])
  useEffect(()=>{
    const ctl=new AbortController()
    if(!path)return
    void productionRequest<MaterialGridRow[]>(path,undefined,undefined,ctl.signal).then(next=>{
      if(!ctl.signal.aborted){setRows(next);setPicks([]);setEdits({});setPending(pendingCommand<Command>(pendingKey))}
    })
      .catch(e=>{if(!ctl.signal.aborted){if(e instanceof SessionExpired)onExpired();else setMessage('자재 목록을 조회하지 못했습니다.')}})
    return()=>ctl.abort()
  },[path,attempt,pendingKey,onExpired])
  const disabled=locked||busy||!!pending||hasCompleted||!plan
  function patch(row:MaterialGridRow):MaterialPatch {
    const recorded=drafts.find(d=>d.date===row.date && d.sequence===row.sequence && d.action===row.event.action)?.lines.find(p=>p.event===row.event.revision)
    return edits[id(row)]??recorded??{date:row.date,sequence:row.sequence,revision:row.revision,event:row.event.revision,quantity:row.event.quantity,spec:row.event.spec}
  }
  async function save(cmd:Command){
    if(sending.current)return
    const mounted=alive.current;sending.current=true;setBusy(true);setPending(cmd);setConfirm(undefined)
    try{
      sessionStorage.setItem(pendingKey,JSON.stringify(cmd))
      const next=await productionRequest<MaterialGridRow[]>(path,cmd)
      sessionStorage.removeItem(pendingKey)
      if(mounted.active){setPending(undefined);setEdits({});setRows(next);setPicks([]);if(cmd.remove && cmd.action==='ISSUE_MATERIAL')removeCheckedScans();onRefresh()}
    }catch(e){
      if(!mounted.active)return
      if(e instanceof SessionExpired){onExpired();return}
      if(e instanceof ProductionError && [400,403,404,409,422].includes(e.status)){sessionStorage.removeItem(pendingKey);setPending(undefined);onRefresh()}
      setMessage(e instanceof ProductionError?e.message:'요청 결과를 확인할 수 없습니다. 동일 명령으로 다시 시도하십시오.')
    }finally{sending.current=false;if(mounted.active)setBusy(false)}
  }
  function edit(row:MaterialGridRow,field:Field,value:number){
    if(!plan)return
    const line={...patch(row)},issue=row.event.action==='ISSUE_MATERIAL'
    if(field==='quantity')line.quantity=issue?Math.min(Math.max(1,value),row.event.quantity+row.available):value
    else{
      if(row.event.position.warehouse==='013')return
      const replacement=value===0 && (field==='thickness'||field==='width')?Number(plan.display?.[field]??0):value
      line.spec={...(line.spec??emptySpec),[field]:replacement}
    }
    const nextEdits={...edits,[id(row)]:{...line}};setEdits(nextEdits)
    const relevant=rows.filter(other=>other.event.action===row.event.action)
    const lines=relevant.map(other=>nextEdits[id(other)]??patch(other))
    if(plan.status==='WAITING'){
      onDraft({date:plan.planDate,sequence:plan.planSequence,action:row.event.action,lines})
      return
    }
    if(!issue && lines.some(p=>!p.spec?.thickness||!p.spec.width||!p.spec.length))return
    void save({requestId:crypto.randomUUID(),action:row.event.action,remove:false,lines:issue?[line]:lines,visible})
  }
  function valueButton(row:MaterialGridRow,field:Field,title:string){
    const p=patch(row),value=field==='quantity'?p.quantity:p.spec?.[field]
    return <button type="button" className="rev-num" disabled={disabled || field!=='quantity' && row.event.position.warehouse==='013'} aria-label={row.event.lotCode+' '+title} onClick={()=>setCell({row,field})}>{value??''}</button>
  }
  return <div className="prod-panes">{(['ISSUE_MATERIAL','RETURN_MATERIAL'] as const).map(action=>{
    const issue=action==='ISSUE_MATERIAL',title=issue?'투입자재':'반납자재'
    const lines=rows.filter(e=>e.event.action===action)
    return <section key={action} className="prod-pane"><header><h3>{title}</h3>
      {issue?<><span>두께</span><em>{plan?.display?.thickness??'-'}</em><span>폭</span><em>{plan?.display?.width??'-'}</em><Scanner label="투입 LOT 스캔" disabled={locked} onClick={onScan}/></>:<em/>}
      <button className="prod-sign" type="button" aria-label={title+' 추가'} disabled={disabled} onClick={()=>{if(!issue&&!scanCount&&!rows.some(r=>r.event.action==='ISSUE_MATERIAL'))setMessage('투입자재가 없습니다. 자재 투입 후 진행하십시오.');else onAdd(issue?'issue':'return')}}>＋</button>
      <button className="prod-sign" type="button" aria-label={title+' 삭제'} disabled={disabled} onClick={()=>{
        if(issue && plan?.status!=='WAITING' && lines.length+scanCount>0 && lines.every(r=>picks.includes(id(r))) && checkedScanCount===scanCount)setMessage('1개 이상의 투입자재는 필수 입니다.')
        else if(!(issue&&checkedScanCount)&&!lines.some(row=>picks.includes(id(row))))setMessage('삭제할 '+title+'를 선택하십시오.')
        else setConfirm(action)
      }}>−</button></header>
      <div className="prod-scroll"><table aria-label={title+' 목록'}><thead><Head headers={issue?['선택','창고','두께','폭','길이','재고','투입수량','로케이션','Lot no']:['선택','창고','로케이션','재질','두께','폭','길이','반납수량']}/></thead>
        <tbody>{issue&&extraIssueRows}{lines.map(r=>{const k=id(r),e=r.event,shown=patch(r)
          return <tr key={k}><td><input type="checkbox" aria-label={title+' '+k+' 선택'} checked={picks.includes(k)} onChange={ev=>setPicks(existing=>ev.target.checked?[...existing,k]:existing.filter(value=>value!==k))}/></td><td>{e.position.warehouse}</td>
            {issue?<><td>{shown.spec?.thickness}</td><td>{shown.spec?.width}</td><td>{shown.spec?.length}</td><td>{r.available}</td>
              <td className="prod-quantity-step"><button type="button" disabled={disabled} aria-label={e.lotCode+' 투입수량 빼기'} onClick={()=>{if(shown.quantity>=2)edit(r,'quantity',shown.quantity-1)}}>−</button>
                {valueButton(r,'quantity','투입수량')}<button type="button" disabled={disabled} aria-label={e.lotCode+' 투입수량 더하기'} onClick={()=>{if(shown.quantity<r.available+e.quantity)edit(r,'quantity',shown.quantity+1)}}>＋</button></td>
              <td>{e.position.location}</td><td>{e.lotCode}</td></>:<><td>{e.position.location}</td><td>{shown.spec?.quality}</td>
              {(['thickness','width','length'] as const).map(field=><td key={field}>{valueButton(r,field,'반납 '+label[field])}</td>)}<td>{valueButton(r,'quantity','반납수량')}</td></>}
          </tr>})}</tbody></table></div></section>})}
    {cell && <CommonNumericPad mode={cell.field==='quantity'?'integer':'decimal'} onApply={n=>{setCell(undefined);edit(cell.row,cell.field,Number(n))}} onCancel={()=>{
      const {row,field}=cell;setCell(undefined)
      if(plan?.status!=='WAITING' && row.event.action==='RETURN_MATERIAL'){const original=patch(row);edit(row,field,Number(field==='quantity'?original.quantity:original.spec?.[field]??0))}
    }}/>}
    {(message||confirm) && <Pop label="자재 안내" kind="rev-prompt" onClose={()=>{setMessage('');setConfirm(undefined)}}><p>{message||'선택한 자재를 삭제하시겠습니까?'}</p><footer>
      {confirm && <button type="button" onClick={()=>{
        const lines=rows.filter(r=>r.event.action===confirm&&picks.includes(id(r))).map(patch)
        if(lines.length)void save({requestId:crypto.randomUUID(),action:confirm,remove:true,lines,visible})
        else if(confirm==='ISSUE_MATERIAL'){removeCheckedScans();setConfirm(undefined)}
      }}>예</button>}
      <button type="button" onClick={()=>{setMessage('');setConfirm(undefined)}}>{confirm?'아니오':'확인'}</button></footer></Pop>}
    {pending && <button className="prod-status" type="button" disabled={busy} onClick={()=>void save(pending)}>같은 자재 요청 재시도</button>}
  </div>
}
