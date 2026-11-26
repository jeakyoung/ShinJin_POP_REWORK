import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import SettingsPrompts from './SettingsPrompts'
import { InventoryMessage } from './InventoryDialogs'
import SiteSettingsDialog from './SiteSettingsDialog'
import EquipmentDialog from './EquipmentSettings'
import type { View } from './equipmentSettingsApi'

type Props = {terminalId:string;kind:'plant'|'machine'|'popId';onClose:(changed:boolean)=>void}
function Details({terminalId,kind,onClose}:Props) {
  const url='/api/pop/prelogin-site-equipment/'+encodeURIComponent(terminalId)+'/'+kind
  const [view,setView]=useState<View>()
  const [failed,setFailed]=useState(false)
  const close=useCallback((changed=false)=>onClose(changed),[onClose])
  const expired=useCallback(()=>setFailed(true),[])
  useEffect(()=>{
    if (kind!=='machine') return
    const ctl=new AbortController()
    fetch(url+'/equipment',{cache:'no-store',signal:ctl.signal}).then(async r=>{
      if(!r.ok) throw Error()
      const data:View=await r.json()
      if(!ctl.signal.aborted)setView(data)
    }).catch(()=>{if(!ctl.signal.aborted)setFailed(true)})
    return ()=>ctl.abort()
  },[kind,url])
  if(failed)return <InventoryMessage text="설정을 불러올 수 없습니다." onClose={()=>close()}/>
  if(kind==='machine')return view?<EquipmentDialog terminal={terminalId} page="machines" url={url+'/equipment'}
    view={view} onView={setView} onExpired={expired} onClose={close}/>:null
  return <SiteSettingsDialog page={kind==='plant'?'plant':'pop-id'} terminal={terminalId} url={url} onClose={close} onExpired={expired}/>
}
export default function PreloginSiteEquipmentDialog(props:Props) {
  return createPortal(<SettingsPrompts><Details {...props}/></SettingsPrompts>,document.body)
}
