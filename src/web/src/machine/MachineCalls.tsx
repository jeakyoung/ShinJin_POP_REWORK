import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import MachineReplacements from './MachineReplacements'
import MachineStatusFace from './MachineStatusFace'
import './machineCalls.css'

type Named = { id: string; name: string }
type Equipment = Named & { openCount: number }
type Issue = { id: string; openedBy: Named; openedAt: string; reason: Named; closedBy: Named | null; closedAt: string | null; action: Named | null }
type Detail = { machine: Named; issues: Issue[]; callReasons: Named[]; actions: Named[] }
type Mode = 'call' | 'action'
type Confirm = { mode: Mode; key: string; reasons: string[]; issue: string; token?: string }
const base = '/api/demo/machine-calls'

function Dialog({ name, close, children, kind = '' }: { name: string; close: () => void; children: ReactNode; kind?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const d = ref.current!; d.showModal(); return () => d.close() }, [])
  return <dialog className={'mc-dialog ' + kind} ref={ref} aria-label={name} onCancel={e => { e.preventDefault(); close() }}>{children}</dialog>
}

export default function MachineCalls({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [machines,setMachines] = useState<Equipment[]>([])
  const [machine,setMachine] = useState('')
  const [notice,setNotice] = useState('')
  const [revision,refresh] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    fetch(base,{signal:abort.signal,cache:'no-store'}).then(async r => {
      if (r.status===401) { onSessionExpired(); return }
      if (!r.ok) throw new Error()
      const data = await r.json()
      if (!abort.signal.aborted) setMachines(data)
    }).catch(()=>{if (!abort.signal.aborted) setNotice('설비 목록을 조회하지 못했습니다.')})
    return () => abort.abort()
  },[revision,onSessionExpired])
  return <div className="mc-module">
    <nav aria-label="단말 설비">{machines.map(m=><button key={m.id} aria-pressed={machine===m.id}
      onClick={()=>setMachine(old=>old===m.id?'':m.id)}>{m.name} <span className={m.openCount?'mc-open':''}>({m.openCount})</span></button>)}</nav>
    {notice && <p role="alert">{notice}</p>}
    {machine && <MachinePanel key={machine} machine={machine} expired={onSessionExpired}
      onChange={()=>refresh(n=>n+1)} onClose={()=>setMachine('')} />}
  </div>
}

function MachinePanel({machine,expired,onChange,onClose}:{machine:string;expired:()=>void;onChange:()=>void;onClose:()=>void}) {
  const [data,setData]=useState<Detail>()
  const [replacementVisit,setReplacementVisit] = useState(0)
  const replacing = replacementVisit > 0
  const [focused,focus]=useState('')
  const [mode,setMode]=useState<Mode>()
  const [reasons,setReasons]=useState<string[]>([])
  const [scan,setScan]=useState(false)
  const [number,setNumber]=useState('')
  const [confirm,setConfirm]=useState<Confirm>()
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const lock=useRef(false)
  const lifetime=useRef<AbortController | null>(null)
  const scanToken=useRef('')
  const scanInput=useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (scan && !notice) scanInput.current?.focus()
  }, [scan, notice])
  const prefix=base+'/'+encodeURIComponent(machine)
  const request=useCallback(async(path:string,body?:unknown)=>{
    const signal=lifetime.current!.signal
    const r=await fetch(path,{signal,method:body===undefined?'GET':'POST',cache:'no-store',
      headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
    if(r.status===401 && !signal.aborted) expired()
    if(!r.ok) throw new Error(String(r.status))
    return r.json()
  },[expired])
  const load=useCallback(async()=>{
    const value:Detail=await request(prefix)
    if(lifetime.current?.signal.aborted)return
    setData(value); focus(old=>value.issues.some(i=>i.id===old)?old:value.issues[0]?.id??'')
  },[prefix,request])
  function releaseScan() {
    const token=scanToken.current
    scanToken.current=''
    if(token) void fetch(base+'/scans/'+token,{method:'DELETE',keepalive:true}).catch(()=>{})
  }
  useEffect(()=>{
    const controller=new AbortController(); lifetime.current=controller
    void load().catch(()=>{if(!controller.signal.aborted)setNotice('설비 호출내역을 조회하지 못했습니다.')})
    return ()=>{controller.abort();releaseScan()}
  },[load])
  async function perform(fn:()=>Promise<void>, refreshClosedIssue=false) {
    if(lock.current)return
    lock.current=true;setBusy(true)
    try {await fn()} catch(e){
      if(lifetime.current?.signal.aborted || (e as Error).message==='401')return
      if(refreshClosedIssue && (e as Error).message==='409'){
        releaseScan();setScan(false);setConfirm(undefined);setMode(undefined);onChange()
        try { await load();setNotice('조치가 완료 된 호출은 처리 할 수 없습니다.') }
        catch { if(!lifetime.current?.signal.aborted)setNotice('설비 호출내역을 다시 조회하십시오.') }
      } else setNotice('요청 결과를 확인하지 못했습니다.')
    } finally {lock.current=false;if(!lifetime.current?.signal.aborted)setBusy(false)}
  }
  useEffect(()=>{
    if(!notice)return
    const timer=window.setTimeout(()=>setNotice(''),2000)
    return ()=>window.clearTimeout(timer)
  },[notice])
  const selected=data?.issues.find(i=>i.id===focused)
  function choose(m:Mode) {
    if(!data)return
    if(m==='action' && (!selected || selected.closedAt)) {
      if (selected) setNotice('조치가 완료 된 호출은 처리 할 수 없습니다.');return
    }
    setReasons(m==='action' && data.actions.length ? [data.actions[0].id] : []);setMode(m)
  }
  function register() {
    if(!mode || !reasons.length){setNotice(mode==='action'?'조치 내용을 선택 해주세요.':'이슈 내용을 선택 해주세요.');return}
    if(mode==='action'){setNumber('');setScan(true);return}
    setConfirm({mode,key:crypto.randomUUID(),reasons,issue:''})
  }
  function verifyScan(e:React.FormEvent) {
    e.preventDefault()
    void perform(async()=>{
      try {
        const approval=await request(prefix+'/issues/'+encodeURIComponent(focused)+'/scan',{action:reasons[0],employeeNo:number})
        if(lifetime.current?.signal.aborted)return
        scanToken.current=approval.token;setScan(false)
        setConfirm({mode:'action',key:crypto.randomUUID(),reasons,issue:focused,token:approval.token})
      } catch(e){if((e as Error).message!=='400')throw e;setNotice('유효하지 않은 사번입니다.')}
    },true)
  }
  function dismissConfirm(){if(busy)return;releaseScan();setConfirm(undefined)}
  function submit(){
    if(!confirm)return
    void perform(async()=>{
      if(confirm.mode==='call') await request(prefix+'/issues',{key:confirm.key,reasons:confirm.reasons})
      else await request(prefix+'/issues/'+encodeURIComponent(confirm.issue)+'/close',{key:confirm.key,token:confirm.token})
      if(lifetime.current?.signal.aborted)return
      scanToken.current='';setConfirm(undefined);setMode(undefined)
      setNotice(confirm.mode==='call'?'호출 요청 되었습니다.':'조치가 완료되었습니다.');onChange();await load()
    },confirm.mode==='action')
  }
  const title=mode==='call'?'이슈발생 호출사유':'이슈발생 조치내용'
  return <section className="mc-panel" aria-label="설비 호출내역">
    <MachineStatusFace />
    <strong className="mc-title">{data?.machine.name}</strong>
    {replacing ? <MachineReplacements key={replacementVisit} machine={machine} expired={expired}/> : <><div className="mc-panel-actions">{(['call','action'] as const).map(m=><div key={m} style={{backgroundImage:"url("+import.meta.env.BASE_URL+"machine-calls/Container_00-1.png)"}}>
      <span>{m==='call'?'호출':'조치자'}</span><button aria-label={m==='call'?'호출':'조치자'} onClick={()=>choose(m)}>
        <img alt="" src={import.meta.env.BASE_URL+'machine-calls/'+(m==='call'?'call_hover':'action_hover')+'.png'} /></button></div>)}</div>
    <div className="mc-issues"><table><colgroup>
      {[61,99,100,181,102,49,124,213,133,124].map((width,index)=><col key={index} style={{width:(width/1186*100)+'%'}} />)}
    </colgroup><thead><tr>{['선택','설비명','이슈 번호','이슈 내용','이슈 발생자','경과 시간','이슈 발생일시','이슈 해결내용','이슈 해결자','이슈 해결일시'].map(h=><th key={h}>{h.replace(' ', '\n')}</th>)}</tr></thead>
      <tbody>{data?.issues.map(i=><tr key={i.id} className={i.closedAt?'':'mc-unresolved'} aria-selected={focused===i.id} onClick={()=>focus(i.id)}>
        <td><input aria-label={i.id+' 선택'} type="checkbox" checked={focused===i.id} onChange={()=>focus(i.id)} /></td>
        <td>{data.machine.name}</td><td>{i.id}</td><td>{i.reason.name}</td><td>{i.openedBy.name}</td><td></td><td>{i.openedAt}</td>
        <td>{i.action?.name}</td><td>{i.closedBy?.name}</td><td>{i.closedAt}</td></tr>)}</tbody></table></div>
    </>}
    <footer><button aria-pressed={!replacing} onClick={()=>{setReplacementVisit(0);void perform(load)}}>설비 호출내역</button>
      <button className="mc-replacing-tab" aria-pressed={replacing} onClick={()=>setReplacementVisit(n=>n+1)}>소모품 교체</button><button onClick={onClose}>닫기</button></footer>
    {mode && <Dialog name={title} kind="mc-reasons" close={()=>{if(!busy)setMode(undefined)}}><header>{title}</header>
      <div><table><thead><tr><th>선택</th><th>이슈코드</th><th>이슈내용</th></tr></thead><tbody>
        {(mode==='call'?data?.callReasons:data?.actions)?.map(v=><tr key={v.id} onClick={()=>setReasons(old=>mode==='action'?[v.id]:old.includes(v.id)?old.filter(x=>x!==v.id):[...old,v.id])}>
          <td><input aria-label={v.name} type="checkbox" checked={reasons.includes(v.id)} onChange={()=>{}} /></td><td>{v.id}</td><td>{v.name}</td></tr>)}
      </tbody></table></div><footer><button disabled={busy} onClick={register}>등록</button><button onClick={()=>setMode(undefined)}>닫기</button></footer>
    </Dialog>}
    {scan && <Dialog name="담당자 스캔" kind="mc-scan" close={()=>{if(!busy)setScan(false)}}><form onSubmit={verifyScan}>
      <label>사원번호를 스캔하십시오.<input ref={scanInput} autoFocus value={number} onChange={e=>setNumber(e.target.value)} /></label>
      <button type="button" disabled={busy} onClick={()=>setScan(false)}>닫기</button></form></Dialog>}
    {confirm && <Dialog name="확인" kind="mc-message" close={dismissConfirm}><p>{confirm.mode==='call'?'선택한 이슈로 호출 하시겠습니까?':'선택한 내용으로 조치 하셨습니까?'}</p>
      <button disabled={busy} onClick={submit}>예</button><button disabled={busy} onClick={dismissConfirm}>아니오</button></Dialog>}
    {notice && <Dialog name="알림" kind="mc-message" close={()=>setNotice('')}><p>{notice}</p><button onClick={()=>setNotice('')}>확인</button></Dialog>}
  </section>
}
