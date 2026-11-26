import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ProductionPlaceDialog from './ProductionPlaceDialog'
import type { PlaceWarehouse } from './ProductionPlaceDialog'
import { InventoryDialog, InventoryMessage } from './InventoryDialogs'
import { getSessionData, SessionExpired } from './workHistoryApi'
import { productionRequest } from './productionApi'

export type GoodPlace = {
  warehouse:string; warehouseName:string; location:string; locationName:string; workStatus:string; etc:string
}
type View = { warehouses:(PlaceWarehouse & {status:string;etc:string})[]; current:GoodPlace|null; revision:number }
type Props = {
  date:string; sequence:number; slot:number; draft?:GoodPlace; onClose:()=>void
  onApply:(place:GoodPlace)=>void; onExpired:()=>void
}

export default function GoodProductLocationDialog({date,sequence,slot,draft,onClose,onApply,onExpired}:Props) {
  const [view,setView] = useState<View>()
  const [error,setError] = useState(false)
  const submitting = useRef(false)
  const pending = useRef<AbortController | undefined>(undefined)
  const url = '/api/pop/work-orders/' + date + '/' + sequence + '/good-locations?slot=' + slot
  useEffect(() => {
    const request = new AbortController()
    void getSessionData<View>(url,request.signal).then(setView).catch(e => {
      if (request.signal.aborted) return
      if (e instanceof SessionExpired) onExpired()
      else setError(true)
    })
    return () => { request.abort(); pending.current?.abort() }
  },[url,onExpired])

  const content = error ? <InventoryMessage text="양품 창고와 로케이션을 조회할 수 없습니다." onClose={onClose}/> :
    !view ? <InventoryDialog className="inv-message" label="양품 창고 조회" onDismiss={onClose}>
      <p role="status">조회 중</p><button onClick={onClose}>취소</button>
    </InventoryDialog> :
    <ProductionPlaceDialog retainOpeningLocation warehouseLabel="양품 창고" locationLabel="양품 로케이션" warehouses={view.warehouses}
      initial={draft ?? view.current ?? {warehouse:'',location:''}} onClose={onClose} onApply={(warehouse,location) => {
        if (submitting.current) return
        submitting.current=true
        const request=new AbortController()
        pending.current=request
        const from=draft ?? view.current
        const body={warehouse,location,revision:view.revision,fromWarehouse:from?.warehouse,fromLocation:from?.location}
        void productionRequest<GoodPlace>(url,body,undefined,request.signal).then(place=>{
          if (!request.signal.aborted) onApply(place)
        }).catch(e=>{
          if (!request.signal.aborted) {
            if (e instanceof SessionExpired) onExpired()
            else setError(true)
          }
        }).finally(()=>{submitting.current=false})
      }}/>
  return createPortal(content,document.querySelector('main.pop-shell') ?? document.body)
}
