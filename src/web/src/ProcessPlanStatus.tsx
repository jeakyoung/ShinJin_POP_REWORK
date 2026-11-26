import { useState } from 'react'
import type { Ask } from './ProcessPlanFields'
import { Choice,Head,Num,Pop } from './ProcessPlanFields'
import { orderId,planId } from './processPlanApi'
import type { PlanScreen } from './processPlanApi'
import type { Run } from './ProcessPlanIssue'


export default function ProcessPlanStatus({data,spec,ask,run,dismiss,source}:{source:'frmProcess1'|'frmProcess3'|'frmProcess5'|'frmProcess7';data:PlanScreen;spec:boolean;ask:Ask;run:Run;dismiss:()=>void}) {
  const {planning:v,catalog:c}=data
  const [warehouse,setWh]=useState(c.warehouses[0]??'')
  const [quality,setQual]=useState(data.initialQuality??c.qualities[0]??'')
  const [from,setFrom]=useState(c.date.slice(0,7)+'-01'),[to,setTo]=useState(c.date)
  const [printed,setPrinted]=useState('미출력'),[thickness,setThickness]=useState('0')
  const [selected,setSelected]=useState<string[]>([]),[printing,setPrinting]=useState(false)
  const rows=v.plans.filter(p=>spec===(p.branch==='SPEC_CHANGE')).flatMap(p=>{
    const count=data.prints.find(r=>planId(r.key)===planId(p.key))?.count??0
    const src=v.materials.find(m=>p.materialUse && JSON.stringify(m.key)===JSON.stringify(p.materialUse.source))
    const filterWh=spec?src?.key.warehouse:p.warehouse, filterQuality=spec?src?.spec.quality:p.spec.quality
    if(warehouse && filterWh!==warehouse || quality && filterQuality!==quality)return []
    if(!spec && (p.key.date<from || p.key.date>to || (printed==='출력' && !count) || (printed==='미출력' && count>0) || (Number(thickness)>0&&p.spec.thickness!==Number(thickness))))return []
    return [{p,count,src,order:v.orders.find(o=>orderId(o.key)===orderId(p.originalOrder))}]
  })
  const chosen=rows.filter(({p})=>selected.includes(planId(p.key)))
  function output(mode:'SINGLE'|'MULTIPLE'){
    setPrinting(false)
    if(mode==='MULTIPLE' && new Set(chosen.map(({p})=>p.issuedOrder.number)).size>1){ask('다중 출력은 동일한 수주번호로만 출력 가능합니다.');return}
    run({action:'OUTPUT',requestId:crypto.randomUUID(),expectedRevision:v.revision,selection:{site:v.actor.site,mode,plans:chosen.map(({p})=>p.key)}})
  }
  return <><div className="rev-filters"><Choice label="재질" value={quality} options={c.qualities} onChange={s=>{setQual(s);setSelected([])}}/>
    <Choice label="창고" value={warehouse} options={c.warehouses} onChange={s=>{setWh(s);setSelected([])}}/>
    {!spec && <><label>일자 <input aria-label="조회 시작일" type="date" value={from} onChange={e=>{setFrom(e.target.value);setSelected([])}}/></label>~
      <input aria-label="조회 종료일" type="date" value={to} onChange={e=>{setTo(e.target.value);setSelected([])}}/>
      <Choice label="출력" options={['전체','출력','미출력']} value={printed} onChange={s=>{setPrinted(s);setSelected([])}}/>
      <label>두께 <Num label="조회 두께" value={thickness} onChange={s=>{setThickness(s);setSelected([])}}/></label></>}</div>
    <div className="rev-grid"><table><thead>{spec && <tr><th></th><th colSpan={7}>기준</th><th colSpan={7}>규격변경</th></tr>}
      <Head headers={spec?['선택','창고명','재질명','두께','폭','길이','재고수량','재고 투입수량','수주번호','창고명','재질명','두께','폭','길이','수량']:['선택','생산계획년','생산계획월','생산계획수량','총발행수량','창고명','재질명','두께','폭','길이','계획번호','수주번호','작업지시번호','발행수량','프린트수','발행잔량']}/></thead>
      <tbody>{rows.map(({p,count,src,order})=>{const id=planId(p.key)
        const values=spec?[src?.key.warehouse,src?.spec.quality,src?.spec.thickness,src?.spec.width,src?.spec.length,src?.available,p.materialUse?.quantity,p.issuedOrder.number,p.warehouse,p.spec.quality,p.spec.thickness,p.spec.width,p.spec.length,p.quantity]
          :[p.key.date.slice(0,4),p.key.date.slice(5,7),order?.ordered,order?.issued,p.warehouse,p.spec.quality,p.spec.thickness,p.spec.width,p.spec.length,id,p.issuedOrder.number+'/'+p.issuedOrder.line,id,p.quantity,count,order?order.ordered-order.issued:'']
        return <tr key={id}><td><input aria-label={id+' 선택'} type="checkbox" checked={selected.includes(id)} onChange={e=>setSelected(e.target.checked?[...selected,id]:selected.filter(k=>k!==id))}/></td>
          {values.map((x,i)=><td key={i}>{x}</td>)}</tr>})}</tbody></table></div>
    <footer>{!spec && ((source==='frmProcess3'||source==='frmProcess5')?c.plantCode==='000001':c.directApply) && <button type="button" disabled={!v.canWrite} onClick={()=>{if(source==='frmProcess3'||source==='frmProcess5' || !chosen.length)return
      const keys=chosen.map(({p})=>p.key)
      run({action:'ATTACH',requestId:crypto.randomUUID(),expectedRevision:v.revision,plans:keys},()=>setSelected([]))}}>바로적용</button>}
      <button type="button" disabled={!v.canWrite} onClick={()=>{if(!chosen.length)ask('출력하실 데이터를 선택하십시오.');else setPrinting(true)}}>프린트</button><button type="button" onClick={dismiss}>닫기</button></footer>
    {printing && <Pop label="출력 선택" kind="rev-choose" onClose={()=>setPrinting(false)}><div><button type="button" onClick={()=>output('SINGLE')}>단일 출력</button><button type="button" onClick={()=>output('MULTIPLE')}>다중 출력</button></div><footer><button type="button" onClick={()=>setPrinting(false)}>닫기</button></footer></Pop>}
  </>
}
