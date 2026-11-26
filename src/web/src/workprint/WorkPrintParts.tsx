import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Choice, GridRow } from './workPrintLayout'

export function Dialog({ name, width, height, close, children, scan = false }: {
  name:string, width:number, height:number, close:()=>void, children:ReactNode, scan?:boolean
}) {
  const ref=useRef<HTMLDialogElement>(null)
  useEffect(()=>{ const dialog=ref.current!;dialog.showModal();return ()=>dialog.close() },[])
  return <dialog className={'wp-dialog'+(scan?' wp-scan-dialog':'')} aria-label={name} ref={ref}
    style={{width:'min(100vw, '+width+'px)',height:'min(100dvh, '+height+'px)'}} onCancel={e=>{e.preventDefault();close()}}>
    <div className="wp-pop" data-form={name}>{children}</div>
  </dialog>
}

export function OptionDialog({ material, choices, values, save, close }: {
  material:boolean, choices:Choice[], values:string[], save:(v:string[])=>void, close:()=>void
}) {
  const [draft,setDraft]=useState(values)
  const ids=choices.map(([id,name])=>material?id:name)
  const all=ids.every(id=>draft.includes(id))
  const title=material?'재질 선택':'계정구분'
  return <Dialog name={material?'frmMaterialOption':'frmProductOption'} width={798} height={868} close={close}>
    <div className="wp-opt-title">{title}<button aria-label="닫기" onClick={close}>×</button></div>
    <div className="wp-opt-grid"><table><thead><tr><th><button onClick={()=>setDraft(all?[]:ids)}>{material?'사용':'선택'}</button></th>
      {material && <th>순번</th>}<th>{material?'재질코드':'코드'}</th><th>{material?'재질명':title}</th></tr></thead>
      <tbody>{choices.map(([id,name],i)=><tr key={id}><td><input type="checkbox" aria-label={name} checked={draft.includes(ids[i])}
        onChange={()=>setDraft(draft.includes(ids[i])?draft.filter(v=>v!==ids[i]):[...draft,ids[i]])}/></td>
        {material && <td>{i+1}</td>}<td>{id}</td><td>{name}</td></tr>)}</tbody></table></div>
    <button className="wp-opt-save" onClick={()=>save(ids.filter(id=>draft.includes(id)))}>저장</button><button className="wp-opt-cancel" onClick={close}>취소</button>
  </Dialog>
}

const columns=[
 ['chk','선택'],['IDX','No'],['CUSTOMER_NAME','거래처명','ORDER_NO','수주번호'],['CONVERT_PRODPLAN_DATE','수주일자','DELIVERY_DATE','납기일자'],
 ['ITEM_KIND_NAME3','품목유형','MAT_QUALITY_NAME','재질'],['THICKNESS','두께'],['SPEC_X','폭'],['SPEC_Y','길이'],['ORDER_QTY','수량'],
 ['SHIPPING_QTY','출하\n수량','BASE_NAME','출력인'],['PRINT_CNT','POP\nPrint','ERP_PRINT_CNT','ERP\nPrint'],['NM_SL','계정\n구분'],['OPMAN_CODE','생성자'],['OPTIME','생성일자'],
]
function value(row:GridRow,k:string,index:number) {
  if(k==='IDX')return String(index+1)
  const v=row.fields[k]
  if(['THICKNESS','SPEC_X','SPEC_Y'].includes(k) && v) return Number(v).toFixed(Number.isInteger(Number(v))?0:1)
  return v
}
export function OrderGrid({ rows,checked,focus,setFocus,onSort,toggle,toggleAll }: {
  rows:GridRow[],checked:string[],focus:string,setFocus:(key:string)=>void,onSort:(field:string)=>void,toggle:(key:string)=>void,toggleAll:()=>void
}) {
  function header(field:string,label:string) {
    return <button onClick={()=>field==='chk'?toggleAll():onSort(field)}>{label}</button>
  }
  return <div className="wp-orders" role="table" aria-label="작업지시 목록"><div className="wp-band wp-band-header" role="row">
    {columns.map(([k,title,b,bt])=><div role="columnheader" key={k}>{header(k,title)}{b && header(b,bt)}</div>)}<div/></div>
    {rows.map((r,i)=><div className="wp-band" key={r.key} data-row={r.key} data-focus={r.key===focus} role="row" onClick={()=>setFocus(r.key)}>
      {columns.map(([k,,b])=><div role="cell" key={k} data-field={k} data-account={k==='NM_SL'?r.fields[k]:undefined}>
        {k==='chk'?<input type="checkbox" aria-label={r.key} checked={checked.includes(r.key)} onChange={()=>toggle(r.key)}/>:
        <span>{value(r,k,i)}</span>}{b && <span data-field={b}>{value(r,b,i)}</span>}</div>)}<div/></div>)}
  </div>
}

export function Calendar({date,pick}: {date:string,pick:(v:string)=>void}) {
  const [month,setMonth]=useState(()=>new Date(date+'T12:00:00'))
  const [level,setLevel]=useState<'days'|'months'|'years'>('days')
  const y=month.getFullYear(),m=month.getMonth(),decade=Math.floor(y/10)*10
  function dayString(d:Date){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  function move(direction:number){
    if(level==='days')setMonth(new Date(y,m+direction,1))
    else setMonth(new Date(y+direction*(level==='months'?1:10),m,1))
  }
  return <div className="wp-calendar" role="dialog" aria-label="수주일 달력">
    <header><button onClick={()=>setLevel(level==='days'?'months':'years')}>{level==='days'?(m+1)+'월 '+y:level==='months'?y:decade+' – '+(decade+9)}</button>
      <button aria-label="이전" onClick={()=>move(-1)}>⌃</button><button aria-label="다음" onClick={()=>move(1)}>⌄</button></header>
    {level==='days'?<div className="wp-days">{[...'일월화수목금토'].map(d=><span key={d}>{d}</span>)}
    {Array.from({length:42},(_,i)=>{const d=new Date(y,m,1-new Date(y,m,1).getDay()+i),v=dayString(d)
      return <button key={v} aria-label={v} aria-pressed={date===v} data-adjacent={d.getMonth()!==m} onClick={()=>pick(v)}>{d.getDate()}</button>})}</div>:
    <div className="wp-months">{Array.from({length:12},(_,i)=>{const n=level==='months'?i+1:decade-1+i
      return <button key={i} onClick={()=>{setMonth(new Date(level==='months'?y:n,level==='months'?i:m,1));setLevel(level==='months'?'days':'months')}}>{n}{level==='months'?'월':''}</button>})}</div>}
    <button className="wp-today" onClick={()=>pick(dayString(new Date()))}>Today</button>
  </div>
}
