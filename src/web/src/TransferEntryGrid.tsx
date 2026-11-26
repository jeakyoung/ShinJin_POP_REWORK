import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { GridRecord } from './TransferGrid'

type Props={columns:(string|number)[][];rows:GridRecord[];title:string;style:CSSProperties;headerActions?:Record<string,()=>void>}
export default function TransferEntryGrid({columns,rows,title,style,headerActions}:Props) {
  const [focus,setFocus]=useState('')
  const selected=rows.find(r=>r.key===focus)?.key??rows[0]?.key
  const two=columns.some(c=>Number(c[2])>0||Number(c[4])>1)
  const rowHeight=(header:boolean)=>two?(header?40:35):50
  let x=0,start=0,bottom=0
  const cells=columns.map(([label,field,level,width,span],i)=>{
    const w=Number(width)
    if(!Number(level)){start=x;bottom=x;x+=w}
    const left=Number(level)?bottom:start
    if(level){bottom+=w;x=Math.max(bottom,x)}
    return {label:String(label),field:String(field||label),i,style:{position:'absolute' as const,left,top:Number(level),
      width:w,height:Number(span)}}
  })
  function line(row?:GridRecord){
    const unit=rowHeight(!row), height=two?unit*2:unit
    return <div role="row" key={row?.key??'headers'} aria-selected={row ? selected===row.key : undefined} onFocus={row?()=>setFocus(row.key):undefined} onClick={row?()=>setFocus(row.key):undefined} className={row?'entry-grid-row':'entry-grid-head'} style={{width:x,height}}>
      {cells.map(c=><div key={c.i} style={{...c.style,top:c.style.top*unit,height:c.style.height*unit}} role={row?'cell':'columnheader'}>{row?row.fields[c.field]:
        headerActions?.[c.field]?<button onClick={headerActions[c.field]}>{c.label}</button>:c.label}</div>)}</div>
  }
  return <div className="entry-grid" role="table" aria-label={title} style={style}>{line()}<div className="entry-grid-body" style={{height:`calc(100% - ${two?80:50}px)`}}>{rows.map(line)}</div></div>
}
