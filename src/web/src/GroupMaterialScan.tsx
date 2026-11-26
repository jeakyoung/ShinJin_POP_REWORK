import {useEffect,useRef,useState} from 'react'
import CommonScanDialog from './commonInput/CommonScanDialog'
import {InventoryDialog,InventoryMessage} from './InventoryDialogs'
import ProcessStockPicker from './processLot/ProcessStockPicker'
import {key,over,type Stock} from './processLot/processStockTypes'
import './processLot/processLot.css'

export type GroupPick={stock:Stock;quantity:number}
const path='/api/pop/process-group-demo/input-material'
const messages:Record<string,string>={
  WORK_LIST_REQUIRED:'작업 리스트를 스캔하여 주십시오.',
  FINISHED_WORK_ORDER:'작업완료된 건이 있으므로 자재투입 불가능합니다.',
  ISSUE_WAREHOUSE_REQUIRED:'투입창고가 설정되지 않았습니다. 환경설정을 확인하십시오.',
}
type Props={rows:GroupPick[];code?:string;onRows:(rows:GroupPick[])=>void;onClose:()=>void;onExpired:()=>void}
export default function GroupMaterialScan({rows,code,onRows,onClose,onExpired}:Props){
  const [ready,setReady]=useState(false)
  const [choices,setChoices]=useState<Stock[]>([])
  const [message,setMessage]=useState('')
  const found=useRef<Stock[]>([])
  const live=useRef<AbortController|null>(null)
  const headers:Record<string,string>=code?{'X-Pop-Work-Code':code}:{}

  async function read(response:Response){
    if(response.status===401){onExpired();throw Error('SESSION_EXPIRED')}
    const body=await response.json()
    if(!response.ok){throw Error(messages[body.code]??'자재 조회 오류')}
    return body
  }
  useEffect(()=>{
    const ctrl=new AbortController();live.current=ctrl
    void fetch(path,{signal:ctrl.signal,cache:'no-store'}).then(async r=>{
      if(r.status===401){onExpired();return}
      const body=await r.json()
      if(!ctrl.signal.aborted){if(r.ok)setReady(true);else setMessage(messages[body.code]??'자재 조회 오류')}
    }).catch(()=>{if(!ctrl.signal.aborted)setMessage('자재 조회 오류')})
    return ()=>ctrl.abort()
  },[onExpired])
  function merge(incoming:GroupPick[],single=false){
    const next=[...rows]
    for(const pick of incoming){
      const index=next.findIndex(row=>single?row.stock.lot===pick.stock.lot:key(row.stock)===key(pick.stock))
      const stock=single && index>=0?next[index].stock:pick.stock
      const quantity=(next[index]?.quantity??0)+pick.quantity
      if(quantity>stock.available){
        // The native location dialog has already copied preceding rows into its parent grid.
        if(pick!==incoming[0])onRows(next)
        return false
      }
      if(index<0)next.push({...pick,quantity});else next[index]={stock,quantity}
    }
    onRows(next)
    return true
  }
  function report(error:unknown){if(live.current && !live.current.signal.aborted && error instanceof Error && error.message!=='SESSION_EXPIRED')setMessage(error.message)}
  function dismiss(){setMessage('');if(!ready)onClose()}
  useEffect(()=>{
    if(!message)return
    const timer=window.setTimeout(()=>{setMessage('');if(!ready)onClose()},2000)
    return ()=>window.clearTimeout(timer)
  },[message,ready,onClose])
  return <>
    {ready && !choices.length && <CommonScanDialog mode="material" position={{left:70,top:270}}
      onEnter={async(raw,signal)=>{
        const stocks:Stock[]=await read(await fetch(path,{method:'POST',signal,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({raw})}))
        if(signal.aborted)return {next:'retry'}
        if(!stocks.length){setMessage('유효한 Lot No가 아닙니다. 다시 스캔하십시오.');return {next:'retry'}}
        if(stocks.length===1){if(!merge([{stock:stocks[0],quantity:1}],true))setMessage(over);return {next:'continue'}}
        found.current=stocks;return {next:'close',result:'ok'}
      }} onError={report} onClose={result=>{if(result==='ok')setChoices(found.current);else onClose()}}/>}
    {!!choices.length && <InventoryDialog label="투입자재 위치 선택" className="process-lot pl-select" onDismiss={onClose}>
      <ProcessStockPicker date="" sequence={0} source={{path,suffix:'',headers}} scanned={choices} onApply={merge}
        onClose={onClose} warn={async text=>setMessage(text)} onSessionExpired={onExpired}/>
    </InventoryDialog>}
    {message && <InventoryMessage text={message} onClose={dismiss}/>}
  </>
}
