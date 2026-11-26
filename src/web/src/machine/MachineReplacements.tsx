import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CommonNumericPad from '../commonInput/CommonNumericPad'
import TransferMessage from '../TransferMessage'
import type { Message } from '../TransferMessage'
import './machineReplacements.css'

type RowKey = { lot: string; sequence: string }
type Candidate = { row: RowKey; name: string; part: string; received: string; remaining: number }
type Replacement = { number: string; machine: string; name: string; part: string; quantity: number; employee: string; time: string }
type Command = { key: string; lines: { row: RowKey; quantity: number }[] }
const rowId = (key: RowKey) => JSON.stringify([key.lot,key.sequence])
const asset = (name: string) => import.meta.env.BASE_URL+'machine-calls/'+name+'.png'

export default function MachineReplacements({ machine, expired }: { machine: string; expired: () => void }) {
  const base = '/api/demo/machine-calls/'+encodeURIComponent(machine)
  const [history,setHistory] = useState<Replacement[]>([])
  const [open,setOpen] = useState(false)
  const [revision,refresh] = useState(0)
  const [failed,setFailed] = useState(false)
  useEffect(()=>{
    const ctrl = new AbortController()
    fetch(base+'/replacements',{signal:ctrl.signal,cache:'no-store'}).then(async response=>{
      if (ctrl.signal.aborted) return
      if (response.status===401) { expired(); return }
      if (!response.ok) throw Error()
      const rows: Replacement[] = await response.json()
      if (!ctrl.signal.aborted) { setHistory(rows); setFailed(false) }
    }).catch(()=>{if (!ctrl.signal.aborted) setFailed(true)})
    return ()=>ctrl.abort()
  },[base,revision,expired])
  return <>
    <div className="mc-panel-actions">{['소모품 신청','조치자'].map((label,i)=><div key={label} style={{backgroundImage:'url('+asset('Container_00-1')+')'}}>
      <span>{label}</span><button aria-label={label} disabled={i===1 || open} onClick={()=>setOpen(true)}>
        <img alt="" src={asset(i===0?'expendables01_hover':'action')}/></button></div>)}</div>
    <div className="mc-issues mc-changes">
      {failed && <p role="alert">교체 내역을 조회하지 못했습니다. <button onClick={()=>refresh(n=>n+1)}>다시 조회</button></p>}
      <table aria-label="소모품 교체 내역"><colgroup>{[151,166,200,200,120,120,120,120].map((width,i)=><col key={i} style={{width:(100*width/1197)+'%'}}/>)}</colgroup><thead><tr>{['설비명','신청번호','품목명','PART_NO','교체일','수량','신청인','신청일시'].map(label=><th key={label}>{label}</th>)}</tr></thead>
        <tbody>{history.map(row=><tr key={row.number}><td>{row.machine}</td><td>{row.number}</td><td>{row.name}</td><td>{row.part}</td>
          <td>{row.time.slice(0,10)}</td><td>{row.quantity}</td><td>{row.employee}</td><td>{row.time.replace('T',' ')}</td></tr>)}</tbody></table>
    </div>
    {open && createPortal(<RequestDialog base={base} expired={expired} close={reloadHistory=>{setOpen(false);if(reloadHistory)refresh(n=>n+1)}}/>,document.body)}
  </>
}

function RequestDialog({ base, expired, close }: { base: string; expired: () => void; close: (reloadHistory:boolean)=>void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const lifetime = useRef<AbortController | null>(null)
  const pending = useRef<Command | null>(null)
  const writing = useRef(false)
  const [rows,setRows] = useState<Candidate[]>([])
  const [checked,setChecked] = useState<Record<string,boolean>>({})
  const [amounts,setAmounts] = useState<Record<string,number>>({})
  const [editing,setEditing] = useState<Candidate>()
  const [message,setMessage] = useState<Message>()
  const [done,setDone] = useState(false)
  const [busy,setBusy] = useState(true)
  const [unknown,setUnknown] = useState(false)
  const [loadFailed,setLoadFailed] = useState(false)
  const read = useCallback((signal:AbortSignal)=>fetch(base+'/expendables',{signal,cache:'no-store'})
    .then(async res=>{
      if (signal.aborted) return
      if (res.status===401) { expired();return }
      if (!res.ok) throw Error()
      const data: Candidate[] = await res.json()
      if (!signal.aborted) {setRows(data);setAmounts({});setChecked({});setLoadFailed(false)}
    })
    .catch(()=>{if (!signal.aborted) {setRows([]);setLoadFailed(true)}})
    .finally(()=>{if (!signal.aborted) setBusy(false)}),[base,expired])
  useEffect(()=>{
    const el=dialog.current!, ctrl=new AbortController()
    lifetime.current=ctrl;el.showModal();void read(ctrl.signal)
    return ()=>{ctrl.abort();el.close()}
  },[read])
  function quantity(row:Candidate,value:number) {
    setAmounts(old=>({...old,[rowId(row.row)]:Math.min(row.remaining,Math.max(0,value))}))
  }
  async function send(command:Command) {
    const signal=lifetime.current?.signal
    if (!signal || signal.aborted || writing.current) return
    writing.current=true;pending.current=command;setBusy(true)
    try {
      const res=await fetch(base+'/replacements',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(command)})
      if (signal.aborted) return
      if (res.status===401) {expired();return}
      if (res.status===409) {
        const failure=await res.json()
        if (signal.aborted) return
        if (failure.code==='BALANCE_CHANGED') {
          pending.current=null;setUnknown(false);await read(signal)
          if (!signal.aborted) setMessage({text:failure.itemName+' 품목의 개수가 갱신 되었습니다.\n수량 확인 후 재신청 바랍니다.'})
          return
        }
      }
      if (!res.ok) {
        if (res.status>=500) throw Error()
        pending.current=null;setUnknown(false);setMessage({text:'소모품 신청을 처리할 수 없습니다.'});return
      }
      pending.current=null;setUnknown(false);setDone(true);setMessage({text:'소모품 신청 되었습니다.'})
    } catch {if (!signal.aborted) setUnknown(true)}
    finally {writing.current=false;if (!signal.aborted) setBusy(false)}
  }
  function apply() {
    if (busy || message || done || writing.current) return
    if (pending.current) {void send(pending.current);return}
    const lines=rows.filter(r=>checked[rowId(r.row)]).map(r=>({row:r.row,quantity:amounts[rowId(r.row)]??0}))
    if (!lines.length) {setMessage({text:'소모품을 선택 해주세요.'});return}
    setMessage({text:'선택한 소모품을 신청 하시겠습니까?',yes:()=>void send({key:crypto.randomUUID(),lines})})
  }
  function cancel() {if (!writing.current && !done) close(unknown)}
  const locked=busy || unknown || done
  return <dialog ref={dialog} className="mc-request" aria-label="소모품 목록" onCancel={e=>{e.preventDefault();cancel()}}>
    <header>소모품 목록</header>
    <div className="mc-request-grid"><table><colgroup>{[69,99,159,159,99,59,100,59].map((w,i)=><col key={i} style={{width:(100*w/803)+'%'}}/>)}</colgroup>
      <thead><tr>{['선택','입고일','품목명','PART_NO','남은수량','-','신청수량','+'].map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(row=>{
        const id=rowId(row.row), amount=amounts[id]??0
        return <tr key={id}><td><label><input aria-label={row.name+' '+row.row.lot+' '+row.row.sequence+' 선택'} type="checkbox" disabled={locked}
          checked={!!checked[id]} onChange={e=>setChecked({...checked,[id]:e.target.checked})}/></label></td><td>{row.received}</td>
          <td>{row.name}</td><td>{row.part}</td><td>{row.remaining}</td>
          <td><button aria-label="감소" disabled={locked} onClick={()=>quantity(row,amount-1)}>−</button></td>
          <td><button aria-label="신청수량" disabled={locked} onClick={()=>setEditing(row)}>{amount}</button></td>
          <td><button aria-label="증가" disabled={locked} onClick={()=>quantity(row,amount+1)}>+</button></td></tr>
      })}</tbody></table>
      {loadFailed && <p role="alert">소모품 목록을 조회하지 못했습니다. <button onClick={()=>{if(lifetime.current){setBusy(true);void read(lifetime.current.signal)}}}>다시 조회</button></p>}
    </div>
    {unknown && <p role="alert">신청 결과를 확인하지 못했습니다. 신청을 눌러 같은 요청을 다시 확인하십시오.</p>}
    <footer><button disabled={busy || done || loadFailed} onClick={apply}>신청</button><button disabled={(busy && rows.length>0) || done} onClick={cancel}>닫기</button></footer>
    {editing && <CommonNumericPad mode="integer" onCancel={()=>setEditing(undefined)} onApply={value=>{quantity(editing,Number(value));setEditing(undefined)}}/>}
    {message && <div className="settings-message-scope"><TransferMessage key={message.text} message={message} close={()=>{setMessage(current=>current===message?undefined:current);if(done)close(true)}}/></div>}
  </dialog>
}
