import { useId, useRef } from 'react'

export function DrawingDecisionButton({label,question,className,ariaLabel,disabled,canOpen,prepare,onConfirm}:{
  label:string; question:string; className?:string; ariaLabel?:string; disabled:boolean; canOpen?:()=>boolean; prepare?:(open:()=>void)=>void; onConfirm:()=>void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  return <>
    <button type="button" className={className} aria-label={ariaLabel} disabled={disabled} onClick={() => { if (canOpen && !canOpen()) return; const open=()=>dialog.current?.showModal(); if (prepare) prepare(open); else open() }}>
      {label}
    </button>
    <dialog ref={dialog} className="floor-confirm" aria-labelledby={id}>
      <p id={id}>{question}</p>
      <button type="button" disabled={disabled} onClick={() => { dialog.current?.close(); onConfirm() }}>예</button>
      <button type="button" onClick={() => dialog.current?.close()}>아니오</button>
    </dialog>
  </>
}

export default function DrawingPauseButton({paused,disabled,prepare,onConfirm}:{paused:boolean;disabled:boolean;prepare?:(open:()=>void)=>void;onConfirm:()=>void}) {
  return <DrawingDecisionButton className="drawing-pause" label={paused?'RESTART\n재시작':'STOP\n작업중단'}
    question={paused?'작업 재시작 하시겠습니까?':'작업 일시 중단 하시겠습니까?'} disabled={disabled} prepare={prepare} onConfirm={onConfirm}/>
}
