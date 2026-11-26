import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Calendar, Dialog, OptionDialog, OrderGrid } from './WorkPrintParts'
import { accounts, box, buttons, caption, complete, main, printed } from './workPrintLayout'
import type { Choice, GridRow } from './workPrintLayout'
import deleteIcon from './delete.png'
import './work-print.css'

type Options={today:string,center:string,centers:Choice[],materials:Choice[],forms:string[],diagnostic:boolean}
type Filter={start:string,end:string,center:string,complete:string,printed:string,closed:boolean,drawing:boolean,operator:string,materials:string[],accounts:string[]}
type Doc={id:string,pages:number,submitKey:string}
type Ticket={token:string,number:string,performance:boolean}
type Popup='material'|'account'|'forms'|'preview'|'scan'|'confirm'|'performance'|''
type Lookup='start'|'end'|'center'|'complete'|'printed'|''
const api='/api/pop/work-print'
class WorkPrintError extends Error {
  readonly status:number
  constructor(status:number,message:string){super(message);this.status=status}
}

export default function WorkPrint({onExpired}:{onExpired:()=>void}) {
  const [options,setOptions]=useState<Options>()
  const [f,setFilter]=useState<Filter>()
  const [rows,setRows]=useState<GridRow[]>([])
  const [checked,setChecked]=useState<string[]>([])
  const [customer,setCustomer]=useState('전체')
  const [focus,setFocus]=useState('')
  const [popup,show]=useState<Popup>('')
  const [lookup,setLookup]=useState<Lookup>('')
  const toolbar=useRef<HTMLElement>(null)
  const [lookupAt,setLookupAt]=useState({left:0,top:0})
  const [doc,setDoc]=useState<Doc>()
  const [page,setPage]=useState(1)
  const [readyPage,setReadyPage]=useState('')
  const [barcode,setBarcode]=useState('')
  const [ticket,setTicket]=useState<Ticket>()
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [attempt,setAttempt]=useState(0)
  useEffect(()=>{
    if(!message || !f)return
    const timer=window.setTimeout(()=>setMessage(''),2000)
    return ()=>window.clearTimeout(timer)
  },[message,f])
  const active=useRef<AbortController|null>(null)
  const pendingPreview=useRef<{key:string,form:string,rows:string[]}|undefined>(undefined)
  const expired=useRef(onExpired)
  useEffect(()=>{expired.current=onExpired},[onExpired])
  async function request<T>(path:string,signal:AbortSignal,body?:unknown):Promise<T> {
    const result=await fetch(api+path,{signal,method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)})
    if(result.status===401){if(!signal.aborted)expired.current();throw Error('로그인이 필요합니다.')}
    if(!result.ok){const detail=await result.json().catch(()=>({}));throw new WorkPrintError(result.status,detail.message || '요청을 처리할 수 없습니다.')}
    return result.json()
  }
  function resetRows(value:GridRow[]){setRows(value);setFocus(value[0]?.key??'');setCustomer('전체');setChecked([]);pendingPreview.current=undefined}
  useEffect(()=>{
    const controller=new AbortController()
    active.current=controller
    void (async()=>{
      const o=await request<Options>('/options',controller.signal)
      const filter:Filter={start:o.today,end:o.today,center:o.center,complete:'미완료',printed:'미출력',closed:false,drawing:false,
        operator:'',materials:o.materials.map(c=>c[0]),accounts:accounts.map(c=>c[1])}
      const result=await request<GridRow[]>('/search',controller.signal,filter)
      if(!controller.signal.aborted){setOptions(o);setFilter(filter);resetRows(result)}
    })().catch(e=>{if(!controller.signal.aborted)setMessage(e.message)})
    return ()=>{controller.abort();active.current?.abort()}
  },[attempt])
  async function run(action:(s:AbortSignal)=>Promise<void>) {
    if(busy)return
    active.current?.abort()
    const ctrl=new AbortController();active.current=ctrl;setBusy(true)
    try{await action(ctrl.signal)}catch(e){if(!ctrl.signal.aborted)setMessage(e instanceof Error?e.message:'요청 실패')}
    finally{if(!ctrl.signal.aborted)setBusy(false)}
  }
  const visible=rows.filter(r=>customer==='전체'||r.fields.CUSTOMER_NAME===customer)
  const [sort,setSort]=useState({field:'',desc:false})
  if(sort.field)visible.sort((a,b)=>(a.fields[sort.field]??'').localeCompare(b.fields[sort.field]??'','ko',{numeric:true})*(sort.desc?-1:1))
  function search(){if(f)void run(async s=>{const result=await request<GridRow[]>('/search',s,f);if(!s.aborted){resetRows(result);setSort({field:'',desc:false})}})}
  function toggle(ids:string[]) {
    const all=ids.every(id=>checked.includes(id))
    setChecked(all?checked.filter(k=>!ids.includes(k)):[...new Set([...checked,...ids])])
  }
  function close(){if(!busy){show('');setLookup('')}}
  function choose(form:string){
    if(!options?.forms.includes(form)){setMessage('이 양식의 사용 권한이 없습니다.');return}
    const selected=visible.map(r=>r.key).filter(k=>checked.includes(k))
    const prev=pendingPreview.current
    const body=prev?.form===form && JSON.stringify(prev.rows)===JSON.stringify(selected)?prev:{key:crypto.randomUUID(),form,rows:selected}
    pendingPreview.current=body
    void run(async s=>{const d=await request<Doc>('/preview',s,body);if(!s.aborted){setDoc(d);setPage(1);show('preview');pendingPreview.current=undefined}})
  }
  function closePreview(){
    if(!doc)return
    void run(async s=>{await request('/preview/'+doc.id+'/close',s,{});if(!s.aborted){show('');setDoc(undefined)}})
  }
  function submit() {
    if(!doc || !f)return
    void run(async s=>{await request('/preview/'+doc.id+'/submit',s,{key:doc.submitKey})
      if(s.aborted)return
      show('');setDoc(undefined);setMessage('출력되었습니다.')
      const result=await request<GridRow[]>('/search',s,f);if(!s.aborted)resetRows(result)})
  }
  function scan(){void run(async s=>{
    try {
      const t=await request<Ticket>('/delete/scan',s,{barcode})
      if(!s.aborted){setTicket(t);show('confirm')}
    } catch(e) {
      if(!s.aborted&&e instanceof WorkPrintError&&[400,404].includes(e.status))setBarcode('')
      throw e
    }
  })}
  function remove(){
    if(!ticket||!f)return
    if(popup==='confirm'&&ticket.performance){show('performance');return}
    void run(async s=>{await request('/delete/confirm',s,{token:ticket.token,includeResults:popup==='performance'})
      if(s.aborted)return
      show('');setMessage('수주정보가 삭제 되었습니다.')})
  }
  function label(name:string){return <span className={'wp-label '+name}>{caption(main,name)}</span>}
  function button(name:string,fn:()=>void,child?:ReactNode,aria?:string){
    return <button className={'wp-control '+name} onClick={fn} disabled={busy} aria-label={aria}>{child??caption(main,name)}</button>
  }
  const centers:Choice[]=[['000','전체'],...(options?.centers??[])]
  const choices=lookup==='center'?centers:lookup==='complete'?complete:printed
  const lookupIds={center:'workCenter',complete:'completeEdit',printed:'printEdit',start:'sDateEdit',end:'eDateEdit'}
  const lookupTitle={center:'작업반',complete:'완료여부',printed:'출력여부',start:'시작일',end:'종료일'}
  function lookupButton(key:Exclude<Lookup,''>,value:string){
    return button(lookupIds[key],()=>{
      const rect=toolbar.current?.querySelector('.'+lookupIds[key])?.getBoundingClientRect()
      if(rect)setLookupAt({left:Math.max(0,Math.min(rect.left,window.innerWidth-463)),top:Math.min(rect.bottom,window.innerHeight-240)})
      setLookup(lookup===key?'':key)
    },<>{value}<i aria-hidden="true">{key==='start'||key==='end'?'▾':''}</i></>,lookupTitle[key])
  }
  function checkbox(key:'closed'|'drawing',id:string) {
    return <label className={'wp-filter wp-'+key}>{label(id)}<input className="wp-check" type="checkbox"
      checked={f?.[key]??false} onChange={e=>f&&setFilter({...f,[key]:e.target.checked})}/></label>
  }
  return <section className="wp-host" aria-label="작업 지시서">
    {f && options && <div className="wp-stage" data-form={main}>
      <header className="wp-toolbar" ref={toolbar}><div className="wp-filter-grid">
        <div className="wp-filter wp-dates">{label('labelControl7')}{lookupButton('start',f.start)}{label('labelControl1')}{lookupButton('end',f.end)}</div>
        <div className="wp-filter wp-center">{label('labelControl2')}{lookupButton('center',centers.find(c=>c[0]===f.center)?.[1]??'')}</div>
        <div className="wp-filter wp-complete">{label('labelControl3')}{lookupButton('complete',f.complete)}</div>
        <div className="wp-filter wp-printed">{label('labelControl4')}{lookupButton('printed',f.printed)}</div>
        {button('materialBtn',()=>show('material'))}{button('productBtn',()=>show('account'))}
        {checkbox('drawing','labelDrawOnly')}{checkbox('closed','labelControl5')}
        <input className="wp-operator" placeholder="수주 담당자" aria-label="수주 담당자"
          value={f.operator} onChange={e=>setFilter({...f,operator:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)search()}}/>
      </div><div className="wp-commands">
        {button('searchBtn',search)}{button('printBtn',()=>show('forms'))}
        <div className="wp-delete">{label('labelControl6')}{button('pnDelete',()=>{setBarcode('');show('scan')},<img src={deleteIcon} alt=""/>,'수주삭제')}</div>
      </div></header><div className="wp-results">
      <div className="wp-customers"><b>거래처명</b>{['전체',...new Set(rows.map(r=>r.fields.CUSTOMER_NAME))].map(c=><button key={c} aria-pressed={customer===c}
        onClick={()=>{setCustomer(c);setFocus(rows.find(r=>c==='전체'||r.fields.CUSTOMER_NAME===c)?.key??'');if(c==='전체')setSort({field:'',desc:false})}}>{c}</button>)}</div>
      <OrderGrid rows={visible} checked={checked} focus={focus} setFocus={setFocus} onSort={field=>setSort({field,desc:sort.field===field&&!sort.desc})}
        toggle={k=>toggle([k])} toggleAll={()=>toggle(visible.map(r=>r.key))}/></div>
      {lookup && <><button className="wp-dismiss" aria-label="목록 닫기" onClick={()=>setLookup('')}/><div className="wp-lookup" style={{...lookupAt,maxHeight:'calc(100dvh - '+lookupAt.top+'px)'}} onKeyDown={e=>{if(e.key==='Escape')setLookup('')}}>
        {lookup==='start'||lookup==='end'?<Calendar date={f[lookup]} pick={day=>{setFilter({...f,start:lookup==='start'?day:day<f.start?day:f.start,
          end:lookup==='end'?day:day>f.end?day:f.end});setLookup('')}}/>:
        <div className="wp-choice-list"><b>코드</b><b>{lookupTitle[lookup]}</b>{choices.map(([id,name])=><button key={id} aria-pressed={f[lookup]===(lookup==='center'?id:name)} onClick={()=>{
          setFilter({...f,[lookup]:lookup==='center'?id:name});setLookup('')}}><span>{id}</span>{name}</button>)}<footer><button aria-label="목록 닫기" onClick={()=>setLookup('')}>×</button></footer></div>}</div></>}
    </div>}
    {!f && <p>{message?'조회 조건을 불러오지 못했습니다.':'조회 중…'} {message && <button onClick={()=>{setMessage('');setAttempt(a=>a+1)}}>다시 조회</button>}</p>}
    {(popup==='material'||popup==='account')&&f&&options&&<OptionDialog material={popup==='material'} choices={popup==='material'?options.materials:accounts}
      values={popup==='material'?f.materials:f.accounts} close={close} save={v=>{setFilter({...f,[popup==='material'?'materials':'accounts']:v});close()}}/>}
    {popup==='forms'&&<Dialog name="ComWorkPrintSelect" width={1280} height={500} close={close}>
      {Object.entries(buttons).map(([form,id])=><button key={form} data-report={form} disabled={busy} onClick={()=>choose(form)}>{caption('ComWorkPrintSelect',id)}</button>)}
      <button className="wp-form-close" onClick={close}>닫기</button></Dialog>}
    {popup==='preview'&&doc&&<Dialog name="작업지시서 미리보기" width={1060} height={800} close={closePreview}>
      <div className="wp-preview-tools"><button disabled={page===1||busy} onClick={()=>setPage(page-1)}>이전</button><span>{page} / {doc.pages}</span>
        <button disabled={page===doc.pages||busy} onClick={()=>setPage(page+1)}>다음</button>
        <a className="wp-open-pdf" href={api+'/preview/'+doc.id+'/pdf'} target="_blank" rel="noopener">PDF 열기</a>
        {options?.diagnostic&&<button disabled={busy||readyPage!==doc.id+'/'+page} onClick={submit}>합성 제출</button>}<button disabled={busy} onClick={closePreview}>닫기</button></div>
      <div className="wp-page"><img alt={'작업지시서 '+page+'쪽'} key={doc.id+page} src={api+'/preview/'+doc.id+'/'+page} onLoad={()=>setReadyPage(doc.id+'/'+page)} onError={()=>setMessage('미리보기 페이지를 열 수 없습니다.')}/></div></Dialog>}
    {popup==='scan'&&<Dialog name="ComOrderNoScan" width={880} height={300} close={close} scan>
      <input autoFocus aria-label="수주번호 스캔" style={box('ComOrderNoScan','txtBarCode')} value={barcode} placeholder="수주번호를 스캔하세요."
        onChange={e=>setBarcode(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)scan()}}/>
      <button style={box('ComOrderNoScan','btnScannerClose')} onClick={close}>닫기</button></Dialog>}
    {(popup==='confirm'||popup==='performance')&&<Dialog name="수주삭제 확인" width={683} height={376} close={close}><div className="wp-message">
      <p>{popup==='confirm'?'수주번호 '+ticket?.number+'를 삭제 하시겠습니까?':'생산실적이 있는 수주번호 입니다.\n삭제 시 생산실적도 삭제 됩니다.\n삭제를 계속 진행 하시겠습니까?'}</p>
      <button onClick={remove} disabled={busy}>예</button><button onClick={close} disabled={busy}>아니오</button></div></Dialog>}
    {message&&<Dialog name="알림" width={683} height={376} close={()=>setMessage('')}><div className="wp-message"><p>{message}</p><button onClick={()=>setMessage('')}>확인</button></div></Dialog>}
  </section>
}
