import './packingStock.css'
import { useEffect, useState } from 'react'
import { InventoryDialog, InventoryPad, Lookup } from '../InventoryDialogs'
import { drawingRequest } from '../drawingApi'
import { SessionExpired } from '../workHistoryApi'

export type PackingCandidate = {
  lot: string; item: string; warehouse: string; warehouseName: string; location: string; locationName: string
  auxiliary: boolean; material: string; kind: string; thickness: number; width: number; length: number; qty: number
}
type Pick = { stock: PackingCandidate; qty: number }
const stockKey = (s: PackingCandidate) => JSON.stringify([s.warehouse,s.location,s.lot,s.item])
function warehouses(rows: PackingCandidate[], auxiliary: boolean): [string,string][] {
  return [...new Map(rows.filter(row => row.auxiliary === auxiliary).map(row => [row.warehouse,row.warehouseName])).entries()]
}

export default function PackingStockDialog({plan, material, thickness, width, length, onApply, onClose, expired}: {
  plan: string; material: string; thickness: number; width: number; length: number
  onApply: (value: Pick) => void; onClose: () => void; expired: () => void
}) {
  const [rows,setRows] = useState<PackingCandidate[]>([])
  const [warehouse,setWarehouse] = useState('')
  const [aux,setAux] = useState('')
  const [location,setLocation] = useState('')
  const [thick,setThick] = useState(thickness)
  const [wide,setWide] = useState(width)
  const [pick,setPick] = useState<Pick>()
  const [scan,setScan] = useState<'lot'|'location'>()
  const [code,setCode] = useState('')
  const [pad,setPad] = useState<'투입수량'|'두께'|'폭'>()
  const [notice,setNotice] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    drawingRequest<PackingCandidate[]>('/api/pop/packing/stock?'+new URLSearchParams({key:plan}),controller.signal).then(data=>{
      if (controller.signal.aborted) return
      setRows(data)
      setWarehouse(warehouses(data,false)[0]?.[0] ?? '')
    }).catch((error: unknown)=>{
      if (controller.signal.aborted) return
      if (error instanceof SessionExpired) expired()
      else setNotice('재고를 조회하지 못했습니다.')
    })
    return () => controller.abort()
  },[plan,expired])
  const candidates=rows.filter(row=>row.warehouse===(aux||warehouse) && (!location || row.location===location)
    && row.material===material && (!thick || row.thickness===thick) && (!wide || row.width===wide)
    && (!length || row.length===length) && row.qty>0)
  function add(stock: PackingCandidate) {
    if (pick && stockKey(pick.stock)!==stockKey(stock)) {setNotice('재고는 한 건만 선택 가능합니다.');return}
    if (pick && pick.qty>=stock.qty) {setNotice('투입수량이 재고 수량보다 높을 순 없습니다.');return}
    setPick({stock,qty:(pick?.qty??0)+1});setNotice('')
  }
  function scanEnter() {
    if (scan==='location') {
      if (!rows.some(row=>row.warehouse===(aux||warehouse) && row.location===code)) {
        setNotice('로케이션을 확인하십시오.');return
      }
      setLocation(code);setScan(undefined);setCode('');setNotice('');return
    }
    const matches=candidates.filter(row=>row.lot===code)
    if (code.length!==10) setNotice('잘못된 정보입니다. 다시 스캔하십시오.')
    else if (!matches.length) setNotice('해당 Lot 번호가 리스트에 없습니다.')
    else if (matches.length>1) setNotice('Lot 번호 1개에 로케이션이 여러개입니다. 확인 후 터치로 진행하십시오.')
    else add(matches[0])
    setCode('')
  }
  function selectWarehouse(value: string, auxiliary: boolean) {
    setWarehouse(auxiliary?'':value);setAux(auxiliary?value:'');setLocation('');setNotice('')
  }
  return <InventoryDialog label="포장 품목 선택" className="pack-stock" onDismiss={onClose}>
    <header><Lookup label="투입창고" value={warehouse} options={warehouses(rows,false)} onChoose={v=>selectWarehouse(v,false)} />
      <span>재질　{material}</span><Lookup label="투입보조" value={aux} options={warehouses(rows,true)} onChoose={v=>selectWarehouse(v,true)} /></header>
    {scan ? <div className="pack-stock-scan"><input autoFocus aria-label={scan==='lot'?'LOT 번호':'로케이션 코드'} value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();scanEnter()}}} />
      <button onClick={()=>{if(scan==='location')setLocation('');setScan(undefined);setCode('');setNotice('')}}>닫기</button></div>
      : <button className="pack-stock-scan" onClick={()=>{setScan('lot');setCode('')}}>스캔으로 수량 추가하기</button>}
    <div className="pack-stock-lists">
      <section><div className="pack-stock-tools"><h3>자재 목록</h3><button onClick={()=>setPad('두께')}>두께　{thick}</button>
        <button onClick={()=>setPad('폭')}>폭　{wide}</button><button className="pack-stock-loc" aria-label="로케이션 스캔" onClick={()=>{setScan('location');setCode('')}}>⌕</button></div>
        <div className="pack-stock-table"><table aria-label="자재 목록"><thead><tr>{['소분류명','재질명','두께','폭','길이','재고수량','추가','로케이션명','LOTNO'].map(h=><th key={h}>{h}</th>)}</tr></thead>
        <tbody>{candidates.map(row=><tr key={stockKey(row)}><td>{row.kind}</td><td>{row.material}</td><td>{row.thickness}</td><td>{row.width}</td><td>{row.length}</td><td>{row.qty}</td>
        <td><button aria-label={row.location+' 추가'} onClick={()=>add(row)}>+</button></td><td>{row.locationName}</td><td>{row.lot}</td></tr>)}</tbody></table></div></section>
      <span className="pack-stock-arrow" aria-hidden="true">➜</span>
      <section><div className="pack-stock-tools"><h3>적용 목록</h3></div>
      <div className="pack-stock-table"><table aria-label="적용 목록"><thead><tr>{['창고명','로케이션명','재질명','두께','폭','길이','투입수량','삭제','LOTNO'].map(h=><th key={h}>{h}</th>)}</tr></thead>
      <tbody>{pick && <tr><td>{pick.stock.warehouseName}</td><td>{pick.stock.locationName}</td><td>{pick.stock.material}</td>
        <td>{pick.stock.thickness}</td><td>{pick.stock.width}</td><td>{pick.stock.length}</td>
        <td><button aria-label="투입수량 수정" onClick={()=>setPad('투입수량')}>{pick.qty}</button></td>
        <td><button aria-label="투입수량 삭제" onClick={()=>{setPick(pick.qty<=1?undefined:{...pick,qty:pick.qty-1});setNotice('')}}>−</button></td>
        <td>{pick.stock.lot}</td></tr>}</tbody></table></div></section>
    </div>
    <p role="status">{notice}</p><footer><button onClick={()=>{if(pick)onApply(pick);else setNotice('항목을 선택하십시오.')}}>적용</button>
    <button onClick={onClose}>닫기</button></footer>
    {pad && <InventoryPad label={pad} decimal={pad!=='투입수량'} onClose={()=>setPad(undefined)} onApply={n=>{
      if(pad==='투입수량' && pick)setPick({...pick,qty:Math.min(pick.stock.qty,Math.max(1,n))})
      if(pad==='두께')setThick(n)
      if(pad==='폭')setWide(n)
      setPad(undefined)
    }} />}
  </InventoryDialog>
}
