import { useState } from 'react'
import type { Ask } from './ProcessPlanFields'
import { Choice, Head, Num } from './ProcessPlanFields'
import { materialId } from './processPlanApi'
import type { PlanScreen } from './processPlanApi'
import type { Run } from './ProcessPlanIssue'
import type { Material, PlanKey, SingleCommand, WorkState } from './planningApi'

type Source={material:Material;target:PlanKey}
type Draft={warehouse:string;kind:string;input:string;thickness:string;width:string;length:string;quantity:string}
const blank:Draft={warehouse:'',kind:'',input:'1',thickness:'0',width:'0',length:'0',quantity:'0'}
export type SpecRow=Source & {draft:Draft}
export function ProcessStock({data,start,ask,dismiss}:{data:PlanScreen;start:(rows:SpecRow[])=>void;ask:Ask;dismiss:()=>void}){
  const {planning:v,catalog:c}=data
  const [warehouse,setWarehouse]=useState(c.warehouses[0]??'')
  const [quality,setQuality]=useState(data.initialQuality??c.qualities[0]??'')
  const [picked,setPicked]=useState<string[]>([])
  const rows=c.stock.flatMap(link=>{
    const material=v.materials.find(m=>materialId(m.key)===materialId(link.source))
    if(!material || material.available<=0 || material.key.warehouse!==warehouse || material.spec.quality!==quality)return []
    return [{material,target:link.target,draft:{...blank}}]
  })
  return <><div className="rev-filters"><Choice label="재질" value={quality} options={c.qualities} onChange={x=>{setQuality(x);setPicked([])}}/>
    <Choice label="창고" value={warehouse} options={c.warehouses} onChange={x=>{setWarehouse(x);setPicked([])}}/></div>
    <div className="rev-grid"><table><thead><tr><th colSpan={7}>재고 목록</th></tr><Head headers={['선택','창고명','재질명','두께','폭','길이','재고수량']}/></thead>
      <tbody>{rows.map(({material:m})=>{const id=materialId(m.key);return <tr key={id}><td><input aria-label={m.key.lot+'/'+m.key.position+' 선택'} type="checkbox" checked={picked.includes(id)} onChange={e=>setPicked(e.target.checked?[...picked,id]:picked.filter(x=>x!==id))}/></td>
        {[m.key.warehouse,m.spec.quality,m.spec.thickness,m.spec.width,m.spec.length,m.available].map((x,i)=><td key={i}>{x}</td>)}</tr>})}</tbody></table></div>
    <footer><button type="button" onClick={()=>{if(!picked.length)ask('규격변경 진행할 항목을 선택하십시오.');else ask('선택한 항목으로 규격변경 진행하시겠습니까?',()=>start(rows.filter(r=>picked.includes(materialId(r.material.key)))))}}>규격 변경</button><button type="button" onClick={dismiss}>닫기</button></footer></>
}
export function SpecRegister({data,rows,setRows,run,ask,dismiss,done}:{data:PlanScreen;rows:SpecRow[];setRows:(v:SpecRow[])=>void;run:Run;ask:Ask;dismiss:()=>void;done:()=>void}) {
  const [focus,setFocus]=useState('')
  const [editor,setEditor]=useState<Draft>({...blank})
  const selected=rows.find(r=>materialId(r.material.key)===focus)
  const fields=[['thickness','두께'],['width','폭'],['length','길이'],['quantity','규격변경 수량']] as const
  function saveRow(){
    if(!selected){ask('규격변경 진행할 항목을 선택하십시오.');return}
    if(!editor.warehouse || !editor.kind){ask(!editor.warehouse?'창고를 선택하십시오.':'품목유형을 선택하십시오.');return}
    const missing=[['input','재고 투입수량'],...fields].find(([k])=>Number(editor[k as keyof Draft])<=0)
    if(missing){ask(missing[1]+'을 확인하십시오.');return}
    ask('규격변경 적용 하시겠습니까?',()=>{setRows(rows.map(r=>r===selected?{...r,draft:{...editor}}:r));ask('적용 되었습니다.')})
  }
  function publish(){
    if(!rows.length){ask('규격변경 진행하실 데이터가 없습니다.');return}
    if(rows.some(r=>!r.draft.warehouse)){ask('규격변경 진행하실 데이터를 입력하십시오.');return}
    if(rows.some(r=>Number(r.draft.input)>r.material.available)){ask('투입수량이 재고수량보다 높습니다.');return}
    const commands:SingleCommand[]=rows.map(({material,target,draft:d})=>({action:'CHANGE_SPEC',requestId:crypto.randomUUID(),expectedRevision:data.planning.revision,
      targetPlan:target,sourceMaterial:material.key,warehouse:d.warehouse,quantity:d.quantity,inputQuantity:d.input,
      spec:{quality:material.spec.quality,workState:d.kind as WorkState,thickness:d.thickness,width:d.width,length:d.length}}))
    ask('항목을 일괄 발행하시겠습니까?',()=>run({action:'BATCH',requestId:crypto.randomUUID(),expectedRevision:data.planning.revision,rows:commands},done))
  }
  return <><div className="rev-grid"><table><thead><tr><th colSpan={7}>기준</th><th colSpan={8}>규격변경</th></tr>
    <Head headers={['창고명','재질명','두께','폭','길이','재고수량','재고 투입수량','창고명','품목유형','재질명','두께','폭','길이','수량','삭제']}/></thead>
    <tbody>{rows.map(r=>{const m=r.material,id=materialId(m.key),d=r.draft;return <tr key={id} tabIndex={0} aria-selected={focus===id}
      onFocus={()=>{setFocus(id);setEditor({...d})}} onClick={()=>{setFocus(id);setEditor({...d})}}>
      {[m.key.warehouse,m.spec.quality,m.spec.thickness,m.spec.width,m.spec.length,m.available,d.input,d.warehouse,d.kind==='CUT'?'절단':d.kind?'완성':'',m.spec.quality,d.thickness,d.width,d.length,d.quantity].map((x,i)=><td key={i}>{x}</td>)}
      <td><button type="button" aria-label={id+' 삭제'} onClick={e=>{e.stopPropagation();ask('삭제 하시겠습니까?',()=>{setRows(rows.filter(x=>x!==r));setFocus('');setEditor({...blank});ask('삭제 되었습니다.')})}}>−</button></td></tr>})}</tbody></table></div>
    <div className="rev-editor"><div><Choice label="창고명" value={editor.warehouse} options={data.catalog.warehouses} onChange={x=>setEditor({...editor,warehouse:x})}/>
      <Choice label="품목유형" value={editor.kind==='CUT'?'절단':editor.kind?'완성':''} options={['절단','완성']} onChange={x=>setEditor({...editor,kind:x==='절단'?'CUT':'FINISHED'})}/>
      <span>재질명　{selected?.material.spec.quality}</span><label>투입수량　<Num label="투입수량" value={editor.input} onChange={x=>setEditor({...editor,input:x})}/></label></div>
      <div>{fields.map(([k,label])=><label key={k}>{label}　<Num label={label} value={editor[k]} onChange={x=>setEditor({...editor,[k]:x})}/></label>)}</div>
      <button type="button" onClick={saveRow}>적용</button></div>
    <footer><button type="button" disabled={!data.planning.canWrite} onClick={publish}>발행</button><button type="button" onClick={dismiss}>닫기</button></footer></>
}
