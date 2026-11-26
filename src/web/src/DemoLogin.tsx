import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import TouchField from './TouchField'
import { signIn } from './workHistoryApi'
import type { Identity } from './workHistoryApi'
import lock from './login-assets/lock.png'
import logo from './login-assets/logo.png'
import settings from './login-assets/settings.png'
import settingsClick from './login-assets/settings-click.png'
import settingsNot from './login-assets/settings-not.png'
import PreloginSettings, { type PreloginStatus } from './PreloginSettings'
import TransferMessage from './TransferMessage'
import './DemoLogin.css'

const chosenTerminal = 'pop.login.terminal'
function storedTerminal() {
  try { return localStorage.getItem(chosenTerminal) } catch { return null }
}
async function readStatus(id?:string|null,signal?:AbortSignal) {
  const response=await fetch('/api/pop/prelogin-settings'+(id?'?terminalId='+encodeURIComponent(id):''),{signal,cache:'no-store'})
  if (!response.ok) throw new Error(String(response.status))
  return await response.json() as PreloginStatus
}

export default function DemoLogin({ returning, onLogin }: { returning: boolean; onLogin: (identity: Identity) => void }) {
  const selectedTerminal=useRef(storedTerminal())
  const [status,setStatus] = useState<PreloginStatus>()
  const [config,setConfig] = useState(false)
  const [attempt,setAttempt] = useState(0)
  const [loadFailed,setLoadFailed] = useState(false)
  const terminalId = status?.terminalId
  const [identifier, setIdentifier] = useState('')
  const [passcode, setPasscode] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<{ method: 'manual' | 'scan'; message: string }>()
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const touched = useRef(false)
  const scanner = useRef<HTMLDialogElement>(null)
  const gear = useRef<HTMLButtonElement>(null)
  const scanInput = useRef<HTMLInputElement>(null)
  const manualForm = useRef<HTMLFormElement>(null)
  const loginButton = useRef<HTMLButtonElement>(null)

  function openScanner() {
    const element = scanner.current
    if (!element || element.open) return
    element.showModal()
  }

  useEffect(() => {
    const request = new AbortController()
    const remembered=selectedTerminal.current
    readStatus(remembered,request.signal).catch((error:unknown)=>{
      if (remembered && error instanceof Error && error.message==='404') {selectedTerminal.current=null;return readStatus(null,request.signal)}
      throw error
    }).then(data=>{
      if (!request.signal.aborted && (!selectedTerminal.current || selectedTerminal.current===data.terminalId)) {setStatus(data);setLoadFailed(false)}
    }).catch(()=>{if (!request.signal.aborted) setLoadFailed(true)})
    return ()=>request.abort()
  },[attempt])
  useEffect(() => {
    if (returning) { manualForm.current?.querySelector<HTMLInputElement>('#login-employee')?.focus(); return }
    const timer = window.setTimeout(() => {
      if (!touched.current) openScanner()
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [returning])

  async function submit(event: FormEvent<HTMLFormElement>, method: 'manual' | 'scan') {
    event.preventDefault()
    if (busy.current || !terminalId) return
    if (!status?.ready) { setError({method,message:'환경설정을 확인하십시오.'}); return }
    if (method === 'manual' && (!identifier || !passcode)) {
      setError({method,message:identifier?'비밀번호를 입력하십시오.':'사원번호를 입력하십시오.'})
      return
    }
    busy.current = true
    setPending(true)
    setError(undefined)
    try {
      const identity = await signIn({ terminalId, method, identifier: method === 'scan' ? code : identifier,
        passcode: method === 'scan' ? '' : passcode })
      onLogin(identity)
    } catch (cause) {
      if (method === 'scan') setCode('')
      setError({ method, message: cause instanceof Error && cause.message === 'HTTP 409' ? '환경설정을 확인하십시오.' : '로그인 정보를 확인하십시오.' })
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return <section className="login-panel" aria-labelledby="login-title"
    onPointerDownCapture={() => { touched.current = true }} onKeyDownCapture={() => { touched.current = true }}>
    <header className="login-bar">
      <img className="login-lock" src={lock} alt="" /><h1 id="login-title">로그인</h1>
    <button ref={gear} className="login-settings" type="button" aria-label="설정" disabled={pending}
      onClick={() => { touched.current=true;setError(undefined);setConfig(true);if(!status)setAttempt(n=>n+1) }}><img src={config ? settingsClick : status && !status.ready ? settingsNot : settings} alt="" /></button>
    </header>
    <div className="login-body">
      <div className="login-brand"><img className="login-logo" src={logo} alt="" />
        <div><div className="login-wordmark" aria-hidden="true">LOG IN</div>
    <p className="login-company">(주)신진에스엠 Smart POP시스템</p></div>
      </div>
    <form noValidate ref={manualForm} className="login-manual" onFocus={() => { touched.current = true }} onSubmit={event => void submit(event, 'manual')}>
      <TouchField id="login-employee" label="사원번호" value={identifier} onValueChange={setIdentifier} required editableKeypad
        readOnly={pending} autoComplete="off" maxLength={64} onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            const field = event.currentTarget.form?.querySelector<HTMLInputElement>('input[type=password]')
            field?.focus()
            field?.select()
          }
        }} />
      <TouchField label="비밀번호" type="password" value={passcode} onValueChange={setPasscode} required editableKeypad
        readOnly={pending} autoComplete="off" maxLength={64} onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            loginButton.current?.focus()
          }
        }} />
      <button ref={loginButton} className="login-submit" disabled={pending || !terminalId}>로그인</button>
    </form>
    <button className="login-scan" type="button" disabled={pending || !terminalId}
      onClick={() => { setError(undefined); openScanner() }}>스캔으로 로그인하기</button>
    {loadFailed && <p className="login-error" role="alert">설정을 불러오지 못했습니다. <button type="button" onClick={()=>setAttempt(n=>n+1)}>다시 시도</button></p>}
    {config && !status && !loadFailed && <p className="login-error" role="status">설정을 불러오는 중입니다.</p>}
    </div>
    <footer>Copyright@F1soft Corp. All Rights Reserved.</footer>

    <dialog className="scan-login" ref={scanner} aria-label="사원번호를 스캔하십시오."
      onCancel={event => { if (busy.current) event.preventDefault() }}
      onClose={() => { setCode(''); setError(undefined); manualForm.current?.querySelector<HTMLInputElement>('#login-employee')?.focus() }}>
      <form onSubmit={event=>void submit(event,'scan')}>
        <label htmlFor="scan-employee">사원번호를 스캔하십시오.</label>
        <input id="scan-employee" ref={scanInput} autoFocus value={code} readOnly={pending} autoComplete="off"
          maxLength={64} onChange={event=>setCode(event.target.value)}
          onPaste={event => {
            if (busy.current) return
            const input = event.currentTarget
            const pasted = event.clipboardData.getData('text/plain').replace(/[\r\n]/g, '')
            if (!pasted) return
            event.preventDefault()
            const start = input.selectionStart ?? input.value.length
            const end = input.selectionEnd ?? start
            const insert = pasted.slice(0, Math.max(0, input.maxLength - input.value.length + end - start))
            setCode(input.value.slice(0, start) + insert + input.value.slice(end))
            requestAnimationFrame(() => input.setSelectionRange(start + insert.length, start + insert.length))
          }} onKeyDown={event=>{
            if (event.key==='Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
          }} />
        <button type="button" disabled={pending} onClick={()=>scanner.current?.close()}>닫기</button>
      </form>
    </dialog>
    {config && status && <PreloginSettings status={status} select={async id=>{
      const next=await readStatus(id)
      selectedTerminal.current=id
      try {localStorage.setItem(chosenTerminal,id)} catch { /* Selection still applies to this login. */ }
      setStatus(next);setIdentifier('');setPasscode('');setCode('');setError(undefined)
    }} refresh={()=>setAttempt(n=>n+1)} close={()=>{
      setConfig(false); setAttempt(n=>n+1); gear.current?.focus()
    }}/>}
    {error && <div className="settings-message-scope"><TransferMessage message={{text:error.message}} close={()=>{
      const field = error.method==='scan' ? scanInput.current : manualForm.current?.querySelector<HTMLInputElement>(
        error.message==='비밀번호를 입력하십시오.' ? 'input[type=password]' : '#login-employee')
      setError(undefined); field?.focus()
    }}/></div>}
  </section>
}
