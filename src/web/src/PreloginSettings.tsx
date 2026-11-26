import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import PreloginDetails from './PreloginDetails'
import PreloginPrintInfo from './PreloginPrintInfo'
import PreloginGroupSettings from './PreloginGroupSettings'
import PreloginSiteEquipmentDialog from './PreloginSiteEquipmentDialog'
import TransferMessage from './TransferMessage'
import './prelogin.css'

export type PreloginStatus = { terminalId: string; groupCenter: boolean; missing: string[]; ready: boolean; version: string; ftpAddressPresent: boolean; dbAddressPresent: boolean }
const asset = (name: string) => import.meta.env.BASE_URL + 'terminal-settings/' + name + '.png'
const tiles = [
  ['printer','프린트 설정','print','print-not'], ['plant','사업장&작업장','plant-in','plant-not'],
  ['process','공정 설정','process','process-not'], ['machine','설비 설정','machine-in','machine-not'],
  ['popId','POP ID 설정','pop-in','pop-not'], ['material','재질 설정','material','material-not'],
  ['warehouse','창고 설정','location','location-not'], ['info','정보 확인','info','info-not'],
  ['group','POP 그룹설정','group-in','group-not'], ['close','닫기','close','close'],
] as const
const prerequisites: Record<string,string[]> = {
  process:['plant'], machine:['plant','process'], material:['plant','process','machine'],
  warehouse:['plant'], popId:['plant','process'], group:['plant','process']
}
const names: Record<string,string> = { plant:'공장', process:'공정', machine:'설비' }


type TerminalChoice = {id:string;name:string}
function TerminalPicker({current,select,close}:{current:string;select:(id:string)=>Promise<void>;close:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null)
  const [choices,setChoices]=useState<TerminalChoice[]>([])
  const [draft,setDraft]=useState(current)
  const [busy,setBusy]=useState(false)
  const [failed,setFailed]=useState(false)
  const [attempt,setAttempt]=useState(0)
  useLayoutEffect(()=>{const el=dialog.current;el?.showModal();return ()=>el?.close()},[])
  useEffect(()=>{
    const controller=new AbortController()
    fetch('/api/pop/prelogin-settings/terminals',{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if(!response.ok) throw new Error()
      const rows:TerminalChoice[]=await response.json()
      if(!controller.signal.aborted){setChoices(rows);setFailed(false)}
    }).catch(()=>{if(!controller.signal.aborted) setFailed(true)})
    return ()=>controller.abort()
  },[attempt])
  async function apply() {
    if(busy || !choices.some(row=>row.id===draft))return
    setBusy(true);setFailed(false)
    try {await select(draft);close()} catch {setFailed(true);setBusy(false)}
  }
  return <dialog className="prelogin-picker" aria-label="단말 선택" ref={dialog}
    onCancel={e=>{e.preventDefault();if(!busy)close()}}>
    <h2>단말 선택</h2><p>현재 단말　{current}</p>
    <div role="radiogroup" aria-label="사용할 단말">{choices.map(row=><label key={row.id}>
      <input type="radio" name="prelogin-terminal" checked={draft===row.id} disabled={busy} onChange={()=>setDraft(row.id)}/>
      <span>{row.name}　{row.id}</span></label>)}</div>
    {failed && <p role="alert">단말 정보를 불러오지 못했습니다. <button onClick={()=>setAttempt(n=>n+1)}>다시 시도</button></p>}
    <div className="prelogin-picker-actions"><button disabled={busy} onClick={close}>취소</button>
      <button disabled={busy || !choices.some(row=>row.id===draft)} onClick={()=>void apply()}>확인</button></div>
  </dialog>
}
export default function PreloginSettings({ status, select, refresh, close }: { status: PreloginStatus; select:(id:string)=>Promise<void>; refresh: () => void; close: () => void }) {
  const [picking,setPicking]=useState(false)
  type Setting = Exclude<(typeof tiles)[number][0],'close'>
  const [detail,setDetail]=useState<Setting>()
  const dialog = useRef<HTMLDialogElement>(null)
  const [notice,setNotice] = useState('')
  useLayoutEffect(() => { const el=dialog.current; el?.showModal(); return () => el?.close() },[])
  function open(key:(typeof tiles)[number][0]) {
    if (key==='close') { close(); return }
    const missing = prerequisites[key]?.find(dep=>status.missing.includes(dep))
    if (missing) {setNotice(names[missing]+' 설정을 진행하십시오.');return}
    setDetail(key)
  }
  function closeDetail(changed:boolean) {setDetail(undefined);if(changed)refresh()}
  return <dialog className="prelogin-settings" aria-label="환경설정" ref={dialog} onCancel={e=>{if(e.target===e.currentTarget){e.preventDefault();close()}}}>
    <nav aria-label="설정 구획">{tiles.map(([key,label,on,off]) => {
      const unavailable = key==='group' && !status.groupCenter
      const unset = !unavailable && (key==='info' ? status.missing.includes('ftp') || status.missing.includes('db') : status.missing.includes(key))
      return <button key={key} type="button" data-setting={key} disabled={unavailable} className={unset?'unset':''}
        onClick={()=>open(key)}><img src={asset(unset?off:on)} alt=""/><span>{label}</span></button>
    })}</nav>
    <div className="prelogin-terminal"><span>현재 단말　<strong>{status.terminalId}</strong></span>
      <button type="button" onClick={()=>setPicking(true)}>단말 선택</button></div>
    {(detail==='process' || detail==='warehouse' || detail==='material') && <PreloginDetails terminalId={status.terminalId} kind={detail} onClose={closeDetail}/>}
    {(detail==='plant' || detail==='machine' || detail==='popId') && <PreloginSiteEquipmentDialog terminalId={status.terminalId} kind={detail} onClose={closeDetail}/>}
    {(detail==='printer' || detail==='info') && <PreloginPrintInfo terminalId={status.terminalId} kind={detail} onClose={closeDetail}/>}
    {detail==='group' && <PreloginGroupSettings terminalId={status.terminalId} onClose={closeDetail}/>}
    {picking && <TerminalPicker current={status.terminalId} select={select} close={()=>setPicking(false)} />}
    {notice && <div className="settings-message-scope"><TransferMessage message={{text:notice}} close={()=>setNotice('')}/></div>}
  </dialog>
}
