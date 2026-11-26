import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { locationName } from './inventoryApi'
import type { InventoryView } from './inventoryApi'

export function InventoryDialog({ label, className, onDismiss, children }: {
  label: string; className: string; onDismiss: () => void; children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog ref={dialog} aria-label={label} className={'inv-dialog ' + className} onCancel={event => {
    event.preventDefault()
    event.stopPropagation()
    onDismiss()
  }}>{children}</dialog>
}

export function InventoryMessage({ text, onClose, onYes }: {text:string; onClose:()=>void; onYes?:()=>void}) {
  return <InventoryDialog label="확인" className="inv-message" onDismiss={onClose}>
    <p>{text}</p><footer>{onYes && <button type="button" className="inv-apply" onClick={onYes}>예</button>}
      <button type="button" onClick={onClose}>{onYes?'아니오':'확인'}</button></footer></InventoryDialog>
}

export function Lookup({ label, value, options, onChoose }: {
  label: string; value: string; options: [string,string][]; onChoose: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  return <div className="inv-lookup">
    <span>{label}</span><button type="button" aria-label={label + ' 검색'} onClick={() => { setSearch(''); setOpen(true) }}>
      {options.find(([key]) => value === key)?.[1]}<span aria-hidden="true">⌕</span></button>
    {open && <InventoryDialog label={label + ' 검색'} className="inv-options" onDismiss={() => setOpen(false)}>
      <input autoFocus aria-label={label + ' 검색어'} value={search} onChange={event => setSearch(event.target.value)} />
      <table><thead><tr><th>코드</th><th>{label}명</th></tr></thead><tbody>
        {options.filter(parts => parts.some(part => part.toLowerCase().includes(search.toLowerCase())))
          .map(([key,name]) => <tr key={key}><td>{key}</td><td><button type="button" onClick={() => {
            onChoose(key); setOpen(false)
          }}>{name}</button></td></tr>)}
      </tbody></table><button type="button" onClick={() => setOpen(false)}>닫기</button>
    </InventoryDialog>}
  </div>
}

export function PairDialog({ view, mode, current, onApply, onClose }: {
  view: InventoryView; mode: 'header' | 'row'; current: [string,string]
  onApply: (first: string, second: string) => void; onClose: () => void
}) {
  const [first,setFirst] = useState(current[0])
  const [second,setSecond] = useState(current[1])
  const [notice,setNotice] = useState('')
  const [confirm,setConfirm] = useState(false)
  const header = mode === 'header'
  const firstLabel = header ? '사업장' : '창고'
  const secondLabel = header ? '창고' : 'Location'
  const warehouseOptions = Object.entries(view.catalog.warehouses)
  const secondOptions: [string,string][] = header ? (first ? warehouseOptions : []) : view.locations
    .filter(loc => loc.warehouse === first).map(loc => [loc.position, locationName(view,loc)])
  return <InventoryDialog label={firstLabel + ' 및 ' + secondLabel} className="inv-pair" onDismiss={onClose}>
    <Lookup label={firstLabel} value={first} options={header ? Object.entries(view.catalog.plants) : warehouseOptions}
      onChoose={value => { if (first !== value) setSecond(''); setFirst(value) }} />
    <Lookup label={secondLabel} value={second} options={secondOptions} onChoose={setSecond} />
    {notice && <InventoryMessage text={notice} onClose={()=>setNotice('')}/>}
    <button type="button" className="inv-apply" onClick={() => {
      if (!first || !second) { setNotice((!first ? firstLabel : secondLabel) + '를 입력하십시오.'); return }
      setConfirm(true)
    }}>적용</button><button type="button" onClick={onClose}>취소</button>
    {confirm && <InventoryMessage text={firstLabel+' 및 '+secondLabel+' 정보를 적용하시겠습니까?'}
      onClose={()=>setConfirm(false)} onYes={()=>onApply(first,second)}/>}
  </InventoryDialog>
}

export function InventoryPad({ label, onApply, onClose, decimal = false }: {
  label: string; onApply: (value: number) => void; onClose: () => void; decimal?: boolean
}) {
  const [draft,setDraft] = useState('0')
  function press(key: string) {
    if (key === 'C') setDraft('0')
    else if (key === '←') setDraft(old => old.slice(0,-1) || '0')
    else if (key === '.') setDraft(old => old.includes('.') ? old : old + '.')
    else setDraft(old => old === '0' ? key : (decimal ? old : Number(old).toLocaleString('en-US')).length < 8 ? old + key : old)
  }
  return <InventoryDialog label={label} className="inv-pad" onDismiss={onClose}>
    <output>{decimal ? draft : Number(draft).toLocaleString('en-US')}</output>
    <div>{['1','2','3','4','5','6','7','8','9','C','0',decimal ? '.' : '←'].map(key =>
      <button type="button" key={key} onClick={() => press(key)}>{key}</button>)}</div>
    <footer><button type="button" className="inv-apply" onClick={() => onApply(Number(draft))}>적용</button>
      <button type="button" onClick={onClose}>취소</button></footer>
  </InventoryDialog>
}
