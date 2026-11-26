import {useState} from 'react'
import CommonNumericPad from './commonInput/CommonNumericPad'
import type {NumericPadMode} from './commonInput/CommonNumericPad'

type Props = { label:string; value:string; mode:NumericPadMode; disabled?:boolean; onApply:(value:string)=>void }

export default function DrawingNumber({label,value,mode,disabled,onApply}:Props) {
  const [open,setOpen]=useState(false)
  return <>
    <button type="button" className="drawing-number" aria-label={label} disabled={disabled}
      onClick={()=>setOpen(true)}>{value || '0'}</button>
    {open && <CommonNumericPad mode={mode} onApply={text=>{setOpen(false);onApply(text)}} onCancel={()=>setOpen(false)} />}
  </>
}
