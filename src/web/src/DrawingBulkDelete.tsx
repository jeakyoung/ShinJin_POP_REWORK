import { useRef, useState } from 'react'
import { drawingApi, drawingRequest, DrawingError } from './drawingApi'
import { SessionExpired } from './workHistoryApi'
import type { DrawingDetail } from './drawingApi'

type Props = { keys: string[]; actor: string; disabled: boolean; onDone: () => void; onExpired: () => void; onPending: (value:boolean) => void }
type DeleteList = { requestId: string; rows: {key: string; expectedVersion: number}[] }

export default function DrawingBulkDelete({keys,actor,disabled,onDone,onExpired,onPending}:Props) {
  const storage='drawing-delete-list:'+actor
  const [pending,setPending]=useState<DeleteList|undefined>(()=> {
    const saved=sessionStorage.getItem(storage)
    return saved ? JSON.parse(saved) as DeleteList : undefined
  })
  const [draft,setDraft]=useState<DeleteList>()
  const [message,setMessage]=useState('')
  const [locked,setLocked]=useState(false)
  const prompt=useRef<HTMLDialogElement>(null)
  const controller=useRef<AbortController|null>(null)

  async function open() {
    if (controller.current || disabled) return
    const control=new AbortController()
    controller.current=control
    setLocked(true)
    try {
      setDraft(undefined)
      const snapshots=await Promise.all(keys.map(key=>drawingRequest<DrawingDetail>(drawingApi+'/plans/'+encodeURIComponent(key),control.signal)))
      if (snapshots.some(s=>!['CUT_READY','DRAW_READY','DRAW_ACTIVE','DRAW_PAUSED'].includes(s.state))) setMessage('작업완료된 건이 존재합니다. 확인하십시오.')
      else {
        setDraft({requestId:crypto.randomUUID(),rows:keys.map((key,i)=>({key,expectedVersion:snapshots[i].version}))})
        setMessage('작업지시 번호를 일괄삭제 하시겠습니까?')
      }
      prompt.current?.showModal()
    } catch (e) {
      if (e instanceof SessionExpired) onExpired()
      else { setMessage('작업 리스트를 조회하지 못했습니다.'); prompt.current?.showModal() }
    } finally { controller.current=null; setLocked(false) }
  }

  async function submit(command:DeleteList) {
    if (controller.current) return
    const control=new AbortController()
    controller.current=control
    setLocked(true)
    prompt.current?.close()
    sessionStorage.setItem(storage,JSON.stringify(command));setPending(command);onPending(true)
    try {
      await drawingRequest(drawingApi+'/delete-listed',control.signal,command)
      sessionStorage.removeItem(storage);setPending(undefined);onPending(false);onDone()
    } catch (e) {
      if (e instanceof SessionExpired) onExpired()
      else if (e instanceof DrawingError) {
        sessionStorage.removeItem(storage);setPending(undefined);onPending(false)
        setMessage('작업 상태가 변경되었습니다. 작업 리스트를 확인하십시오.');setDraft(undefined);prompt.current?.showModal()
      }
    } finally { controller.current=null;setLocked(false) }
  }

  return <>
    <button type="button" className="drawing-delete" disabled={locked || (!pending && (disabled || !keys.length))}
      onClick={()=>pending?void submit(pending):void open()}>DELETE<br />{pending?'결과 재확인':'일괄삭제'}</button>
    <dialog className="floor-confirm" ref={prompt} aria-label={message}><p>{message}</p>
      {draft && <button onClick={()=>void submit(draft)}>예</button>}
      <button onClick={()=>prompt.current?.close()}>{draft?'아니오':'확인'}</button>
    </dialog>
  </>
}
