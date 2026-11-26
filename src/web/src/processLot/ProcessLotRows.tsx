import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CommonScanDialog from '../commonInput/CommonScanDialog'
import ProcessStockPicker from './ProcessStockPicker'
import { getSessionData, SessionExpired, SessionRequestError } from '../workHistoryApi'
import './processLot.css'

import {key, over, type Pick, type Stock, type PickerSource} from './processStockTypes'

export function useProcessLotRows() {
  return useState<Record<string, Pick[]>>({})
}

type Props = {
  open: boolean; mode?: 'scan' | 'manual'; slot?: number; date: string; sequence: number; rows: Pick[]; onRows: (rows: Pick[]) => void
  lookupScan?: (raw:string, signal:AbortSignal)=>Promise<Stock[]>
  source?:PickerSource; renderRows?:boolean
  onManualApplied?: (rows:Pick[],focused:Pick|undefined)=>void
  onClose: () => void; onSessionExpired: () => void
}

function Modal({label, kind, children}: {label: string; kind: string; children: React.ReactNode}) {
  const element = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = element.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return createPortal(<dialog ref={element} aria-label={label} className={'process-lot '+kind}
    onCancel={e => e.preventDefault()}>{children}</dialog>, document.body)
}

export default function ProcessLotRows({open,mode = 'scan',slot,date,sequence,rows,source,lookupScan,renderRows=true,onRows,onManualApplied,onClose,onSessionExpired}: Props) {
  const found = useRef<Stock[]>([])
  const [choices,setChoices] = useState<Stock[]>([])
  const [notice,setNotice] = useState('')
  const finishNotice = useRef<() => void>(undefined)
  useEffect(() => () => finishNotice.current?.(), [])
  function warn(text: string) {
    setNotice(text)
    return new Promise<void>(resolve => { finishNotice.current = resolve })
  }
  function dismiss() {
    setNotice('')
  }
  useEffect(() => {
    if (!notice) {
      finishNotice.current?.()
      finishNotice.current = undefined
      return
    }
    const timeout = window.setTimeout(dismiss,2000)
    return () => window.clearTimeout(timeout)
  }, [notice])
  function close() {
    setChoices([]); found.current = []; onClose()
  }
  function merge(incoming: Pick[], single = false) {
    const next = [...rows]
    let focusKey: string | undefined
    for (const pick of incoming) {
      if(mode==='manual' && !single){
        const matches=next.map((row,index)=>({row,index})).filter(({row})=>key(row.stock)===key(pick.stock))
        if(matches.some(({row})=>row.quantity+pick.quantity>pick.stock.available) || !matches.length && pick.quantity>pick.stock.available){
          if(incoming[0]!==pick)onRows(next)
          return false
        }
        if(matches.length)for(const {row,index} of matches)next[index]={...row,stock:pick.stock,checked:true,quantity:row.quantity+pick.quantity}
        else {next.push({...pick,checked:true});focusKey=key(pick.stock)}
        continue
      }
      const index = next.findIndex(x => single ? x.stock.lot === pick.stock.lot : key(x.stock) === key(pick.stock))
      const quantity = (next[index]?.quantity ?? 0) + pick.quantity
      const prior = next[index]
      if (quantity > (single && prior ? prior.stock.available : pick.stock.available)) {
        if (incoming[0] !== pick) onRows(next)
        return false
      }
      const updated = single && prior ? {...prior,quantity} : {...pick,quantity,checked:true}
      if (index < 0) { next.push(updated); focusKey=key(updated.stock) }
      else next[index] = updated
    }
    onRows(next)
    if (mode==='manual') onManualApplied?.(next,next.find(row=>key(row.stock)===focusKey))
    return true
  }
  return <>{renderRows && rows.map(p => <tr key={key(p.stock)} data-process-lot={p.stock.lot}>
    <td><input type="checkbox" aria-label={p.stock.lot+' '+p.stock.location+' 선택'} checked={p.checked}
      onChange={e => onRows(rows.map(x => x === p ? {...x,checked:e.target.checked} : x))}/></td>
    {[p.stock.warehouse,p.stock.thickness,p.stock.width,p.stock.length,p.stock.available,p.quantity,p.stock.location,p.stock.lot]
      .map((v,i) => <td key={i}>{v}</td>)}</tr>)}
    {open && mode === 'scan' && !choices.length && <CommonScanDialog mode="material" position={{left:70,top:270}}
      onEnter={async (raw,signal) => {
        const data = lookupScan ? await lookupScan(raw,signal) : await getSessionData<Stock[]>('/api/pop/work-orders/'+encodeURIComponent(date)+'/'+sequence+'/material-scan'+(slot === undefined ? '' : '?slot='+slot),
          signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw})})
        if (signal.aborted) return {next:'retry'}
        if (!data.length) { await warn('유효한 Lot No가 아닙니다. 다시 스캔하십시오.'); return {next:'retry'} }
        if (data.length === 1) {
          if (!merge([{stock:data[0],quantity:1,checked:true}], true)) await warn(over)
          return {next:'continue'}
        }
        found.current = data
        return {next:'close',result:'ok'}
      }}
      onError={async error => {
        if (error instanceof SessionExpired) { close(); onSessionExpired(); return }
        await warn(error instanceof SessionRequestError ? '자재 조회 오류 ('+error.status+')' : '자재 조회 오류')
      }}
      onClose={result => {
        if (result === 'ok' && found.current.length) setChoices(found.current)
        else close()
      }}/>}
    {open && (mode === 'manual' || choices.length > 0) && <Modal label="투입자재 위치 선택" kind={source?'pl-select pl-basket-picker':'pl-select'}>
      <ProcessStockPicker date={date} sequence={sequence} slot={slot} source={source} scanned={mode==='manual' ? undefined : choices}
        onApply={merge} onClose={close} warn={warn} onSessionExpired={onSessionExpired}/>
    </Modal>}
    {notice && <Modal label="안내" kind="pl-notice"><p>{notice}</p><button type="button" onClick={dismiss}>확인</button></Modal>}
  </>
}
