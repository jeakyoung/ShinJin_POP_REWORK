import { useState } from 'react'
import { Choice, Head, Num, Pop } from './ProcessPlanFields'
import type { Ask } from './ProcessPlanFields'
import { orderId, unlock } from './processPlanApi'
import type { PlanScreen, ProcessCommand } from './processPlanApi'
import type { SingleCommand, WorkState } from './planningApi'
import CommonNumericPad from './commonInput/CommonNumericPad'

export type Run=(command:ProcessCommand,after?:()=>void)=>void
type Props={data:PlanScreen;run:Run;ask:Ask;dismiss:()=>void;parentQualities:string[];apiBase?:string;useIssuePad:boolean}
const initialEditor={workState:'',thickness:'',width:'',length:'',quantity:''}

function exceedsOrder(quantity:string,issued:number,ordered:number) {
  const decimal=(n:number)=>n.toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:20})
  const parts=[decimal(Number(quantity)),decimal(issued),decimal(ordered)].map(value=>value.split('.'))
  const scale=Math.max(...parts.map(([,fraction=''])=>fraction.length))
  const [added,previous,total]=parts.map(([whole,fraction=''])=>BigInt(whole+fraction.padEnd(scale,'0')))
  return added+previous>total
}

export default function ProcessPlanIssue({data,run,ask,dismiss,parentQualities,apiBase,useIssuePad}:Props) {
  const {planning:v,catalog:c}=data
  const [warehouse,setWarehouse]=useState(c.warehouses[0]??'')
  const [quality,setQuality]=useState(data.initialQuality??c.qualities[0]??'')
  const [month,setMonth]=useState(c.date.slice(0,7))
  const [all,setAll]=useState(false)
  const [picked,setPicked]=useState<string[]>([])
  const [amount,setAmount]=useState<Record<string,string>>({})
  const [editing,setEditing]=useState<{id:string;ordered:number;issued:number}>()
  const [admin,setAdmin]=useState(false)
  const [prompt,setPrompt]=useState(false)
  const [password,setPassword]=useState('')
  const [editor,setEditor]=useState(initialEditor)
  function clear(){setPicked([]);setAmount({});setAdmin(false)}
  const included=v.orders.flatMap(order=>{
    const meta=c.orders.find(m=>orderId(m.key)===orderId(order.key))
    if (!meta || meta.month!==month || order.warehouse!==warehouse || order.spec.quality!==quality) return []
    if(!all && !(meta.defaultListed??(order.ordered>order.issued)))return []
    return [{order,meta,id:orderId(order.key)}]
  })
  function issue() {
    const chosen=included.filter(row=>picked.includes(row.id))
    if (!chosen.length) {ask('발행할 항목이 없습니다.');return}
    if (chosen.some(row=>Number(amount[row.id]??0)<1)) {ask('발행 수량을 입력하십시오.');return}
    if (chosen.some(row=>parentQualities.some(q=>q!==row.order.spec.quality))) {ask('동일한 재질만 발행 할 수 있습니다. 확인하십시오.');return}
    const rows:SingleCommand[]=chosen.map(({order,id})=>({action:'REVERSE_ISSUE',requestId:crypto.randomUUID(),expectedRevision:v.revision,
      originalOrder:order.key,warehouse,quantity:amount[id]}))
    ask('선택한 항목을 발행하시겠습니까?',()=>run({action:'BATCH',requestId:crypto.randomUUID(),expectedRevision:v.revision,rows},clear))
  }
  function manage() {
    if (!editor.workState || Object.entries(editor).some(([k,value])=>k!=='workState' && Number(value)<=0)) {ask('품목 유형과 두께·폭·길이·생산계획수량을 확인하십시오.');return}
    ask('생산계획에 반영하시겠습니까?',()=>run({action:'MANAGEMENT',requestId:crypto.randomUUID(),expectedRevision:v.revision,
      warehouse,quantity:editor.quantity,spec:{quality,workState:editor.workState as WorkState,thickness:editor.thickness,width:editor.width,length:editor.length}},()=>{setAdmin(false);setEditor(initialEditor)}))
  }
  return <><div className="rev-filters"><label>전체 <input type="checkbox" checked={all} onChange={e=>{setAll(e.target.checked);clear()}}/></label>
    <label>연도 <input aria-label="생산계획년월" type="month" value={month} onChange={e=>{setMonth(e.target.value);clear()}}/></label>
    <Choice label="재질" value={quality} options={c.qualities} onChange={s=>{setQuality(s);clear()}}/>
    <Choice label="창고" value={warehouse} options={c.warehouses} onChange={s=>{setWarehouse(s);clear()}}/></div>
    <div className="rev-issue-body"><div className="rev-grid"><table><thead><Head headers={['선택','창고명','품목유형','재질명','두께','폭','길이','생산계획년','생산계획월','생산계획수량','재고수량','재공수량','기발행수량','발행수량']}/></thead>
    <tbody>{included.map(({order:o,meta,id})=>{
      const q=amount[id]??'0'
      return <tr key={id}><td><input type="checkbox" aria-label={o.key.number+'/'+o.key.line+' 선택'} checked={picked.includes(id)}
        onChange={e=>setPicked(e.target.checked?[...picked,id]:picked.filter(x=>x!==id))}/></td>
        {[o.warehouse,o.spec.workState==='CUT'?'절단':'완성',o.spec.quality,o.spec.thickness,o.spec.width,o.spec.length,meta.month.slice(0,4),meta.month.slice(5),o.ordered,meta.stock,meta.inProcess,o.issued].map((value,i)=><td key={i}>{value}</td>)}
        <td className="rev-steppers"><button type="button" aria-label={o.key.number+'/'+o.key.line+' 빼기'} onClick={()=>setAmount({...amount,[id]:String(Math.max(0,Number(q)-1))})}>−</button>
          {useIssuePad?<button type="button" className="rev-num" aria-label={o.key.number+'/'+o.key.line+' 발행수량'} onClick={()=>setEditing({id,ordered:o.ordered,issued:o.issued})}>{q}</button>:
            <Num label={o.key.number+'/'+o.key.line+' 발행수량'} value={q} onChange={next=>{if(exceedsOrder(next,o.issued,o.ordered)) ask('발행수량을 확인하십시오.');else setAmount({...amount,[id]:next})}}/>}
          <button type="button" aria-label={o.key.number+'/'+o.key.line+' 더하기'} onClick={()=>{const next=String(Number(q)+1);if(!exceedsOrder(next,o.issued,o.ordered))setAmount({...amount,[id]:next})}}>＋</button></td></tr>
    })}</tbody></table></div><button type="button" className="rev-admin" onClick={()=>{if(admin)setAdmin(false);else {setPassword('');setPrompt(true)}}}>관리자 작업</button></div>
    {admin && <div className="rev-editor"><div><span>생산계획년　{month.slice(0,4)}</span><span>생산계획월　{month.slice(5)}</span><span>재질명　{quality}</span><span>창고명　{warehouse}</span></div>
      <div><Choice label="품목 유형" value={editor.workState==='CUT'?'절단':editor.workState?'완성':''} options={['절단','완성']} onChange={x=>setEditor({...editor,workState:x==='절단'?'CUT':'FINISHED'})}/>
      {([['thickness','두께'],['width','폭'],['length','길이'],['quantity','생산계획수량']] as const).map(([key,label])=><label key={key}>{label}<Num label={label} value={editor[key]} onChange={x=>setEditor({...editor,[key]:x})}/></label>)}</div><button type="button" onClick={manage}>적용</button></div>}
    <footer><button type="button" disabled={!v.canWrite} onClick={issue}>발행</button><button type="button" onClick={dismiss}>닫기</button></footer>
    {editing && <CommonNumericPad mode="decimal" onCancel={()=>setEditing(undefined)} onApply={value=>{
      setEditing(undefined)
      if(exceedsOrder(value,editing.issued,editing.ordered))ask('발행수량을 확인하십시오.')
      else setAmount(current=>({...current,[editing.id]:value}))
    }}/>}
    {prompt && <Pop label="관리자 암호" kind="rev-prompt" onClose={()=>setPrompt(false)}>
      <form onSubmit={e=>{e.preventDefault();void unlock(password,apiBase).then(()=>{setPrompt(false);setPassword('');setAdmin(true)}).catch(()=>ask('암호가 일치하지 않습니다.'))}}>
        <label>암호<input type="password" autoFocus value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <footer><button type="submit">확인</button><button type="button" onClick={()=>setPrompt(false)}>닫기</button></footer>
      </form></Pop>}
  </>
}
