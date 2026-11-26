import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../commonInput/commonScanDialog.css'

export default function LocationInput({onScan,onClose}:{onScan:(raw:string,signal:AbortSignal)=>Promise<void>;onClose:()=>void}){
  const field=useRef<HTMLInputElement>(null)
  const modal=useRef<HTMLDialogElement>(null)
  const pending=useRef<AbortController|null>(null)
  const [raw,setRaw]=useState('')
  useEffect(()=>{const dialog=modal.current!;dialog.showModal();field.current?.focus()
    return ()=>{pending.current?.abort();dialog.close()}},[])
  async function submit(){
    if(pending.current)return
    const controller=new AbortController();pending.current=controller
    try {await onScan(raw,controller.signal)} finally {
      if(!controller.signal.aborted){setRaw('');field.current?.focus()} pending.current=null
    }
  }
  return createPortal(<dialog ref={modal} className="common-scan-dialog pl-location-scan" aria-label="Location 바코드를 스캔하세요."
    onCancel={e=>e.preventDefault()}>
    <input ref={field} aria-label="Location 바코드를 스캔하세요." value={raw} autoComplete="off" onChange={e=>setRaw(e.target.value)}
      onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void submit()}}}/>
    {!raw&&<span aria-hidden="true">Location 바코드를 스캔하세요.</span>}
    <button type="button" onClick={onClose}>닫기</button></dialog>,document.body)
}
