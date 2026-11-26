import { useEffect, useRef, useState } from 'react'
import CommonNumericPad from '../commonInput/CommonNumericPad'
import { getSessionData, SessionExpired } from '../workHistoryApi'
import { key, over, type Pick, type Stock, type PickerSource } from './processStockTypes'
import LocationInput from './StockLocationInput'

type Place = { code: string; name: string }
type Context = { issue: Place[]; auxiliary: Place[]; initial: string; quality: string; thickness: string; width: string }
type Role = 'issue' | 'auxiliary'
type Dimension = 'thickness' | 'width'
type Props = { date: string; sequence: number; slot?: number; source?:PickerSource; scanned?: Stock[]; onApply: (p: Pick[])=>boolean
  onClose: ()=>void; warn: (message: string)=>Promise<void>; onSessionExpired: ()=>void }

function Warehouse({role, places, code, disabled, opened, toggle, choose}: {
  role: Role; places: Place[]; code: string; disabled: boolean; opened: boolean
  toggle: ()=>void; choose: (code: string)=>void
}) {
  const label = role==='issue' ? '투입창고' : '투입보조'
  return <div className={role==='issue'?'pl-wh':'pl-aux'}>{label}
    <button className="pl-lookup" type="button" aria-label={label} aria-expanded={opened}
      disabled={disabled} onClick={toggle}><span>{places.find(p=>p.code===code)?.name ?? ''}</span><i aria-hidden="true"/></button>
    {opened && <div className="pl-options" role="listbox" aria-label={label+' 목록'} onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();toggle()}
    }}><header><span>창고코드</span><span>창고명</span></header>{places.map(p=><button type="button"
      role="option" aria-selected={code===p.code} key={p.code} onClick={()=>choose(p.code)}><span>{p.code}</span><span>{p.name}</span></button>)}</div>}
  </div>
}

export default function ProcessStockPicker({date,sequence,slot,source,scanned,onApply,onClose,warn,onSessionExpired}: Props) {
  const path = source?.path ?? '/api/pop/work-orders/'+encodeURIComponent(date)+'/'+sequence+'/stock-picker'
  const suffix = source?.suffix ?? (slot===undefined ? '' : '?slot='+slot)
  const manual = scanned === undefined
  const operation = useRef<AbortController | null>(null)
  const [busy,setBusy] = useState(true)
  const [ctx,setContext] = useState<Context>()
  const [issue,setIssue] = useState('')
  const [aux,setAux] = useState('')
  const [lookup,setLookup] = useState<Role>()
  const [choices,setChoices] = useState<Stock[]>(scanned ?? [])
  const [focused,setFocused] = useState(scanned?.[0] ? key(scanned[0]) : '')
  const [picks,setPicks] = useState<Pick[]>([])
  const [edit,setEdit] = useState<Pick>()
  const [metric,setMetric] = useState<Dimension>()
  const [location,setLocation] = useState<Place>()
  const [locScan,setLocScan] = useState(false)
  const [scan,setScan] = useState(false)
  const [raw,setRaw] = useState('')
  const inline = useRef<HTMLInputElement>(null)

  function request<T>(part: string, signal: AbortSignal, data?: unknown, method='POST') {
    return getSessionData<T>(path+part+suffix,signal,data===undefined?{headers:source?.headers}:{
      method,headers:{...source?.headers,'Content-Type':'application/json'},body:JSON.stringify(data)})
  }
  function replace(rows: Stock[]) {setChoices(rows);setFocused(rows[0]?key(rows[0]):'')}
  const callbacks = useRef({warn,onSessionExpired})
  useEffect(()=>{callbacks.current={warn,onSessionExpired}},[warn,onSessionExpired])
  async function execute(task: (signal: AbortSignal)=>Promise<void>) {
    if(operation.current) return
    const control=new AbortController()
    operation.current=control;setBusy(true)
    try {await task(control.signal)} catch(error) {
      if(!control.signal.aborted) {
        if(error instanceof SessionExpired) callbacks.current.onSessionExpired()
        else await callbacks.current.warn('자재 조회 오류 ('+(error instanceof Error ? error.message : 'HTTP')+')')
      }
    } finally {
      if(operation.current===control){operation.current=null;if(!control.signal.aborted)setBusy(false)}
    }
  }
  function stock(signal: AbortSignal, role: Role, warehouse: string, spec: Context) {
    return request<Stock[]>('/stock',signal,{role,warehouse,thickness:Number(spec.thickness),width:Number(spec.width)})
  }
  useEffect(()=>{
    void execute(async signal=>{
      const initial = await request<Context>('',signal)
      if(signal.aborted)return
      const data=source?.initialSize?{...initial,...source.initialSize}:initial
      setContext(data);setIssue(data.initial)
      if(manual){const rows=await stock(signal,'issue',data.initial,data);if(!signal.aborted)replace(rows)}
    })
    return ()=>{operation.current?.abort();operation.current=null}
    // The caller mounts one picker per authenticated plan and mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[path,suffix,manual])
  useEffect(()=>{if(scan&&!locScan)inline.current?.focus()},[scan,locScan])
  function choose(role: Role,code: string) {
    setLookup(undefined);setScan(false)
    void execute(async signal=>{
      await request('/fixed',signal,{role,code},'PUT')
      if(signal.aborted)return
      setIssue(role==='issue'?code:'');setAux(role==='auxiliary'?code:'')
      if(manual && ctx){const rows=await stock(signal,role,code,ctx);if(!signal.aborted)replace(rows)}
    })
  }
  function add(s: Stock) {
    const match=picks.find(p=>key(p.stock)===key(s))
    if(match && match.quantity>=s.available){void warn(over);return false}
    setPicks(match?picks.map(p=>p===match?{...p,quantity:p.quantity+1}:p):[...picks,{stock:s,quantity:1,checked:true}])
    return true
  }
  function remnant(){
    setLookup(undefined)
    if(!manual){const s=choices.find(x=>key(x)===focused);if(s)add(s);return}
    void execute(async signal=>{
      const result=await request<{eligible:boolean;rows:Stock[]}>('/remnants',signal,{})
      if(signal.aborted||!result.eligible)return
      replace(result.rows)
      if(result.rows.length)add(result.rows[0]);else setScan(false)
    })
  }
  async function scanInline() {
    if(!choices.length)return
    const matches=choices.filter(s=>s.lot===raw)
    const message=raw.length!==10?'잘못된 정보입니다. 다시 스캔하십시오.':!matches.length?'해당 Lot 번호가 리스트에 없습니다. 확인하십시오.':
      matches.length>1?'Lot 번호 1개에 로케이션이 여러개입니다. 확인 후 터치로 진행하십시오.':''
    if(message)await warn(message)
    else {
      // The inline reader matches the application list by LOT after ruling out multiple source locations.
      const prior=picks.find(p=>p.stock.lot===raw)
      if(prior && prior.quantity>=prior.stock.available)await warn(over)
      else if(prior)setPicks(picks.map(p=>p===prior?{...p,quantity:p.quantity+1}:p))
      else add(matches[0])
    }
    setRaw('');inline.current?.focus()
  }
  function refresh(spec: Context) {
    if(manual)void execute(async signal=>{const rows=await stock(signal,'issue',issue,spec);if(!signal.aborted)replace(rows)})
  }
  function closeLocation(place?: Place){
    setLocation(place);setLocScan(false)
    if(ctx)refresh(ctx)
  }
  const spec=ctx ?? {quality:scanned?.[0]?.quality,thickness:scanned?.[0]?.thickness,width:scanned?.[0]?.width}
  return <div className="pl-surface" onClick={e=>{
    if(lookup && !(e.target as Element).closest('.pl-wh,.pl-aux'))setLookup(undefined)
  }}>
    <div className="pl-spec">
      <Warehouse role="issue" places={ctx?.issue??[]} code={issue} disabled={!manual||busy} opened={lookup==='issue'}
        toggle={()=>setLookup(lookup==='issue'?undefined:'issue')} choose={code=>choose('issue',code)}/>
      <div className="pl-grade">재질　{spec.quality}</div>
      <Warehouse role="auxiliary" places={ctx?.auxiliary??[]} code={aux} disabled={busy} opened={lookup==='auxiliary'}
        toggle={()=>setLookup(lookup==='auxiliary'?undefined:'auxiliary')} choose={code=>choose('auxiliary',code)}/>
    </div>
    {scan?<div className="pl-inline"><input ref={inline} aria-label="투입자재 스캔" value={raw} onChange={e=>setRaw(e.target.value)}
      onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void scanInline()}}}/>
      {!raw&&<span>투입자재를 스캔하십시오.</span>}<button type="button" onClick={()=>setScan(false)}>닫기</button></div>
      :<button type="button" className="pl-scan" disabled={!manual||busy} onClick={()=>setScan(true)}>스캔으로 수량 추가하기</button>}
    <div className="pl-grids"><section onClick={e=>{if((e.target as Element).closest('table'))setScan(false)}}><h3>자재 목록 <small>
      {(['thickness','width'] as const).map(m=><label key={m}>{m==='thickness'?'두께':'폭'} <button type="button"
        disabled={!manual||busy} onClick={()=>{setMetric(m);setScan(false)}}>{spec[m]}</button></label>)}</small>
      {location&&<span className="pl-location-name">{location.name}</span>}
      <button type="button" className="pl-loc-button" aria-label="위치 바코드 스캔" disabled={busy}
        onClick={()=>setLocScan(true)}/></h3>
        <div className="pl-table-scroll"><table className="pl-left"><colgroup>{[155,70,60,60,60,70,90].map((width,i)=><col key={i} style={{width}}/>)}</colgroup><thead><tr>{['소분류명','재질명','두께','폭','길이','재고수량','추가'].map(h=><th key={h}>{h}</th>)}</tr></thead>
        <tbody>{choices.map(s=><tr key={key(s)} aria-selected={focused===key(s)} onClick={()=>{setFocused(key(s));setScan(false)}}>{[s.name,s.quality,s.thickness,s.width,s.length,s.available].map((v,i)=><td key={i}>{v}</td>)}
        <td><button type="button" aria-label={s.warehouse+' '+s.location+' 추가'} onClick={()=>add(s)}>✔</button></td></tr>)}</tbody></table></div></section>
        <button type="button" className="pl-arrow" aria-label="스캔 입력 닫기" onClick={()=>setScan(false)}/><section onClick={e=>{if((e.target as Element).closest('table'))setScan(false)}}><h3>적용 목록<button type="button" className="pl-remnant" onClick={remnant} disabled={busy}>잔재 추가</button></h3><div className="pl-table-scroll"><table className="pl-right"><colgroup>{[75,80,70,60,60,60,70,90,75].map((width,i)=><col key={i} style={{width}}/>)}</colgroup><thead><tr>{['창고명','로케이션명','재질명','두께','폭','길이','투입수량','삭제','품목제품유형'].map(h=><th key={h}>{h}</th>)}</tr></thead>
        <tbody>{picks.map(p=><tr key={key(p.stock)}>{[p.stock.warehouseName??p.stock.warehouse,p.stock.locationName??p.stock.location,p.stock.quality,p.stock.thickness,p.stock.width,p.stock.length]
          .map((v,i)=><td key={i}>{v}</td>)}<td><button type="button" aria-label={p.stock.location+' 투입수량'} onClick={()=>setEdit(p)}>{p.quantity}</button></td>
          <td><button type="button" aria-label={p.stock.location+' 삭제'} onClick={()=>setPicks(picks.flatMap(x=>x!==p?[x]:x.quantity===1?[]:[{...x,quantity:x.quantity-1}]))}>−</button></td>
          <td>{p.stock.workStatus}</td></tr>)}</tbody></table></div></section></div>

    <footer><button type="button" disabled={busy} onClick={()=>{
      if(!picks.length){void warn('항목을 선택하십시오.');return}
      if(onApply(picks))onClose();else void warn(over)
    }}>적용</button><button type="button" onClick={onClose}>닫기</button></footer>
    {locScan&&<LocationInput onClose={()=>closeLocation()} onScan={async (raw,signal)=>{
      try {
        const found=await request<Place[]>('/location',signal,{warehouse:issue,raw})
        if(signal.aborted)return
        if(found.length)closeLocation(found[0])
        else await warn('등록되지 않은 Location입니다. 다시 스캔하십시오.')
      } catch(error){if(!signal.aborted){if(error instanceof SessionExpired)onSessionExpired();else await warn('위치 조회 오류')}}
    }}/>}
    {metric&&ctx&&<CommonNumericPad mode="decimal" onCancel={()=>{setMetric(undefined);refresh(ctx)}} onApply={value=>{
      const next={...ctx,[metric]:value};setMetric(undefined);setContext(next);refresh(next)
    }}/>}
    {edit&&<CommonNumericPad mode="integer" onCancel={()=>setEdit(undefined)} onApply={value=>{
      setPicks(picks.map(p=>p===edit?{...p,quantity:Math.min(p.stock.available,Math.max(1,Number(value)))}:p));setEdit(undefined)
    }}/>}
  </div>
}
