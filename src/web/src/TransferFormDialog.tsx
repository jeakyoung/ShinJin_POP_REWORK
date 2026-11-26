import { useLayoutEffect, useRef, useState } from 'react'
import dialogs from './transferFormDialogs.json'
import { position } from './transferFormTypes'
import type { FormRecord, RectControl } from './transferFormTypes'
import type { Message } from './TransferMessage'

type Option = { code: string; name: string; etc?:string }
export type Pick = {
  name: keyof typeof dialogs
  plant?: string; value?: string
  options?: Option[]; warehouses?: (Option & { plant: string })[]
  records?: FormRecord[]; qualityName?: (code: string) => string
  apply: (value: string, plant: string) => void
}
export function Lookup({id, label, options, value, change, control, disabled}: {
  id: string; label: string; options: Option[]; value: string; change: (v: string) => void; disabled?: boolean; control: RectControl
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const list=panel.current, anchor=ref.current
    if (!open || !list || !anchor) return
    const place=()=>{
      const rect=anchor.getBoundingClientRect(), width=Math.min(control.popup?.[0]??rect.width,window.innerWidth)
      const height=Math.min(control.popup?.[1]??300,window.innerHeight)
      list.style.width=width+'px'
      list.style.height=height+'px'
      list.style.left=Math.max(0,Math.min(rect.left,window.innerWidth-width))+'px'
      list.style.top=(rect.bottom+height<=window.innerHeight?rect.bottom:Math.max(0,rect.top-height))+'px'
    }
    const outside=(e:PointerEvent)=>{if(e.target instanceof Node&&!anchor.contains(e.target))setOpen(false)}
    list.showPopover();place()
    window.addEventListener('resize',place)
    window.addEventListener('scroll',place,true)
    document.addEventListener('pointerdown',outside,true)
    return ()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('pointerdown',outside,true);if(list.matches(':popover-open'))list.hidePopover()}
  },[open,control])
  const size = position(control)
  const cols=control.optionColumns??[]
  const widths=cols.map(c=>String(c[2])+'px').join(' ')
  return <div ref={ref} className="entry-lookup" style={{...size,zIndex:open?5:undefined}} onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
  }} onKeyDown={e => { if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); ref.current?.querySelector('button')?.focus() } }}>
    <button type="button" id={id} disabled={disabled} aria-label={label} aria-expanded={open} onClick={() => setOpen(v => !v)}>
      {options.find(o => o.code === value)?.name}<img src="/transfer/lookup.svg" alt="" />
    </button>
    {open && <div ref={panel} popover="manual" className="entry-options" role="listbox" aria-label={label} style={{width:control.popup?.[0],height:control.popup?.[1]}}>
      <div className="entry-options-heading" style={{gridTemplateColumns:widths}}>{cols.map(c=><span key={c[1]}>{c[0]}</span>)}</div>
      {options.map(o => <button type="button" key={o.code} style={{gridTemplateColumns:widths}} role="option" aria-selected={o.code === value}
        onClick={() => { change(o.code); setOpen(false); ref.current?.querySelector('button')?.focus() }}>
         {cols.map(c=><span key={c[1]}>{String(c[1]).toLowerCase().includes('etc') ? o.etc : String(c[1]).toLowerCase().includes('name') ? o.name : o.code}</span>)}</button>)}
    </div>}
  </div>
}

export default function TransferFormDialog({pick, close, ask}: {pick: Pick; close: () => void; ask: (m: Message) => void}) {
  const [v, set] = useState(pick.value ?? '')
  const [plant, setPlant] = useState(pick.plant ?? '')
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { ref.current?.showModal() }, [])
  const layout = dialogs[pick.name]
  const pad = pick.name.startsWith('ComNumeric')
  const done = () => { pick.apply(v || '0', plant); close() }
  function apply() {
    if (pad) return done()
    const doc = pick.name === 'ComOutputReq', route = pick.name === 'ComPlantWarehouse'
    const field = route ? '창고' : pick.name === 'ComItemKind3' ? '품목유형' : '재질'
    if (doc && !pick.records?.length) return ask({text:'등록된 이송의뢰가 없습니다.\n확인하십시오.'})
    if (route && !plant) return ask({text:'사업장을 입력하십시오.'})
    if (!v) return ask({text:doc ? '조회할 대상을 선택하십시오.' : field+'를 입력하십시오.'})
    ask({text:doc ? '선택한 출고정보를 조회하시겠습니까?' : (route ? '사업장 및 창고' : field)+' 정보를 적용하시겠습니까?',yes:done})
  }
  function control(c: RectControl) {
    const {id,kind,text} = c, style=position(c)
    if (kind.includes('Panel')) return <div key={id} style={{...style,pointerEvents:'none'}} />
    if (kind === 'GridLookUpEdit') {
      const isPlant = id === 'gluPlant', wh = id === 'gluWarehouse'
      return <Lookup key={id} id={id} control={c} label={isPlant ? '사업장' : wh ? '창고' : pick.name === 'ComItemKind3' ? '품목유형' : '재질'}
        options={(wh ? pick.warehouses?.filter(o=>o.plant===plant) : pick.options) ?? []} value={isPlant ? plant : v}
        change={code=>{ if (isPlant) {setPlant(code);set('')} else set(code) }} />
    }
    if (kind === 'GridControl') return <div key={id} className="entry-doc-list" style={style}>
      <table><colgroup>{[55,150,150,150,86,97].map((width,i)=><col key={i} style={{width}}/>)}</colgroup><thead><tr>{['선택','출고의뢰번호','재질','의뢰 건수','의뢰자','의뢰일'].map(s=><th key={s}>{s}</th>)}</tr></thead>
      <tbody>{pick.records?.map(doc=><tr key={doc.number} aria-selected={v===doc.number||(!v&&doc===pick.records?.[0])}><td><input aria-label={doc.number} type="checkbox" checked={v===doc.number}
        onChange={()=>set(v===doc.number?'':doc.number)} /></td><td>{doc.number}</td>
        <td>{[...new Set(doc.lines.map(l=>pick.qualityName?.(l.spec.quality)))].join(', ')}</td>
        <td>{doc.lines.length}</td><td>{doc.worker}</td><td>{doc.day}</td></tr>)}</tbody></table></div>
    if (kind === 'SimpleButton') return <button type="button" key={id} id={id} style={style} onClick={()=>{
      if (id==='btnClose') close()
      else if (id==='btnApply'||id==='btnOk') apply()
      else if (id==='btnClear') set('0')
      else if (id==='btnBackSpace') set(v.slice(0,-1)||'0')
      else if (id==='btnDecimalPoint') { if(!v.includes('.')) set((v||'0')+'.') }
      else if (v.length<8) set(v==='0'?text:v+text)
    }}>{text}</button>
    return <span key={id} style={style} className="transfer-caption">{id==='lblInOutPut' ? v||'0' : text}</span>
  }
  return <dialog className="entry-modal" ref={ref} style={{width:layout.size[0],height:layout.size[1]}} aria-label={pick.name} onCancel={close}>
    <div className="transfer-form entry-dialog" style={{width:layout.size[0],height:layout.size[1]}}>{layout.controls.map(control)}</div>
  </dialog>
}
