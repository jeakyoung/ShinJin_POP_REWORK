import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import SettingsPrompts from './SettingsPrompts'
import {useSettingsPrompt} from './settingsPrompt'
import './printerSettings.css'
import './preloginPrintInfo.css'

type Role='document'|'shipment'|'label'
type Outputs=Record<Role,string>
type Profile=Record<'ftpHost'|'ftpPort'|'imagePath'|'updatePath'|'version'|'dbHost'|'dbPort'|'database',string>
type Props={terminalId:string;kind:'printer'|'info';onClose:(changed:boolean)=>void}
type Data={revision:number;devices?:string[];outputs?:Outputs;profile?:Profile}
const roles:Role[]=['document','shipment','label']
const names:Record<Role,string>={document:'작업지시서 프린터',shipment:'거래명세서 프린터',label:'라벨 프린터'}
const asset=(name:string)=>import.meta.env.BASE_URL+'terminal-settings/'+name+'.png'

export default function PreloginPrintInfo(props:Props){
  return createPortal(<SettingsPrompts><Editor key={props.terminalId+props.kind} {...props}/></SettingsPrompts>,document.body)
}
function Editor({terminalId,kind,onClose}:Props){
  const ask=useSettingsPrompt(),dialog=useRef<HTMLDialogElement>(null)
  const op=useRef<AbortController|null>(null)
  const [data,setData]=useState<Data>(),[role,setRole]=useState<Role>()
  const [attempt,setAttempt]=useState(0),[message,setMessage]=useState(''),[busy,setBusy]=useState(true)
  const printer=kind==='printer', title=printer?'프린터 설정':'정보 확인'
  const path='/api/pop/prelogin-details/'+encodeURIComponent(terminalId)+'/'+kind
  useEffect(()=>{const el=dialog.current;el?.showModal();return ()=>el?.close()},[])
  useEffect(()=>{
    const control=new AbortController();op.current=control
    setBusy(true);setMessage('')
    void fetch(path,{cache:'no-store',signal:control.signal}).then(async r=>{
      if(!r.ok)throw Error()
      const found:Data=await r.json()
      if(!control.signal.aborted)setData(found)
    }).catch(()=>{if(!control.signal.aborted)setMessage('설정값을 조회하지 못했습니다.')})
      .finally(()=>{if(!control.signal.aborted){op.current=null;setBusy(false)}})
    return ()=>{control.abort();op.current?.abort()}
  },[path,attempt])
  async function save(){
    if(!data || busy || op.current)return
    if(printer){
      const missing=roles.find(r=>!data.devices?.includes(data.outputs?.[r]??''))
      if(missing){await ask(names[missing]+'가 선택되지 않았습니다.');return}
    }
    if(!await ask(printer?'프린트 설정을 저장 하시겠습니까?':'연결 정보를 저장 하시겠습니까?',true) || !dialog.current?.open)return
    if(op.current)return
    const control=new AbortController();op.current=control;setBusy(true)
    try{
      const result=await fetch(path,{method:'PUT',signal:control.signal,headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedVersion:data.revision,...(printer?{outputs:data.outputs}:{profile:data.profile})})})
      if(control.signal.aborted)return
      if(result.ok){onClose(true);return}
      if(result.status===409){setData(undefined);setMessage('설정이 변경되었습니다. 다시 조회하십시오.')}
      else setMessage('설정값을 저장하지 못했습니다. 입력 내용을 확인하십시오.')
    }catch{if(!control.signal.aborted){setData(undefined);setMessage('저장 결과를 확인하지 못했습니다. 다시 조회하십시오.')}}
    finally{if(!control.signal.aborted){op.current=null;setBusy(false)}}
  }
  const close=()=>{if(!busy || !data)onClose(false)}
  const header=<><img alt="" src={asset(printer?'printer-title':'info-title')}/>{printer?title:<h2>{title}</h2>}
    <button type="button" aria-label="닫기" disabled={busy&&!!data} onClick={close}><img alt="" src={asset('printer-close')}/></button></>
  const feedback=message&&<p role="alert" className="pre-profile-error">{message} {!data&&<button onClick={()=>setAttempt(n=>n+1)}>다시 조회</button>}</p>
  const footer=<footer><button type="button" disabled={busy||!data} onClick={()=>void save()}>저장</button>
    <button type="button" disabled={busy&&!!data} onClick={close}>취소</button></footer>
  const profile=data?.profile
  const field=(key:keyof Profile,label:string,unset=false)=><input aria-label={label} value={profile?.[key]??''}
    onChange={e=>{if(data&&profile)setData({...data,profile:{...profile,[key]:e.target.value}})}}
    maxLength={63} spellCheck={false} autoComplete="off" disabled={busy} placeholder={unset?'NONE':''}/>
  return <section className="settings-home"><dialog aria-label={title} ref={dialog}
    className={printer?'settings-dialog printer-dialog':'prelogin-info pre-info-editor'} onCancel={e=>{e.preventDefault();close()}}>
    {printer?<><h2>{header}</h2><fieldset disabled={busy}>
      <p className="printer-instruction">* 아래 프린터 종류를 터치하고 프린터 목록의 내용을 선택하십시오.</p>
      <div className="printer-roles">{roles.map(key=><div key={key}><span>{names[key]}</span><button type="button"
        aria-label={names[key]} aria-pressed={role===key} onClick={()=>{setRole(key)
          Array.from(dialog.current?.querySelectorAll<HTMLElement>('tr[data-device]')??[]).find(el=>el.dataset.device===data?.outputs?.[key])?.scrollIntoView({block:'nearest'})}}>
        <strong>{data?.outputs?.[key]??'NONE'}</strong></button></div>)}</div>
      <div className="printer-list"><table aria-label="프린터 장치 목록"><thead><tr><th>순번</th><th>프린터 장치 이름</th></tr></thead>
        <tbody>{data?.devices?.map((id,i)=><tr key={id} data-device={id} aria-current={!!role&&data.outputs?.[role]===id}
          onClick={()=>{if(busy||!data.outputs)return
            if(!role){void ask('일반 및 라벨 프린터를 터치해 주세요.');return}
            setData({...data,outputs:{...data.outputs,[role]:id}})}}>
          <td>{i+1}</td><td><button type="button">{id}</button></td></tr>)}</tbody></table></div></fieldset></>:<>
      <header>{header}</header><div className="pre-info-body">
        {profile&&(!profile.ftpHost||!profile.dbHost)&&<p role="status">* 연결 정보 ERROR. 관리자에게 문의하십시오.</p>}
        <table className="pre-ftp" aria-label="FTP"><tbody><tr><th rowSpan={3}>FTP</th><th>주소</th><td><div className="pre-info-address">
          {field('ftpHost','FTP 주소',true)}<span>,</span>{field('ftpPort','FTP 포트')}</div></td></tr>
          <tr><th>이미지 경로</th><td>{field('imagePath','이미지 경로',!profile?.ftpHost)}</td></tr>
          <tr><th>파일 경로</th><td>{field('updatePath','파일 경로',!profile?.ftpHost)}</td></tr></tbody></table>
        <table className="pre-db" aria-label="DB"><tbody><tr><th rowSpan={2}>DB</th><th>주소</th><td><div className="pre-info-address">
          {field('dbHost','DB 주소',true)}<span>,</span>{field('dbPort','DB 포트')}</div></td></tr>
          <tr><th>DB명</th><td>{field('database','DB명',!profile?.dbHost)}</td></tr></tbody></table>
        <table className="pre-version" aria-label="버전"><tbody><tr><th>버전</th><td>{field('version','FTP 프로필 버전',!profile?.ftpHost)}</td></tr></tbody></table>
      </div></>}
    {feedback}{footer}
  </dialog></section>
}
