import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { InventoryPad } from './InventoryDialogs'
import './InventoryMoves.css'

export type Ask = (text:string, accept?:()=>void)=>void
export function Pop({label,kind,onClose,children}:{label:string;kind?:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null)
  useEffect(()=>{const dlg=ref.current;dlg?.showModal();return ()=>dlg?.close()},[])
  return <dialog ref={ref} aria-label={label} className={'rev-pop '+(kind??'')} onCancel={e=>{e.preventDefault();e.stopPropagation();onClose()}}>{children}</dialog>
}
export function Choice({label,value,options,onChange}:{label:string;value:string;options:string[];onChange:(s:string)=>void}) {
  const [open,setOpen]=useState(false)
  const [term,setTerm]=useState('')
  return <div className="rev-choice"><span>{label}</span><button type="button" aria-label={label+' 검색'} onClick={()=>{setTerm('');setOpen(true)}}>{value}<b aria-hidden="true">⚲</b></button>
    {open && <Pop label={label+' 검색'} kind="rev-lookup" onClose={()=>setOpen(false)}>
      <input aria-label={label+' 검색어'} autoFocus value={term} onChange={e=>setTerm(e.target.value)}/>
      <div>{options.filter(x=>x.toLowerCase().includes(term.toLowerCase())).map(x=><button key={x} type="button" onClick={()=>{onChange(x);setOpen(false)}}>{x}</button>)}</div>
      <button type="button" onClick={()=>setOpen(false)}>닫기</button>
    </Pop>}</div>
}
export function Num({label,value,onChange}:{label:string;value:string;onChange:(n:string)=>void}) {
  const [open,setOpen]=useState(false)
  return <><button type="button" className="rev-num" aria-label={label} onClick={()=>setOpen(true)}>{value||'-'}</button>
    {open && <InventoryPad label={label+' 입력'} decimal onClose={()=>setOpen(false)} onApply={n=>{onChange(String(n));setOpen(false)}}/>}</>
}
export function Head({headers}:{headers:string[]}) {
  return <tr>{headers.map((h,i)=><th key={i}>{h}</th>)}</tr>
}
