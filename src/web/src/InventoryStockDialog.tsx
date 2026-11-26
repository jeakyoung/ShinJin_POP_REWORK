import { useRef, useState } from 'react'
import type { Balance, InventoryView } from './inventoryApi'
import { InventoryDialog, InventoryMessage, InventoryPad, Lookup } from './InventoryDialogs'
import { locationName, stockKey } from './inventoryApi'

export type StockPick = { balance: Balance; quantity: number }
const additionalQualities = ['007','015','019','024','025','026','029','034','035','038','039']

export default function InventoryStockDialog({ view, onApply, onClose }: {
  view: InventoryView; onApply: (picks: StockPick[]) => void; onClose: () => void
}) {
  const { catalog, actor } = view
  const inputList = catalog.inputWarehouses[actor.terminal] ?? []
  const auxList = catalog.auxiliaryWarehouses[actor.terminal] ?? []
  const storageKey = 'pop-inventory-stock-warehouse:' + actor.terminal
  const [warehouse,setWarehouse] = useState(() => {
    const saved = localStorage.getItem(storageKey)
    return saved && inputList.includes(saved) ? saved : inputList[0] ?? ''
  })
  const [aux,setAux] = useState('')
  const [quality,setQuality] = useState('')
  const [thickness,setThickness] = useState(0)
  const [width,setWidth] = useState(0)
  const [extra,setExtra] = useState(false)
  const [scanMode,setScanMode] = useState<'lot'|'location'>()
  const [scan,setScan] = useState('')
  const [scannedLocation,setScannedLocation] = useState('')
  const [picks,setPicks] = useState<StockPick[]>([])
  const [pad,setPad] = useState<string>()
  const [message,setMessage] = useState('')
  const scanInput = useRef<HTMLInputElement>(null)
  const qualities = quality === '014' || quality === '015' ? ['014','015','019'] : quality ? [quality] : []
  const itemFor = (row: Balance) => catalog.items.find(spec => spec.code === row.lot.item)
  const candidates = view.balances.filter(row => {
    const spec = itemFor(row)
    return Number(row.quantity) > 0 && row.location.warehouse === (aux || warehouse) && !!spec
      && (!qualities.length || qualities.includes(spec.qualityCode)) && (!thickness || spec.thickness === thickness)
      && (!width || spec.width === width)
  })
  const extras = view.balances.filter(row => {
    const spec = itemFor(row)
    return Number(row.quantity) > 0 && spec?.extraMaterial && qualities.includes(spec.qualityCode)
  })
  const shown = extra ? extras : candidates
  function add(balance: Balance) {
    const key = stockKey(balance)
    const existing = picks.find(entry => stockKey(entry.balance) === key)
    if (existing && existing.quantity >= Number(balance.quantity)) {
      setMessage('투입수량이 재고 수량보다 높을 순 없습니다.'); return
    }
    setMessage('')
    setPicks(existing ? picks.map(entry => entry === existing ? {balance,quantity:entry.quantity + 1} : entry)
      : [...picks,{balance,quantity:1}])
  }
  function decrement(pick: StockPick) {
    setPicks(picks.flatMap(entry => entry !== pick ? [entry] : entry.quantity === 1 ? [] : [{...entry,quantity:entry.quantity-1}]))
  }
  function scanValue() {
    if (scanMode === 'location') {
      const location = view.locations.find(row => row.warehouse === warehouse && row.position === scan)
      if (!location) { setScan(''); setMessage('등록되지 않은 Location입니다. 다시 스캔하십시오.'); return }
      setScannedLocation(locationName(view,location))
      setScanMode(undefined)
    } else {
      const matches = shown.filter(row => row.lot.lot === scan)
      if (scan.length !== 10) setMessage('잘못된 정보입니다. 다시 스캔하십시오.')
      else if (!matches.length) setMessage('해당 Lot 번호가 리스트에 없습니다. 확인하십시오.')
      else if (matches.length > 1) setMessage('Lot 번호 1개에 로케이션이 여러개입니다. 확인 후 터치로 진행하십시오.')
      else add(matches[0])
    }
    setScan(''); scanInput.current?.focus()
  }
  function filterChanged() { setExtra(false); setScanMode(undefined); setMessage('') }
  const options = (keys: string[]): [string,string][] => keys.map(code => [code,catalog.warehouses[code]])
  const qualityOptions: [string,string][] = [...new Map(catalog.items.map(spec => [spec.qualityCode,spec.quality])).entries()]
  return <InventoryDialog label="재고 선택" className="inv-stock" onDismiss={onClose}>
    <header><Lookup label="투입창고" value={warehouse} options={options(inputList)} onChoose={code => {
      setWarehouse(code); setAux(''); localStorage.setItem(storageKey,code); filterChanged()
    }}/><Lookup label="재질" value={quality} options={qualityOptions} onChoose={code => {setQuality(code); filterChanged()}}/>
      <Lookup label="투입보조" value={aux} options={options(auxList)} onChoose={code => {
        setAux(code); setWarehouse(''); localStorage.setItem(storageKey,code); filterChanged()
      }}/></header>
    {scanMode === 'lot' ? <form onSubmit={event => {event.preventDefault(); scanValue()}}>
      <input ref={scanInput} autoFocus aria-label="Lot 번호 스캔" value={scan} onChange={e => setScan(e.target.value)}/>
      <button type="button" onClick={() => setScanMode(undefined)}>닫기</button>
    </form> : <button type="button" className="inv-scan" onClick={() => {setScan('');setScanMode('lot')}}>스캔으로 수량 추가하기</button>}
    {scanMode === 'location' && <InventoryDialog label="로케이션 스캔" className="inv-location-scan" onDismiss={() => {setScannedLocation('');setScanMode(undefined)}}>
      <form onSubmit={event => {event.preventDefault();scanValue()}}>
        <input ref={scanInput} autoFocus aria-label="로케이션 스캔" placeholder="Location 바코드를 스캔하세요." value={scan} onChange={e=>setScan(e.target.value)}/>
        <button type="button" onClick={()=>{setScannedLocation('');setScanMode(undefined)}}>닫기</button>
      </form>
    </InventoryDialog>}
    {message && <InventoryMessage text={message} onClose={()=>setMessage('')}/>}
    <div className="inv-stock-panes">
      <section aria-label="자재 목록"><header><h3>자재 목록</h3>
        <button type="button" aria-label="두께 검색" onClick={() => setPad('thickness')}>{thickness || '두께'}</button>
        <button type="button" aria-label="폭 검색" onClick={() => setPad('width')}>{width || '폭'}</button>
        <button type="button" aria-label="로케이션 스캔 열기" onClick={() => {setScan('');setScanMode('location')}}>{scannedLocation || '▣'}</button>
      </header><div><table><thead><tr>{['소분류명','재질명','두께','폭','길이','재고수량','추가'].map(col => <th key={col}>{col}</th>)}</tr></thead>
        <tbody>{shown.map(balance => {const spec=itemFor(balance)!
          return <tr key={stockKey(balance)}><td>{spec.kind}</td><td>{spec.quality}</td><td>{spec.thickness}</td><td>{spec.width}</td>
            <td>{spec.length}</td><td>{Number(balance.quantity)}</td><td><button type="button"
              aria-label={balance.lot.lot + ' ' + balance.location.position + ' 추가'} onClick={() => add(balance)}>＋</button></td></tr>
        })}</tbody></table></div></section>
      <span aria-hidden="true" className="inv-arrow">▶</span>
      <section aria-label="적용 목록"><header><h3>적용 목록</h3><button type="button" onClick={() => {
        if (!qualities.some(code => additionalQualities.includes(code))) return
        setExtra(true); if (extras.length) add(extras[0]); else setScanMode(undefined)
      }}>잔재 추가</button></header><div><table><thead><tr>{['창고명','로케이션명','재질명','두께','폭','길이','투입수량','삭제'].map(col => <th key={col}>{col}</th>)}</tr></thead>
        <tbody>{picks.map(pick => {const {balance,quantity}=pick; const spec=itemFor(balance)!
          return <tr key={stockKey(balance)}><td>{catalog.warehouses[balance.location.warehouse]}</td><td>{locationName(view,balance.location)}</td>
            <td>{spec.quality}</td><td>{spec.thickness}</td><td>{spec.width}</td><td>{spec.length}</td>
            <td><button type="button" aria-label={balance.lot.lot+' 투입수량'} onClick={() => setPad(stockKey(balance))}>{quantity}</button></td>
            <td><button type="button" aria-label={balance.lot.lot+' 삭제'} onClick={() => decrement(pick)}>−</button></td></tr>
        })}</tbody></table></div></section>
    </div><footer><button type="button" className="inv-apply" onClick={() => {
      if (!picks.length) setMessage('항목을 선택하십시오.'); else onApply(picks)
    }}>적용</button><button type="button" onClick={onClose}>닫기</button></footer>
    {pad && <InventoryPad label={pad === 'width' ? '폭 입력' : pad === 'thickness' ? '두께 입력' : '투입수량 입력'}
      decimal={pad === 'width' || pad === 'thickness'} onClose={() => setPad(undefined)} onApply={value => {
        if (pad === 'width' || pad === 'thickness') {
          if (pad === 'width') setWidth(value); else setThickness(value)
          filterChanged()
        } else setPicks(picks.map(pick => stockKey(pick.balance) === pad
          ? {...pick, quantity:Math.max(1,Math.min(value,Number(pick.balance.quantity)))} : pick))
        setPad(undefined)
      }}/>}
  </InventoryDialog>
}
