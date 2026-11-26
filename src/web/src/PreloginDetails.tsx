import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import SettingsPrompts from './SettingsPrompts'
import { useSettingsPrompt } from './settingsPrompt'
import WarehouseDialog from './WarehouseDialog'
import { MaterialRows, ProcessRows, ProcessSlots, type SettingRow } from './ProcessMaterialFields'
import './terminalSettings.css'
import './settingsDesigner.css'

export type PreloginDetailSection = 'process' | 'material' | 'warehouse'
type Props = { terminalId: string; kind: PreloginDetailSection; onClose: (changed: boolean) => void }
type View = { plant: string; center: string; version: number; groupCenter: boolean; rows: SettingRow[]; slots: Record<number,string>; materials: string[] }
const failures: Record<string,string> = {
  PLANT_REQUIRED:'공장 설정을 진행하십시오.', PROCESS_REQUIRED:'공정 설정을 진행하십시오.', MACHINE_REQUIRED:'설비 설정을 진행하십시오.',
  STALE_SETTINGS:'설정이 변경되었습니다. 다시 조회하십시오.', TERMINAL_SCOPE:'선택한 단말을 다시 확인하십시오.',
  MASTER_UNAVAILABLE:'설정 목록을 불러올 수 없습니다.',
}

export default function PreloginDetails(props: Props) {
  return createPortal(<SettingsPrompts key={JSON.stringify([props.terminalId,props.kind])}><Details {...props}/></SettingsPrompts>, document.body)
}

function Details({ terminalId, kind: section, onClose }: Props) {
  const prompt = useSettingsPrompt()
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController | null>(null)
  const changed = useRef(false)
  const [draft,setDraft] = useState<View>()
  const [busy,setBusy] = useState(true)
  const [attempt,setAttempt] = useState(0)
  const [notice,setNotice] = useState('')
  const [blocked,setBlocked] = useState('')
  const [active,setActive] = useState(0)
  const [pressed,setPressed] = useState(0)
  const [focus,setFocus] = useState('')
  const endpoint = '/api/pop/prelogin-details/'+encodeURIComponent(terminalId)
  const process = section==='process'
  const title = process?'공정 설정':'재질 설정'
  const visible = section!=='warehouse' && !blocked && (!!draft || !!notice)
  useEffect(()=>{
    if (!visible) return
    const box=dialog.current
    box?.showModal()
    return ()=>box?.close()
  },[visible])
  useEffect(()=>{
    const ctrl=new AbortController()
    request.current=ctrl
    fetch(endpoint+'/'+section,{signal:ctrl.signal,cache:'no-store'}).then(async response=>{
      const data=await response.json()
      if (ctrl.signal.aborted) return
      if (!response.ok) {
        if (['PLANT_REQUIRED','PROCESS_REQUIRED','MACHINE_REQUIRED','TERMINAL_SCOPE'].includes(data.code)) {
          setBlocked(failures[data.code]);return
        }
        throw Error(failures[data.code] ?? '설정 목록을 불러올 수 없습니다.')
      }
      setDraft(data)
    }).catch(error=>{if (!ctrl.signal.aborted) setNotice(error.message)})
      .finally(()=>{if (!ctrl.signal.aborted) { request.current=null;setBusy(false) }})
    return ()=>{ctrl.abort();request.current?.abort()}
  },[endpoint,section,attempt])
  useEffect(()=>{
    const message=blocked || (section==='warehouse' ? notice : '')
    if (message) {
      let active=true
      void prompt(message).then(()=>{if (active) onClose(false)})
      return ()=>{active=false}
    }
  },[section,notice,blocked,prompt,onClose])
  if (section==='warehouse') return !draft ? null : <WarehouseDialog url={endpoint} onSelectionSaved={()=>{changed.current=true}}
    onExpired={()=>onClose(changed.current)} onClose={saved=>onClose(!!saved || changed.current)}/>
  async function save() {
    if (!draft || request.current) return
    if (process && !Object.values(draft.slots).some(Boolean)) {await prompt('작업 유형들을 설정하십시오.');return}
    if (!process && !draft.materials.length) {await prompt('사용할 재질을 선택하여주십시오.');return}
    if (!await prompt(process?'공정 설정을 저장 하시겠습니까?':'사용할 재질을 저장 하시겠습니까?',true)) return
    if (!dialog.current?.open || request.current) return
    const ctrl=new AbortController()
    request.current=ctrl;setBusy(true);setNotice('')
    try {
      const response=await fetch(endpoint+'/'+section,{method:'PUT',signal:ctrl.signal,headers:{'Content-Type':'application/json'},
        body:JSON.stringify({plant:draft.plant,center:draft.center,expectedVersion:draft.version,
          ...(process?{slots:draft.slots}:{materials:draft.materials})})})
      if (ctrl.signal.aborted) return
      if (response.ok) {onClose(true);return}
      const result=await response.json()
      if (ctrl.signal.aborted) return
      if (response.status===409 || response.status===403 || response.status===422) setDraft(undefined)
      setNotice(failures[result.code] ?? '설정을 저장할 수 없습니다.')
    } catch {if (!ctrl.signal.aborted) {setDraft(undefined);setNotice('저장 결과를 확인하지 못했습니다. 다시 조회하십시오.')}}
    finally {if (!ctrl.signal.aborted) {request.current=null;setBusy(false)}}
  }
  const close=()=>{if (!busy || !draft) onClose(false)}
  if (!visible) return null
  return <section className="settings-home"><dialog ref={dialog} className={'settings-dialog '+(process?'settings-slot':'settings-material')}
    aria-labelledby="prelogin-detail-title" onCancel={e=>{e.preventDefault();close()}}>
    <h2 id="prelogin-detail-title"><img alt="" src={import.meta.env.BASE_URL+'terminal-settings/'+(process?'group-process-title':'material-title')+'.png'}/>
      <span className="settings-caption">{title}</span><button type="button" aria-label="닫기" onClick={close}><img alt="" src={import.meta.env.BASE_URL+'terminal-settings/printer-close.png'}/></button></h2>
    {draft && <>{process && <ProcessSlots group={draft.groupCenter} slots={draft.slots} pressed={pressed} locked={busy} choose={slot=>{
      if (pressed===slot) {const next={...draft.slots};delete next[slot];setDraft({...draft,slots:next});setPressed(0)}
      else {setActive(slot);setPressed(slot);dialog.current?.querySelector('tr[data-code="'+CSS.escape(draft.slots[slot] ?? '')+'"]')?.scrollIntoView({block:'nearest'})}
    }}/>}<fieldset disabled={busy}>{process?<ProcessRows rows={draft.rows} selected={draft.slots[active]} choose={code=>{
      if (!active) {void prompt('상단 작업 유형을 터치해 주세요.');return}
      setDraft({...draft,slots:{...draft.slots,[active]:code}})
    }}/>:<MaterialRows rows={draft.rows} selected={draft.materials} focus={focus} onFocus={setFocus} onChange={materials=>setDraft({...draft,materials})}/>}</fieldset></>}
    {notice && <p role="alert">{notice} <button type="button" onClick={()=>{setBusy(true);setNotice('');setDraft(undefined);setActive(0);setPressed(0);setFocus('');setAttempt(i=>i+1)}}>다시 조회</button></p>}
    <footer><button type="button" disabled={busy || !draft} onClick={()=>void save()}>저장</button><button type="button" disabled={busy && !!draft} onClick={close}>취소</button></footer>
  </dialog></section>
}