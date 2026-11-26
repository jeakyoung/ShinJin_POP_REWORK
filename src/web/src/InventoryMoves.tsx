import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { InventoryError, loadInventory, sendInventory, sendInventoryDocument, locationName, stockKey } from './inventoryApi'
import type { Command, DocumentCommand, InventoryView, MoveLine } from './inventoryApi'
import { InventoryDialog, InventoryMessage, InventoryPad, PairDialog } from './InventoryDialogs'
import InventoryStockDialog from './InventoryStockDialog'
import type { StockPick } from './InventoryStockDialog'
import './InventoryMoves.css'

type Props = { actor: { terminal: string; worker: string }; onSessionExpired: () => void }
type Pending = Command | DocumentCommand
type Row = MoveLine & { key: string; balance: number; selected: boolean }
type Open = {type:'plant'|'stock'|'documents'} | { type:'location'|'quantity'; key:string }
const messages: Record<string,string> = {
  STALE_VERSION:'다른 이동이 먼저 반영되었습니다. 재고 수량을 확인하십시오.',
  INSUFFICIENT_STOCK:'재고 수량이 이동 수량보다 부족합니다! 확인하세요!',
  SAME_WAREHOUSE:'입고 창고와 출고 창고가 동일합니다! 확인하세요!',
  LOCATION_OUT_OF_SCOPE:'선택한 창고와 로케이션 설정을 확인하십시오.',
  TERMINAL_OUT_OF_SCOPE:'현재 단말에 재고이동 권한이 없습니다.',
  CANCEL_TERMINAL_MISMATCH:'등록한 단말에서 삭제하십시오.',
  STOCK_OVERFLOW:'도착 위치의 재고 상한을 초과합니다.',
  COMMAND_ACTOR_MISMATCH:'등록한 작업자와 단말에서 다시 시도하십시오.',
  MOVEMENT_NOT_FOUND:'선택한 항목을 찾을 수 없습니다.',
  ALREADY_CANCELLED:'이미 삭제된 항목입니다.',
  INVALID_COMMAND:'사업장·창고·위치와 수량을 확인하십시오.',
}

function readRetry(key: string): Pending | undefined {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as Pending : undefined }
  catch { return undefined }
}

function documentRows(view: InventoryView, number: string): Row[] {
  const doc = view.documents.find(item => item.number === number)
  if (!doc) return []
  return doc.movementIds.flatMap(key => {
    const movement = view.movements.find(item => item.id === key)
    if (!movement) return []
    const balance = view.balances.find(row => row.lot.item === movement.lot.item && row.lot.lot === movement.lot.lot
      && row.location.warehouse === movement.source.warehouse && row.location.position === movement.source.position)
    return [{key,selected:false,balance:Number(balance?.quantity ?? 0),lot:movement.lot,
      source:movement.source,rowDestination:movement.destination,quantity:movement.quantity}]
  })
}

function HeaderField({label,text,onOpen,onClear,locked}: {label:string;text:string;onOpen:()=>void;onClear:()=>void;locked:boolean}) {
    return <div className="inv-head-field"><span>{label}</span><button type="button" aria-label={label} disabled={locked} onClick={onOpen}>{text}</button>
      {text && <button type="button" className="inv-clear" aria-label={label+' 지우기'} disabled={locked} onClick={onClear}>X</button>}</div>
  }

export default function InventoryMoves({ actor, onSessionExpired }: Props) {
  const storageKey = 'synthetic-inventory-retry:' + JSON.stringify([actor.terminal,actor.worker])
  const [view,setView] = useState<InventoryView>()
  const [site,setSite] = useState('')
  const [warehouse,setWarehouse] = useState('')
  const [number,setNumber] = useState('')
  const [rows,setRows] = useState<Row[]>([])
  const [open,setOpen] = useState<Open>()
  const [marked,setMarked] = useState<{key:string; quantity:boolean}>()
  const [pickedDoc,setPickedDoc] = useState('')
  const [notice,setNotice] = useState('')
  const [confirm,setConfirm] = useState<{text:string; accept:()=>void}>()
  const [busy,setBusy] = useState(false)
  const [retry,setRetry] = useState(() => readRetry(storageKey))
  const [refreshToken,setRefreshToken] = useState(0)
  const inFlight = useRef(false)
  const lifetime = useRef({active:true})
  useLayoutEffect(() => {
    const mount={active:true}; lifetime.current=mount
    return () => {mount.active=false}
  },[storageKey])
  useEffect(() => {
    const abort=new AbortController()
    void loadInventory(abort.signal).then(next => {
      if (abort.signal.aborted) return
      if (!next.catalog) {setNotice('재고이동 전표 API를 불러올 수 없습니다.');return}
      setView(next);setSite(next.actor.site.site)
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) {
        if (error instanceof InventoryError && error.status === 401) onSessionExpired()
        else setNotice('재고이동을 조회할 수 없습니다.')
      }
    })
    return () => abort.abort()
  },[onSessionExpired,refreshToken])

  function reset(active: InventoryView) {
    setNumber('');setSite(active.actor.site.site);setWarehouse('');setRows([]);setMarked(undefined)
  }
  function display(active: InventoryView, docNo:string) {
    const doc=active.documents.find(d=>d.number === docNo)
    if (!doc) {reset(active);return}
    setNumber(docNo);setSite(doc.actor.site.site);setWarehouse(doc.warehouse);setRows(documentRows(active,docNo));setMarked(undefined)
  }
  function report(error: unknown) {
    if (error instanceof InventoryError && error.status === 401) onSessionExpired()
    else setNotice(error instanceof InventoryError ? messages[error.message] ?? '요청 실패 · '+error.message
      : '요청 결과를 확인할 수 없습니다. 동일 명령으로 다시 시도하십시오.')
  }
  const sameActor=view?.actor.terminal === actor.terminal && view.actor.worker === actor.worker
  async function execute(command:Pending) {
    if (!view?.canMove || !sameActor || inFlight.current) return
    const mount=lifetime.current
    try {sessionStorage.setItem(storageKey,JSON.stringify(command))} catch {setNotice('재시도 정보를 저장할 수 없습니다.');return}
    setRetry(command);inFlight.current=true;setBusy(true)
    let committed=false
    function clear() {
      if (readRetry(storageKey)?.requestId === command.requestId) sessionStorage.removeItem(storageKey)
      setRetry(undefined)
    }
    try {
      let documentNo:string|null
      if (command.action === 'MOVE' || command.action === 'CANCEL') {
        const result=await sendInventory(command)
        documentNo=command.action === 'MOVE' ? result.movement.id : null
      } else documentNo=(await sendInventoryDocument(command)).documentNo
      committed=true
      const next=await loadInventory()
      if (!mount.active) return
      setView(next);clear()
      if (documentNo) display(next,documentNo);else reset(next)
      setNotice(command.action === 'DELETE_LINES' || command.action === 'CANCEL' ? '삭제 되었습니다.' : '저장 하였습니다.')
    } catch (error) {
      if (!mount.active) return
      if (!committed && error instanceof InventoryError && [400,403,404,409,422].includes(error.status)) {
        clear()
        if (error.status === 409) {
          try {
            const next=await loadInventory()
            if (!mount.active) return
            setView(next)
            if (number) display(next,number)
            else setRows(current => current.map(row => {
              const balance=next.balances.find(b=>stockKey(b)===stockKey({lot:row.lot,location:row.source}))
              return {...row,balance:Number(balance?.quantity ?? 0)}
            }))
          } catch (refreshError) {if (mount.active) report(refreshError);return}
        }
      }
      report(error)
    } finally {inFlight.current=false;if (mount.active) setBusy(false)}
  }
  if (!view || !sameActor) return <section aria-label="재고이동"><p role="status">{notice || '조회 중'}</p>
    {notice && <button type="button" onClick={()=>setRefreshToken(n=>n+1)}>다시 조회</button>}</section>
  const active=view
  const catalog=view.catalog
  const locked=busy || !!retry
  const editable=view.canMove && !locked
  function save() {
    if (!rows.length) {setNotice('등록 대상이 없습니다. 확인하십시오.');return}
    if (number) {setNotice('이미 처리된 내역입니다. 확인하십시오.');return}
    for (const row of rows) {
      const short=Number(row.quantity)>row.balance
      if (short || site!==active.actor.site.site || row.source.warehouse===warehouse) {
        setMarked({key:row.key,quantity:short})
        setNotice(short ? messages.INSUFFICIENT_STOCK : site!==active.actor.site.site
          ? '입고 사업장과 출고 사업장이 다릅니다! 확인하세요!' : messages.SAME_WAREHOUSE)
        return
      }
    }
    setConfirm({text:'등록 하시겠습니까?',accept:()=>{
      void execute({action:'SAVE',requestId:crypto.randomUUID(),expectedVersion:active.version,destinationSite:site,
        warehouse,lines:rows.map(({lot,source,rowDestination,quantity})=>({lot,source,rowDestination,quantity}))})
    }})
  }
  function remove() {
    if (!rows.length) {setNotice('삭제 대상이 없습니다. 확인하십시오.');return}
    const selected=rows.filter(row=>row.selected).map(row=>row.key)
    if (!selected.length) {setNotice('삭제 대상을 선택하세요.');return}
    setConfirm({text:'선택한 항목을 삭제하시겠습니까?',accept:()=>{
    if (number) void execute({action:'DELETE_LINES',requestId:crypto.randomUUID(),expectedVersion:active.version,documentNo:number,selectedIds:selected})
    else {
      const keep=rows.filter(row=>!row.selected)
      if (keep.length) setRows(keep); else reset(active)
      setNotice('삭제 되었습니다.')
    }
    }})
  }
  async function lookup(callback:(data:InventoryView)=>void) {
    if (inFlight.current) return
    inFlight.current=true;setBusy(true)
    const mount=lifetime.current
    try {
      const next=await loadInventory()
      if (mount.active) {setView(next);callback(next)}
    } catch(error) {if(mount.active) report(error)}
    finally {inFlight.current=false;if(mount.active)setBusy(false)}
  }
  function add(picks:StockPick[]) {
    const existingLots=new Set(rows.map(row=>row.lot.lot))
    const additions=picks.filter(p=>!existingLots.has(p.balance.lot.lot)).map(({balance,quantity})=>({
      key:stockKey(balance),lot:balance.lot,source:balance.location,rowDestination:{warehouse,position:'000000'},
      balance:Number(balance.quantity),quantity:String(quantity),selected:false}))
    setRows([...rows,...additions].map(row=>({...row,rowDestination:catalog.defaults.find(entry=>
      entry.item===row.lot.item && entry.location.warehouse===warehouse)?.location ?? {warehouse,position:'000000'}})))
    setOpen(undefined);setNotice('')
  }
  const target=open && 'key' in open ? rows.find(row=>row.key===open.key) : undefined
  const currentDocs=view.documents.filter(doc=>doc.date===view.today && (!site || doc.actor.site.site === site) && (!warehouse || doc.warehouse===warehouse))
  return <section className="inventory-screen" aria-label="재고이동">
    <header className="inv-head"><div className="inv-fields">
      <HeaderField label="처리 번호" text={number} locked={locked} onOpen={()=>void lookup(()=>{setPickedDoc('');setOpen({type:'documents'})})} onClear={()=>setNumber('')}/>
      <div className="inv-head-field"><span>입출일자</span><output>{view.today}</output></div>
      <HeaderField label="입고 사업장" text={catalog.plants[site]??''} locked={locked} onOpen={()=>setOpen({type:'plant'})} onClear={()=>{setSite('');setWarehouse('')}}/>
      <HeaderField label="입고 창고" text={catalog.warehouses[warehouse]??''} locked={locked} onOpen={()=>setOpen({type:'plant'})} onClear={()=>setWarehouse('')}/>
    </div><div className="inv-actions"><button type="button" disabled={locked} onClick={()=>{reset(view);setNotice('')}}>신규</button>
      <button type="button" disabled={!editable} onClick={save}>저장</button><button type="button" disabled={!editable} onClick={remove}>삭제</button>
      <button type="button" disabled={!editable} onClick={()=>{
        if (number) setNotice('이미 처리된 내역은 추가할 수 없습니다.')
        else if (!site || !warehouse) setNotice(!site?'입고 사업장을 선택하세요!':'입고 창고를 선택하세요!')
        else void lookup(()=>{setNotice('');setOpen({type:'stock'})})
      }}>행 추가</button></div></header>
    {notice && <InventoryMessage text={notice} onClose={()=>setNotice('')}/>}
    {confirm && <InventoryMessage text={confirm.text} onClose={()=>setConfirm(undefined)} onYes={()=>{
      setConfirm(undefined);confirm.accept()
    }}/>}
    {retry && <button type="button" disabled={busy || !view.canMove} onClick={()=>void execute(retry)}>동일 명령 재시도</button>}
    <div className="inv-main-table"><table aria-label="재고이동 목록"><thead><tr>
      <th rowSpan={2}>선택</th><th>품목유형</th><th rowSpan={2}>두께</th><th rowSpan={2}>폭</th><th rowSpan={2}>길이</th>
      <th>출고 창고</th><th>출고 Location</th><th rowSpan={2}>Lot no</th><th rowSpan={2}>재고 수량</th><th rowSpan={2}>이동 수량</th>
    </tr><tr><th>재질</th><th>입고 창고</th><th>입고 Location</th></tr></thead>
      {rows.map(row=>{
        const spec=catalog.items.find(item=>item.code===row.lot.item)
        return <tbody key={row.key}><tr><td rowSpan={2} className={marked?.key===row.key?'inv-invalid':''}><input type="checkbox" aria-label={row.lot.lot+' 선택'}
          disabled={!editable} checked={row.selected} onChange={e=>setRows(rows.map(r=>r===row?{...r,selected:e.target.checked}:r))}/></td>
          <td>{spec?.kind}</td><td rowSpan={2}>{spec?.thickness}</td><td rowSpan={2}>{spec?.width}</td><td rowSpan={2}>{spec?.length}</td>
          <td>{catalog.warehouses[row.source.warehouse]}</td><td>{locationName(view,row.source)}</td><td rowSpan={2}>{row.lot.lot}</td>
          <td rowSpan={2}>{row.balance}</td><td rowSpan={2}><button type="button" className={marked?.key===row.key && marked.quantity?'inv-invalid':'inv-qty'}
            disabled={!editable || !!number} aria-label={row.lot.lot+' 이동 수량'} onClick={()=>setOpen({type:'quantity',key:row.key})}>{Number(row.quantity)}</button></td>
        </tr><tr><td>{spec?.quality}</td>
          {[catalog.warehouses[row.rowDestination.warehouse],locationName(view,row.rowDestination)].map((label,i)=><td key={i}>
            <button type="button" aria-label={row.lot.lot+(i?' 입고 Location':' 입고 창고')} disabled={!editable}
              onClick={()=>setOpen({type:'location',key:row.key})}>{label}</button></td>)}</tr></tbody>
      })}</table></div>
    {open?.type==='plant' && <PairDialog view={view} mode="header" current={[site,warehouse]} onClose={()=>setOpen(undefined)}
      onApply={(a,b)=>{setSite(a);setWarehouse(b);setOpen(undefined)}}/>}
    {open?.type==='location' && target && <PairDialog view={view} mode="row" current={[target.rowDestination.warehouse,target.rowDestination.position]}
      onClose={()=>setOpen(undefined)} onApply={(a,b)=>{setRows(rows.map(r=>r===target?{...r,rowDestination:{warehouse:a,position:b}}:r));setOpen(undefined)}}/>}
    {open?.type==='quantity' && target && <InventoryPad label="이동 수량 입력" onClose={()=>setOpen(undefined)} onApply={n=>{
      if (n>target.balance) setNotice('이동 수량은 재고 수량을 초과 할 수 없습니다. 다시 입력하세요!')
      else {setRows(rows.map(r=>r===target?{...r,quantity:String(n)}:r));setNotice('')}
      setOpen(undefined)
    }}/>}
    {open?.type==='stock' && <InventoryStockDialog view={view} onApply={add} onClose={()=>setOpen(undefined)}/>}
    {open?.type==='documents' && <InventoryDialog label="출고 목록" className="inv-docs" onDismiss={()=>setOpen(undefined)}>
      <h3>출고 목록</h3><div><table><thead><tr>{['선택','출고번호','재질','출고 건수','출고자','출고일'].map(col=><th key={col}>{col}</th>)}</tr></thead>
        <tbody>{currentDocs.map(doc=><tr key={doc.number}><td><input type="checkbox" name="output-number" aria-label={doc.number+' 선택'}
          checked={pickedDoc===doc.number} onChange={e=>setPickedDoc(e.target.checked?doc.number:'')}/></td><td>{doc.number}</td><td>{[...new Set(doc.movementIds.map(id=>
          catalog.items.find(spec=>spec.code===view.movements.find(move=>move.id===id)?.lot.item)?.quality).filter(Boolean))].join(', ')}</td>
          <td>{doc.movementIds.length}</td><td>{doc.actor.worker}</td><td>{doc.date}</td></tr>)}</tbody></table></div>
      <footer><button type="button" className="inv-apply" onClick={()=>{
        if (!currentDocs.length) {setNotice('등록된 이송 내역이 없습니다. 확인하십시오.');return}
        if (!pickedDoc) {setNotice('조회할 대상을 선택하십시오.');return}
        setConfirm({text:'선택한 출고정보를 조회하시겠습니까?',accept:()=>void lookup(next=>{
          display(next,pickedDoc);setOpen(undefined)
        })})
      }}>조회</button><button type="button" onClick={()=>setOpen(undefined)}>닫기</button></footer>
    </InventoryDialog>}
  </section>
}
