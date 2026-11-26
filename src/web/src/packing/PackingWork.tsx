import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { InventoryPad } from '../InventoryDialogs'
import { drawingRequest, DrawingError } from '../drawingApi'
import { pendingDrawing, submitDrawing } from '../drawingPending'
import type { DrawingScope, PendingDrawing } from '../drawingPending'
import { SessionExpired } from '../workHistoryApi'
import type { Identity } from '../workHistoryApi'
import PackingStockDialog from './PackingStockDialog'
import type { PackingCandidate } from './PackingStockDialog'
import './packing.css'

type Step = 'CUT_READY' | 'STANDARD_PACK_ACTIVE' | 'STANDARD_PACK_PAUSED' | 'SHIP_READY'
type Action = 'START' | 'PAUSE' | 'RESUME' | 'FINISH' | 'CANCEL'
type Piece = { lot: string; qty: number }
type Order = {
  key: string; info: { item: string; order: string; customer: string; material: string; kind: string; ordered: string; delivery: string; destination: string; thickness: number; width: number; length: number }
  orderedQty: number; availableLot: string; availableQty: number; version: number
  state: Step; owner?: string; startedAt?: string; finishedAt?: string; saved: Piece[]; allowedMaterial: boolean
}
type ScanResult = { matches: { row: Order; orderLine: string; inputs: PackingCandidate[] }[]; notices: string[] }
type Line = { orderLine?: string; id: string; key: string; lot: string; qty: string; stock?: PackingCandidate; copy: boolean }
type Label = { group: string; role: string; device: string | null; status: string }
type Result = { rows: Order[]; labels: Label[] }
type Modal = 'worker' | 'scan' | 'material' | 'kind' | 'lot' | 'quantity' | Action
const api = '/api/pop/packing'
const messages: Partial<Record<string,string>> = {
  PACK_QTY_MUST_MATCH_REMAINING: '남은 포장 수량 전부를 입력하십시오.',
  INVALID_PACKING_STOCK: '선택한 재고의 품목과 위치를 확인하십시오.',
  PACK_QTY_EXCEEDED: '포장 수량을 초과했습니다.', INVALID_PACKING_ROW: '포장 품목과 수량을 확인하십시오.',
  PACK_SCAN_DUPLICATE: '이미 스캔된 작업지시번호입니다.', PACK_SCAN_FINISHED: '이미 완료된 작업지시번호입니다.',
  PACK_SCAN_NOT_FOUND: '등록되지 않는 작업지시번호입니다.', SCAN_SESSION_CHANGED: '작업자와 단말을 확인하십시오.',
  GOOD_WAREHOUSE_REQUIRED: '양품창고가 설정되지 않았습니다.',
  STALE_VERSION: '작업 상태가 변경되었습니다. 최신 작업을 확인하십시오.',
  TERMINAL_MISMATCH: '다른 단말에서 진행 중인 작업입니다.', INVALID_STATE: '현재 작업 상태를 확인하십시오.',
  MATERIAL_NOT_ASSIGNED: '단말에 등록된 재질을 확인하십시오.',
}
function initialLine(order: Order): Line {
  return { id: crypto.randomUUID(), key: order.key, lot: '', qty: String(Math.min(order.orderedQty,order.availableQty)), copy: false }
}
function Dialog({ title, close, children, scan = false }: { title: string; close: () => void; children: ReactNode; scan?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { ref.current?.showModal() }, [])
  return <dialog className={scan ? "packing-dialog pack6-scanner" : "packing-dialog"} aria-label={title} ref={ref}
    onCancel={event => { event.preventDefault(); close() }}><h3>{title}</h3>{children}</dialog>
}

export default function PackingWork({ identity, sampleDate, onSessionExpired }: {
  identity: Identity; sampleDate: string; onSessionExpired: () => void
}) {
  const [orders,setOrders] = useState<Order[]>([])
  const [lines,setLines] = useState<Line[]>([])
  const [selected,setSelected] = useState<string[]>([])
  const [tab,setTab] = useState<'work'|'orders'>('work')
  const [from,setFrom] = useState(sampleDate)
  const [to,setTo] = useState(sampleDate)
  const [material,setMaterial] = useState<string[]>([])
  const [kind,setKind] = useState<string[]>([])
  const [filterDraft,setFilterDraft] = useState<string[]>([])
  const [found,setFound] = useState<Order[]>([])
  const [customer,setCustomer] = useState('')
  const [picked,setPicked] = useState<string[]>([])
  const [worker,setWorker] = useState('')
  const [modal,setModal] = useState<Modal>()
  const [scanCode,setScanCode] = useState('')
  const [stockLine,setStockLine] = useState('')
  const [print,setPrint] = useState(false)
  const [notice,setNotice] = useState('')
  const [busy,setBusy] = useState(false)
  const [pending,setPending] = useState<PendingDrawing | undefined>(() => pendingDrawing([identity.terminal.id,identity.worker.id,'packing','frmProcess6']))
  const [labels,setLabels] = useState<Label[]>([])
  const active = useRef<AbortController | null>(null)
  const restoringRows = useRef<Promise<string[]> | null>(null)
  const scanFlight = useRef<AbortController | null>(null)
  const [readingScan,setReadingScan] = useState(false)
  const terminal = identity.terminal.id
  const operator = identity.worker.id
  const scope: DrawingScope = [terminal,operator,'packing','frmProcess6']
  const lookup = (key: string) => orders.find(order => order.key === key)
  function displayError(error: unknown) {
    if (error instanceof SessionExpired) onSessionExpired()
    else setNotice(error instanceof DrawingError ? messages[error.message] ?? '요청 조건을 확인하십시오.' : '서버 응답을 확인하지 못했습니다.')
  }
  useEffect(() => {
    const controller = new AbortController()
    const restoring = drawingRequest<Order[]>(api,controller.signal).then(data => {
      if (controller.signal.aborted) return []
      const resumed = data.filter(row => row.owner === terminal && ['STANDARD_PACK_ACTIVE','STANDARD_PACK_PAUSED'].includes(row.state))
      setOrders(data)
      setLines(resumed.map(initialLine))
      return resumed.map(row => row.key)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        if (error instanceof SessionExpired) onSessionExpired()
        else setNotice('포장 작업을 조회하지 못했습니다.')
      }
      return []
    })
    restoringRows.current = restoring
    void restoring.then(() => {
      if (restoringRows.current === restoring) restoringRows.current = null
    })
    return () => { controller.abort(); active.current?.abort(); scanFlight.current?.abort(); scanFlight.current=null }
  },[terminal,operator,onSessionExpired])
  const locked = busy || !!pending
  function change(line: string, part: Partial<Pick<Line,'qty'|'lot'|'stock'>>) {
    setNotice('')
    setLines(current => current.map(row => row.id === line ? {...row,...part} : row))
  }
  async function search() {
    if (active.current) return
    if (!from || !to || from > to) { setNotice('조회 기간을 확인하십시오.'); return }
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    const params = new URLSearchParams({from,to})
    material.forEach(value => params.append('material',value))
    kind.forEach(value => params.append('kind',value))
    try {
      const result = await drawingRequest<Order[]>(api+'?'+params,controller.signal)
      if (!controller.signal.aborted) { setFound(result); setCustomer(''); setPicked([]); setNotice('') }
    } catch (error) { if (!controller.signal.aborted) displayError(error) }
    finally { active.current = null; if (!controller.signal.aborted) setBusy(false) }
  }
  function add(keys: string[]) {
    if (!worker) { setNotice('사원번호를 스캔 해주세요.'); return false }
    const rows = keys.map(lookup)
    if (!rows.length || rows.some(row => !row)) { setNotice('작업지시를 선택하십시오.'); return false }
    if (rows.some(row => !row!.allowedMaterial)) { setNotice('단말에 등록된 재질을 확인하십시오.'); return false }
    if (rows.some(row => row!.state === 'SHIP_READY')) { setNotice('작업 완료된 건입니다.'); return false }
    if (keys.some(key => lines.some(line => line.key === key))) { setNotice('이미 스캔된 작업지시번호입니다.'); return false }
    setLines(current => [...current,...rows.map(row => initialLine(row!))])
    setPicked([]); setTab('work'); setNotice(''); return true
  }
  async function readPackingLabel(barcode: string) {
    if (!worker || worker !== operator || scanFlight.current || locked) return
    const controller = new AbortController()
    scanFlight.current = controller
    setReadingScan(true)
    try {
      const visibleKeys = new Set(lines.map(line => line.key))
      if (restoringRows.current) {
        const resumed = await restoringRows.current
        if (controller.signal.aborted) return
        resumed.forEach(key => visibleKeys.add(key))
      }
      const result = await drawingRequest<ScanResult>(api+'/scan',controller.signal,{
        barcode, terminalId:terminal, operatorId:worker, visibleKeys:[...visibleKeys],
      })
      if (controller.signal.aborted) return
      const appended: Line[] = []
      for (const {row,orderLine,inputs} of result.matches) {
        if (!inputs.length) appended.push({...initialLine(row),orderLine})
        inputs.forEach((stock,index)=>appended.push({...initialLine(row),orderLine,stock,lot:stock.lot,
          qty:String(Math.min(row.orderedQty,stock.qty)),copy:index>0}))
      }
      setOrders(current => {
        const rows = new Map(current.map(row => [row.key,row]))
        for (const match of result.matches) rows.set(match.row.key,match.row)
        return [...rows.values()]
      })
      setLines(current=>[...current,...appended])
      setTab('work')
      setNotice(result.notices.map(code=>messages[code]??'작업지시를 확인하십시오.').join(' '))
      setModal(undefined)
    } catch (error) {
      if (!controller.signal.aborted) displayError(error)
    } finally {
      if (scanFlight.current===controller) {
        scanFlight.current=null
        setReadingScan(false)
        setScanCode('')
      }
    }
  }
  function scan() {
    if (modal === 'worker') {
      if (scanCode !== operator && scanCode !== 'SCAN:'+operator) { setNotice('작업자 번호를 확인하십시오.'); return }
      setWorker(operator); setScanCode(''); setNotice(''); setModal('scan'); return
    }
    if ((scanCode.length===15 && scanCode.startsWith('P')) || (scanCode.length===16 && scanCode[6]==='S')) {
      void readPackingLabel(scanCode)
      return
    }
    const match = /^(\d{8})(\d{1,6})$/.exec(scanCode)
    const row = match && orders.find(order => order.key.endsWith('/'+match[1]+'/'+Number(match[2])))
    if (!row) { setNotice('등록되지 않는 작업지시번호입니다.'); return }
    if (add([row.key])) setModal(undefined)
    setScanCode('')
  }
  function copy(line: Line) {
    const row = lookup(line.key)
    if (!row || !['STANDARD_PACK_ACTIVE','STANDARD_PACK_PAUSED'].includes(row.state)) return
    const index = lines.indexOf(line)
    setNotice('')
    setLines([...lines.slice(0,index+1),{...line,id:crypto.randomUUID(),lot:'',stock:undefined,copy:true},...lines.slice(index+1)])
  }
  function toggle(values: string[], value: string) {
    return values.includes(value) ? values.filter(item => item !== value) : [...values,value]
  }
  const work = [...new Set(lines.map(line => line.key))].map(lookup).filter((row): row is Order => !!row)
  const owned = work.every(row => !row.owner || row.owner === terminal)
  const can = (state: Step) => !!worker && !locked && owned && !!work.length && work.every(row => row.state === state)
  const chosen = lines.filter(line => selected.includes(line.id))
  const canDelete = !!worker && !locked && !!chosen.length && chosen.every(line => {
    const row = lookup(line.key)
    return row && row.state !== 'SHIP_READY' && (!row.owner || row.owner === terminal)
  })
  async function send(command: PendingDrawing, replay: boolean) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller; setBusy(true); setNotice(''); setModal(undefined)
    try {
      const result = await submitDrawing<Result>(scope,api+'/commands',controller.signal,command,replay,setPending)
      if (!result || controller.signal.aborted) return
      const fresh = replay ? await drawingRequest<Order[]>(api,controller.signal) : result.rows
      if (controller.signal.aborted) return
      setOrders(fresh); setLabels(result.labels); setSelected([])
      const body = JSON.parse(command.body) as { members: {key: string}[] }
      const affected = body.members.map(member => member.key)
      setLines(current => {
        if (command.action === 'STANDARD_PACK_CANCEL') {
          const remaining = current.filter(line => !selected.includes(line.id) && !(affected.includes(line.key) && !line.copy))
          return remaining.map((line,i) => affected.includes(line.key) && remaining.findIndex(item=>item.key===line.key)===i ? {...line,copy:false} : line)
        }
        if (command.action === 'STANDARD_PACK_FINISH') return current.filter(line => !affected.includes(line.key))
        const existing = new Set(current.map(row => row.key))
        return [...current,...fresh.filter(row => affected.includes(row.key) && !existing.has(row.key)).map(initialLine)]
      })
      if (command.action === 'STANDARD_PACK_FINISH') {
        setScanCode('')
        setModal(worker ? 'scan' : 'worker')
      }
      setNotice(command.action === 'STANDARD_PACK_FINISH' ? '작업완료 되었습니다.' : '처리되었습니다.')
    } catch (error) {
      if (controller.signal.aborted) return
      displayError(error)
      if (error instanceof DrawingError) {
        try { setOrders(await drawingRequest<Order[]>(api,controller.signal)) }
        catch (readError) { if (!controller.signal.aborted) displayError(readError) }
      }
    } finally { active.current = null; if (!controller.signal.aborted) setBusy(false) }
  }
  function execute(action: Action) {
    if (locked || !worker) return
    const keys = action === 'CANCEL' ? [...new Set(chosen.filter(line => !line.copy && lookup(line.key)?.state !== 'CUT_READY').map(line => line.key))] : work.filter(row => action !== 'START' || row.state === 'CUT_READY').map(row => row.key)
    if (action === 'CANCEL' && !keys.length) {
      setLines(current => current.filter(line => !selected.includes(line.id))); setSelected([]); setModal(undefined); return
    }
    if (action === 'FINISH' && lines.some(line => !line.lot || !Number.isFinite(Number(line.qty)) || Number(line.qty)<1)) {
      setNotice('포장 품목과 포장 수량을 확인하십시오.'); setModal(undefined); return
    }
    const full = 'STANDARD_PACK_'+action
    const members = keys.map(key => ({
      key, version: lookup(key)!.version, pieces: action === 'FINISH' ? lines.filter(line => line.key === key).map(line => ({lot:line.lot,qty:Number(line.qty),warehouse:line.stock?.warehouse,location:line.stock?.location,item:line.stock?.item})) : [],
    }))
    const body = {action:full, requestId:crypto.randomUUID(),operatorId:worker,members,autoLabel:action === 'FINISH' && print}
    void send({action:full,body:JSON.stringify(body)},false)
  }
  const visible = found.filter(row => !customer || row.info.customer === customer)
  const checkedVisible = visible.filter(row=>picked.includes(row.key)).map(row=>row.key)
  const prompting = modal && ['START','PAUSE','RESUME','FINISH','CANCEL'].includes(modal)
  const prompts: Record<Action,string> = {START:'작업 시작하시겠습니까?',PAUSE:'작업을 중단하시겠습니까?',RESUME:'작업을 재시작하시겠습니까?',FINISH:'작업완료 하시겠습니까?',CANCEL:'삭제 후 복구가 불가능합니다. 해당 작업을 정말로 삭제하시겠습니까?'}
  const lotRow = lookup(lines.find(line => line.id === stockLine)?.key ?? '')
  const orderTotal = lines.reduce((total,line) => total + (lookup(line.key)?.orderedQty ?? 0),0)
  const packTotal = lines.reduce((total,line) => total + Number(line.qty),0)
  const close = () => {
    scanFlight.current?.abort()
    scanFlight.current=null
    setReadingScan(false)
    setScanCode('')
    setModal(undefined)
  }
  return <section className="pack6" aria-label="일반 포장"><div className="pack6-scroll"><div className="pack6-form">
    <header className="pack6-bar">
      <button className="pack6-scan" aria-label="바코드 스캔" disabled={busy} onClick={() => {setNotice('');setScanCode('');setModal(worker ? 'scan':'worker')}} />
      <div className="pack6-person">거래처 :　<strong>{work[0]?.info.customer ?? '-'}</strong><br />작업자 :　<strong>{worker && identity.worker.name}</strong></div>
      <label className="pack6-auto"><input type="checkbox" checked={print} disabled={locked} onChange={event=>setPrint(event.target.checked)} /><span>포장완료<br />자동 프린트</span></label>
      <button className="start" disabled={!worker || locked || !owned || !work.some(row=>row.state==='CUT_READY') || work.some(row=>row.state==='SHIP_READY' || row.state==='STANDARD_PACK_PAUSED')} onClick={()=>setModal('START')}>START<br />작업시작</button>
      <button className="stop" disabled={!can('STANDARD_PACK_ACTIVE') && !can('STANDARD_PACK_PAUSED')} onClick={()=>setModal(can('STANDARD_PACK_PAUSED')?'RESUME':'PAUSE')}>{work[0]?.state === 'STANDARD_PACK_PAUSED' ? <>RESTART<br />재시작</> : <>STOP<br />작업중단</>}</button>
      <button className="end" disabled={!can('STANDARD_PACK_ACTIVE')} onClick={()=>setModal('FINISH')}>END<br />작업완료</button>
      <button className="del" disabled={!canDelete} onClick={()=>setModal('CANCEL')}>DELETE<br />선택삭제</button>
      <button className="print" type="button">PRINT<br />프린트</button>
    </header>
    <div className="pack6-tabs" role="tablist">{(['work','orders'] as const).map((value,i)=><button role="tab" key={value} aria-selected={tab===value} onClick={()=>setTab(value)}>{['포장 실적등록','수주정보'][i]}</button>)}</div>
    {tab==='orders' ? <div role="tabpanel">
      <div className="pack6-filters"><label>수주일 <input aria-label="수주일 시작" type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label> ~
      <input aria-label="수주일 종료" type="date" value={to} onChange={e=>setTo(e.target.value)} />
      {(['material','kind'] as const).map(key=><button key={key} onClick={()=>{setFilterDraft(key==='kind'?kind:material);setModal(key)}}>{key==='kind'?'품목유형':'재질선택'}</button>)}
      <button disabled={busy} onClick={()=>void search()}>조회</button><button disabled={locked || !checkedVisible.length} onClick={()=>add(checkedVisible)}>적용</button></div>
      <div className="pack6-search"><div><h3>거래처명</h3>{['',...new Set(found.map(row=>row.info.customer))].map(name=><button key={name} aria-pressed={customer===name} onClick={()=>setCustomer(name)}>{name||'전체'}</button>)}</div>
      <div className="pack6-orders-table"><table aria-label="수주정보"><colgroup>{[60,50,145,110,155,80,80,120,70,65,65,40].map((width,index)=><col key={index} style={{width}} />)}</colgroup><thead><tr><th><input aria-label="조회행 전체 선택" type="checkbox" checked={!!visible.length && visible.every(row=>picked.includes(row.key))} onChange={e=>{const selected=e.target.checked;setPicked(current=>[...current.filter(key=>!visible.some(row=>row.key===key)),...(selected?visible.map(row=>row.key):[])])}} /></th>
      {['No','거래처명','수주일자','품목유형','두께','폭','길이','수량','출하수량','POP Print',''].map(name=><th key={name}>{name}</th>)}</tr>
      <tr>{['','','수주번호','납기일자','재질','','','','','출력인','ERP Print',''].map((name,index)=><th key={index}>{name}</th>)}</tr></thead>
      <tbody>{visible.map((row,i)=><tr key={row.key}><td><input aria-label={row.info.order+' 선택'} type="checkbox" checked={picked.includes(row.key)} onChange={()=>setPicked(toggle(picked,row.key))} /></td>
      <td>{i+1}</td><td>{row.info.customer}<br />{row.info.order}</td><td>{row.info.ordered}<br />{row.info.delivery}</td><td>{row.info.kind}<br />{row.info.material}</td>
      {[row.info.thickness,row.info.width,row.info.length].map((n,j)=><td key={j}>{Number.isInteger(n)?n:n.toFixed(1)}</td>)}<td>{row.orderedQty}</td><td></td><td></td><td></td></tr>)}</tbody></table></div></div>
    </div> : <div role="tabpanel" className="pack6-grid"><table aria-label="포장 실적등록"><colgroup>{[48,48,48,131,105,105,87,87,89,150,219,70,87,50].map((width,index)=><col key={index} style={{width}} />)}</colgroup>
    <thead><tr>{['선택','순번','이월','거래처명','최종 납품처명','품목유형','두께','폭','길이','수주수량','창고명 / Location','재고수량','시작시간',''].map((name,index)=><th key={index}>{name}</th>)}</tr>
      <tr>{['복사','','','수주번호','납기일','재질','두께2','폭2','길이2','기 포장수량 / 포장수량','Lot No','','종료시간',''].map((name,index)=><th key={index}>{name}</th>)}</tr></thead>
    <tbody>{lines.map((line,i)=>{
      const row=lookup(line.key)
      if (!row) return null
      const editable=!!worker && !locked && (!row.owner || row.owner===terminal) && row.state!=='SHIP_READY'
      const readout=(upper: ReactNode,lower?: ReactNode)=><div className="pack6-pair"><span>{upper}</span><span>{lower}</span></div>
      return <tr key={line.id}><td>{readout(<input type="checkbox" aria-label={String(i+1)+'행 선택'} checked={selected.includes(line.id)} disabled={locked} onChange={()=>setSelected(toggle(selected,line.id))} />,<button aria-label={String(i+1)+'행 복사'} disabled={!editable || row.state==='CUT_READY'} onClick={()=>copy(line)}>복사</button>)}</td>
        <td>{i+1}</td><td></td><td>{readout(row.info.customer,line.orderLine??row.info.order)}</td><td>{readout(row.info.destination,row.info.delivery)}</td>
        <td>{readout(row.info.kind,row.info.material)}</td><td>{readout(row.info.thickness,line.stock?.thickness)}</td>
        <td>{readout(row.info.width,line.stock?.width)}</td><td>{readout(row.info.length,line.stock?.length)}</td>
        <td>{readout(row.orderedQty,<span className="pack6-quantities"><span>{row.state==='SHIP_READY'?row.saved.reduce((sum,p)=>sum+p.qty,0):0}</span><button aria-label={String(i+1)+'행 포장수량 키패드'} disabled={!editable}
          onClick={()=>{setStockLine(line.id);setModal('quantity')}}>{line.qty}</button></span>)}</td>
        <td><button className="pack6-lot-cell" aria-label={String(i+1)+'행 LOT 선택'} disabled={!editable} onClick={()=>{setStockLine(line.id);setModal('lot')}}>
          {readout(line.stock && line.stock.warehouseName+' / '+line.stock.locationName,line.lot||'LOT 선택')}</button></td>
        <td>{line.stock?.qty}</td><td>{readout(row.startedAt,row.finishedAt)}</td><td></td></tr>
    })}</tbody></table></div>}
    <footer><span>선택건<br />공정진행현황</span><table aria-label="공정진행현황"><thead><tr>{['발주','소재입고','폭 절단','평탄','평면','측면','길이절단','포장'].map(name=><th key={name}>{name}</th>)}</tr></thead><tbody><tr>{Array.from({length:7},(_,i)=><td key={i}/>)}<td>{work.length===1 && ({CUT_READY:'',STANDARD_PACK_ACTIVE:'진행',STANDARD_PACK_PAUSED:'중단',SHIP_READY:'완료'}[work[0].state])}</td></tr></tbody></table>
    <span>총 수주수량 :　{lines.length?orderTotal:'-'}<br />총 포장수량 :　{lines.length?packTotal:'-'}</span></footer>
    </div></div>
    <p role="status">{busy?'처리 중입니다.':notice}</p>
    {pending && <button disabled={busy} onClick={()=>void send(pending,true)}>같은 요청 다시 보내기</button>}
    {labels.map(label=><p key={label.group}>{label.role} · {label.device??'미설정'} · {label.status==='SIMULATED_DIRECT'?'합성 라벨 출력':'출력 장치 미설정'}</p>)}
    {(modal==='scan'||modal==='worker') && <Dialog scan title={modal==='worker'?'사원번호를 스캔하세요.':'작업지시 번호를 스캔하세요.'} close={close}>
      <input autoFocus placeholder=" " aria-label="바코드" readOnly={readingScan} value={scanCode} onChange={e=>setScanCode(e.target.value)}
        onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&!readingScan){e.preventDefault();scan()}}} />
      <p role="status">{notice}</p><button onClick={close}>닫기</button></Dialog>}
    {(modal==='material'||modal==='kind') && <Dialog title={modal==='material'?'재질선택':'품목유형'} close={close}>
      {[...new Set(orders.map(row=>modal==='material'?row.info.material:row.info.kind))].map(value=><label key={value}><input type="checkbox" checked={filterDraft.includes(value)} onChange={()=>setFilterDraft(toggle(filterDraft,value))} />{value}</label>)}
      <button onClick={close}>취소</button><button onClick={()=>{if(modal==='material')setMaterial(filterDraft);else setKind(filterDraft);close()}}>확인</button></Dialog>}
    {modal==='quantity' && lotRow && <div className="pack6-quantity-dialog"><InventoryPad label="포장수량" onClose={close} onApply={value=>{
      const line=lines.find(row=>row.id===stockLine)
      close()
      if (!line || value===0) return
      if (value>lotRow.orderedQty || (line.lot && value>(line.stock?.qty ?? lotRow.availableQty))) {setNotice('포장 수량을 초과했습니다.');return}
      change(line.id,{qty:String(value)})
    }} /></div>}
    {modal==='lot' && lotRow && <PackingStockDialog key={stockLine} plan={lotRow.key} material={lotRow.info.material}
      thickness={lotRow.info.thickness} width={lotRow.info.width} length={lotRow.info.length}
      expired={onSessionExpired} onClose={close} onApply={({stock,qty})=>{
        change(stockLine,{lot:stock.lot,qty:String(qty),stock})
        close()
      }} />}
    {prompting && <Dialog title={prompts[modal as Action]} close={close}><button onClick={close}>아니오</button><button onClick={()=>execute(modal as Action)}>예</button></Dialog>}
  </section>
}
