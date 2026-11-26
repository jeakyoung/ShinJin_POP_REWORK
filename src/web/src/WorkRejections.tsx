import {useEffect,useRef,useState} from 'react'
import {Choice,Pop} from './ProcessPlanFields'
import {ProductionError,pendingCommand,productionRequest} from './productionApi'
import type {DefectsCommand,DefectsView} from './productionApi'
import {SessionExpired} from './workHistoryApi'
import './WorkRejections.css'

export default function WorkRejections({path,actor,onClose,onSaved,onExpired,onError}:{path:string;actor:string;onClose:()=>void;onSaved:(saved:DefectsView)=>void;onExpired:()=>void;onError:(text:string)=>void}){
  const key='process-rejections:'+actor+':'+path
  const [data,setData]=useState<DefectsView>(),[warehouse,setWarehouse]=useState(''),[location,setLocation]=useState('')
  const [quantities,setQuantities]=useState<Record<string,number>>({}),[confirm,setConfirm]=useState(false),[message,setMessage]=useState('')
  const [pending,setPending]=useState(()=>pendingCommand<DefectsCommand>(key)),[busy,setBusy]=useState(false)
  const token=useRef({active:true}),callbacks=useRef({onError,onExpired})
  useEffect(()=>{callbacks.current={onError,onExpired}},[onError,onExpired])
  function fill(v:DefectsView){
    setData(v);const w=v.saved.warehouse??v.warehouses[0]??'';setWarehouse(w);setLocation(v.saved.location??v.locations[w]?.[0]??'')
    setQuantities(Object.fromEntries(v.saved.lines.map(line=>[line.code,line.quantity])))
  }
  useEffect(()=>{
    const mounted={active:true};token.current=mounted;const ctl=new AbortController()
    void productionRequest<DefectsView>(path,undefined,undefined,ctl.signal).then(fill).catch(e=>{
      if(!mounted.active)return
      if(e instanceof SessionExpired)callbacks.current.onExpired();else callbacks.current.onError(e.message)
    })
    return()=>{mounted.active=false;ctl.abort()}
  },[path])
  async function save(){
    if(!data||busy)return
    const mounted=token.current
    const cmd=pending??{requestId:crypto.randomUUID(),revision:data.revision,warehouse,location,lines:data.reasons.map(r=>({code:r.code,quantity:quantities[r.code]??0}))}
    sessionStorage.setItem(key,JSON.stringify(cmd));setPending(cmd);setBusy(true);setConfirm(false)
    try{
      const saved=await productionRequest<DefectsView>(path,cmd)
      sessionStorage.removeItem(key)
      if(mounted.active){setPending(undefined);onSaved(saved)}
    }catch(e){
      if(!mounted.active)return
      if(e instanceof SessionExpired){onExpired();return}
      if(e instanceof ProductionError && [400,403,404,409,422].includes(e.status)){
        sessionStorage.removeItem(key);setPending(undefined)
        try{const next=await productionRequest<DefectsView>(path);if(mounted.active)fill(next)}catch{onError(e.message);return}
      }
      if(mounted.active)setMessage(e instanceof ProductionError?e.message:'요청 결과를 확인할 수 없습니다. 동일 명령으로 다시 시도하십시오.')
    }finally{if(mounted.active)setBusy(false)}
  }
  return <Pop label="불량 정보" kind="production-defects" onClose={()=>{if(!busy)onClose()}}>
    {data && <><fieldset disabled={busy||!!pending}><div className="defect-selectors">
      <Choice label="불량 창고" options={data.warehouses} value={warehouse} onChange={w=>{setWarehouse(w);setLocation(data.locations[w]?.[0]??'')}}/>
      <Choice label="불량 로케이션" options={data.locations[warehouse]??[]} value={location} onChange={setLocation}/></div>
      <div className="rev-grid"><table aria-label="불량 정보"><thead><tr><th>불량코드</th><th>불량명</th><th colSpan={3}>불량수량</th></tr></thead>
        <tbody>{data.reasons.map(({code,name})=><tr key={code}><td>{code}</td><td>{name}</td><td><button type="button" aria-label={name+' 빼기'} onClick={()=>setQuantities({...quantities,[code]:Math.max(0,(quantities[code]??0)-1)})}>−</button></td><td>{quantities[code]??0}</td>
          <td><button type="button" aria-label={name+' 더하기'} onClick={()=>setQuantities({...quantities,[code]:(quantities[code]??0)+1})}>＋</button></td></tr>)}</tbody></table></div></fieldset>
      <footer>{pending?<button type="button" disabled={busy} onClick={()=>void save()}>동일 명령 재시도</button>:
        <button type="button" onClick={()=>{if(!warehouse||!location)setMessage(!warehouse?'창고를 입력하십시오.':'로케이션을 입력하십시오.');else setConfirm(true)}}>적용</button>}
        <button type="button" disabled={busy} onClick={onClose}>닫기</button></footer></>}
      {(message||confirm) && <Pop label="확인" kind="rev-prompt" onClose={()=>{setMessage('');setConfirm(false)}}><p>{message||'불량 정보를 적용 하시겠습니까?'}</p><footer>
        {confirm && <button type="button" onClick={()=>void save()}>예</button>}<button type="button" onClick={()=>{setMessage('');setConfirm(false)}}>{confirm?'아니오':'확인'}</button></footer></Pop>}
  </Pop>
}
