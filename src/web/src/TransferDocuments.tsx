import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Action, Command, DocumentId, OutputList, TransferMaster, TransferState } from './transferApi'
import TransferGrid from './TransferGrid'
import type { GridRecord } from './TransferGrid'
import type { Message } from './TransferMessage'
import TransferOutputList from './TransferOutputList'
import shippingForm from './transferForm9.json'
import receiptForm from './transferForm3.json'
import './transferDocuments.css'

type Props = {
  receipt: boolean; state: TransferState; master: TransferMaster; locked: boolean
  refresh: () => void; submit: (command: Command) => void
  preview: (ids: DocumentId[], show: (report: OutputList) => void) => void
  notice: (text: string) => void; ask: (message: Message) => void
}
type Filters = ReturnType<typeof initialFilters>
type Side = 'left' | 'right'

function initialFilters(master: TransferMaster) {
  const today = new Date()
  const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-')
  const plant = master.terminalPlant ?? ''
  return { dtFrom: date.slice(0, 8) + '01', dtTo: date, dtFromOut: date, dtToOut: date,
    dtOutDateFrom: date, dtOutDateTo: date, gluOutPlant: plant,
    gluInPlant: plant ? (plant === '000001' ? '000002' : '000001') : '', gluOutWarehouse: '', gluInWarehouse: '' }
}

const labels: Record<string, string> = {
  gluOutPlant: '출고사업장', gluInPlant: '입고사업장', gluOutWarehouse: '출고창고', gluInWarehouse: '입고창고',
  dtFrom: '요청 시작일', dtTo: '요청 종료일', dtFromOut: '출고 시작일', dtToOut: '출고 종료일',
  dtOutDateFrom: '출고 시작일', dtOutDateTo: '출고 종료일',
}

export default function TransferDocuments({ receipt, state, master, locked, refresh, submit, preview, notice, ask }: Props) {
  const layout = receipt ? receiptForm : shippingForm
  const [filters, setFilters] = useState(() => initialFilters(master))
  const [queries, setQueries] = useState<Partial<Record<Side, Filters>>>({})
  const [focus, setFocus] = useState<Partial<Record<Side, number>>>({})
  const [checked, setChecked] = useState<number[]>([])
  const [auto, setAuto] = useState(false)
  const [popup, setPopup] = useState('')
  const [report, setReport] = useState<OutputList | null>(null)
  const form = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!popup) return
    function outside(e: PointerEvent) {
      if (!(e.target instanceof Element) || !e.target.closest('.transfer-lookup, .transfer-options')) setPopup('')
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') { setPopup(''); form.current?.querySelector<HTMLButtonElement>('#' + popup)?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [popup])
  const titles = receipt ? ['미입고 출고 리스트', '출고 품목', '입고 리스트', '입고 품목']
    : ['출고요청 리스트', '출고요청 품목', '출고 리스트', '출고 품목']

  function search(side: Side, next = filters) {
    if (![next.gluOutPlant, next.gluInPlant].every(id => master.plants.some(p => p.CODE_ID2 === id))) {
      notice('사업장을 모두 선택 해주세요.'); return
    }
    setQueries(old => ({ ...old, [side]: next }))
    setFocus(old => ({ ...old, [side]: undefined }))
    if (side === 'left') setChecked([])
    refresh()
  }
  function list(side: Side) {
    const q = queries[side]
    if (!q) return []
    const right = side === 'right'
    const kind = receipt ? (right ? 'RECEIVE' : 'SHIP') : (right ? 'SHIP' : 'REQUEST')
    return state.documents.filter(doc => {
      if (doc.id.kind !== kind) return false
      const transfer = state.transfers.find(row => row.request === doc.id.request)
      if (!transfer || !transfer.documents[kind] || transfer.documents[kind]?.revision !== doc.id.revision) return false
      if (!right && transfer.status !== (receipt ? 'SHIPPED' : 'REQUESTED')) return false
      const matches = (code: string, site: string, etc: string) =>
        master.warehouses.some(w => w.WAREHOUSE_CODE === code && w.PLANT_CODE === site && (!etc || w.ETC === etc))
      if (!matches(transfer.draft.source, q.gluOutPlant, q.gluOutWarehouse)) return false
      if ((receipt || !right) && !matches(transfer.draft.destination, q.gluInPlant, q.gluInWarehouse)) return false
      const day = state.documentDates?.[doc.id.revision]
      if (!day) return false
      if (receipt) return day === q.dtOutDateFrom && day <= q.dtOutDateTo
      return right ? day >= q.dtFromOut && day <= q.dtToOut : day >= q.dtFrom && day <= q.dtTo
    })
  }
  const left = list('left'), right = list('right')
  function selected(side: Side) {
    const rows = side === 'left' ? left : right
    return rows.find(d => d.id.revision === focus[side]) ?? rows[0]
  }
  function commit(id: DocumentId, action: Action) {
    if (locked || state.pending.some(p => p.request === id.request)) return
    function send() {
      submit({ request: id.request, sourceDocument: id, commandId: crypto.randomUUID(), action, autoReceive: action === 'SHIP' && auto })
    }
    if (action === 'UNDO_RECEIVE' || action === 'UNDO_SHIP') {
      ask({ text: '선택한 항목을 삭제하시겠습니까?\n(삭제 후 취소하실 수 없습니다.)', yes: send })
    } else send()
  }
  function onButton(id: string) {
    if (id === 'btnPrint') {
      const docs = left.filter(d => checked.includes(d.id.revision)).map(d => d.id)
      if (!docs.length) return notice('출력하실 데이터를 선택하십시오.')
      preview(docs, setReport); return
    }
    if (id === 'saveBtn' || id === 'btnInSave') {
      const doc = selected('left')
      if (!doc) return notice(receipt ? '입고 품목을 선택 해주세요.' : '출고요청 품목을 선택 해주세요.')
      commit(doc.id, receipt ? 'RECEIVE' : 'SHIP'); return
    }
    search((receipt ? id === 'btnInSearch' : id === 'btnOutSearch') ? 'right' : 'left')
  }
  function rows(index: number): GridRecord[] {
    const side = index < 2 ? 'left' : 'right'
    const doc = selected(side)
    const q = queries[side]
    const warehouse = (code: string, site?: string) => master.warehouses.find(w => w.WAREHOUSE_CODE === code && (!site || w.PLANT_CODE === site))?.WAREHOUSE_NAME
    if (index % 2) {
      const transfer = state.transfers.find(t => t.request === doc?.id.request)
      return (doc?.lines ?? []).map(({ line }) => ({
        key: String(line.number), fields: { STND_ITEM: state.reportLines?.[doc!.id.request]?.find(r => r.NO_LINE === line.number)?.STND_ITEM,
          CD_ITEM: line.item, QT: line.quantity, QT_GOOD_INV: line.quantity, NO_IOLINE: line.number,
          NM_SL: transfer && warehouse(line.source ?? transfer.draft.source, line.source ? undefined : q?.gluOutPlant), NM_GRSL: transfer && warehouse(line.destination ?? transfer.draft.destination, line.destination ? undefined : q?.gluInPlant),
          OUT_SL: transfer && warehouse(line.source ?? transfer.draft.source, line.source ? undefined : q?.gluOutPlant), IN_SL: transfer && warehouse(line.destination ?? transfer.draft.destination, line.destination ? undefined : q?.gluInPlant) },
      }))
    }
    return (side === 'left' ? left : right).map(({ id }) => {
      const out = master.plants.find(p => p.CODE_ID2 === q?.gluOutPlant)?.CODE_NAME_FULL
      const destCode = state.transfers.find(t => t.request === id.request)?.draft.destination
      const plants = [...new Set(master.warehouses.filter(w => w.WAREHOUSE_CODE === destCode).map(w => w.PLANT_CODE))]
      const incoming = plants.length === 1 ? master.plants.find(p => p.CODE_ID2 === plants[0])?.CODE_NAME_FULL : undefined
      const header = state.headers?.[id.revision]
      return { key: String(id.revision), selected: doc?.id.revision === id.revision,
        focus: () => setFocus(old => ({ ...old, [side]: id.revision })), fields: {
          NO_GIREQ: id.request, NO_IO: header?.number, NM_DEPT: header?.department, NM_KOR: header?.worker, DC50_PO: header?.remark, DT_IO: state.documentDates?.[id.revision], DT_GIREQ: state.documentDates?.[id.revision],
          NM_PLANT: out, NM_GRPLANT: incoming, OUT_PLANT: out, IN_PLANT: incoming,
          chk: <input type="checkbox" aria-label={id.request + ' 출력'} checked={checked.includes(id.revision)} onChange={e =>
            setChecked(old => e.target.checked ? [...old, id.revision] : old.filter(rev => rev !== id.revision))} />,
          삭제: <button className="transfer-delete" type="button" aria-label={id.request + ' 삭제'} disabled={locked}
            onClick={() => commit(id, receipt ? 'UNDO_RECEIVE' : 'UNDO_SHIP')}><img src={import.meta.env.BASE_URL + 'transfer/delete_32x32.png'} alt="" /></button>,
        } }
    })
  }
  function options(id: string) {
    if (id.endsWith('Plant')) return master.plants.map(p => ({ key: p.CODE_ID2, code: p.ETC, name: p.CODE_NAME_FULL }))
    const plant = id === 'gluOutWarehouse' ? filters.gluOutPlant : filters.gluInPlant
    return [{ key: '', code: '', name: '전체' }, ...master.warehouses.filter(w => w.PLANT_CODE === plant)
      .map(w => ({ key: w.ETC, code: w.ETC, name: w.WAREHOUSE_NAME }))]
  }
  function choose(id: string, value: string) {
    const next = { ...filters, [id]: value }
    if (id.endsWith('Plant')) next[id === 'gluOutPlant' ? 'gluOutWarehouse' : 'gluInWarehouse'] = ''
    setFilters(next); setPopup('')
    if (id.endsWith('Plant')) {
      search('left', next)
      if (receipt) search('right', next)
    }
    form.current?.querySelector<HTMLButtonElement>('#' + id)?.focus()
  }
  return <div className="transfer-document-scroll"><div className="transfer-form transfer-document-form" ref={form}>
    {layout.controls.map(({ id, kind, rect: [left, top, width, height], text, style: paint }) => {
      const style: CSSProperties = { ...paint, position: 'absolute', left, top, width, height, minHeight: 0, minWidth: 0 }
      if (kind === 'Panel') return <div key={id} style={style} aria-hidden />
      if (kind === 'LabelControl') return <span className="transfer-caption" key={id} style={style}>{text}</span>
      if (kind === 'SimpleButton') return <button key={id} id={id} type="button" style={style} disabled={locked} onClick={() => onButton(id)}>{text}</button>
      if (kind === 'CheckEdit') return <label key={id} style={style} className="transfer-auto"><input type="checkbox"
        aria-label="자동 입고" checked={auto} onChange={e => setAuto(e.target.checked)} disabled={locked} /></label>
      const field = id as keyof Filters
      if (kind === 'DateEdit') {
        const other = ({ dtFrom: 'dtTo', dtTo: 'dtFrom', dtFromOut: 'dtToOut', dtToOut: 'dtFromOut', dtOutDateFrom: 'dtOutDateTo', dtOutDateTo: 'dtOutDateFrom' } as Record<string, keyof Filters>)[id]
        return <label key={id} className="transfer-date-box" style={style}><span aria-hidden>{filters[field]}</span><input type="date" aria-label={labels[id]} value={filters[field]} disabled={locked}
          min={id.includes('To') ? filters[other] : undefined} max={id.includes('From') ? filters[other] : undefined}
          onChange={e => { if (e.target.value && e.target.validity.valid) setFilters({ ...filters, [id]: e.target.value }) }} /></label>
      }
      if (kind === 'GridLookUpEdit') return <button key={id} id={id} type="button" aria-label={labels[id]}
        style={style} className="transfer-lookup" aria-expanded={popup === id} disabled={locked}
        onClick={() => setPopup(popup === id ? '' : id)}>{options(id).find(p => p.key === filters[field])?.name}
        <img src={import.meta.env.BASE_URL + 'transfer/lookup.svg'} alt="" /></button>
      const index = Number(id.slice(2)) - 1
      return <TransferGrid key={id} title={titles[index]} style={style} columns={layout.grids[index]} rows={rows(index)} />
    })}
    {popup && (() => {
      const lookup=layout.controls.find(c=>c.id===popup)!
      const [x,y,,height]=lookup.rect
      const [width,popupHeight]=lookup.popup??[500,400]
      const columns=lookup.optionColumns??[]
      const columnStyle={gridTemplateColumns:columns.map(col=>String(col[2])+'px').join(' ')}
      return <div className="transfer-options" role="listbox" aria-label={labels[popup]}
        style={{left:Math.min(x,1280-width),top:y+height,width,height:popupHeight}}>
        <div className="transfer-options-heading" style={columnStyle}>{columns.map(col=><span key={col[1]}>{col[0]}</span>)}</div>
        {options(popup).map(o => <button key={o.key} type="button" role="option" aria-selected={o.key===filters[popup as keyof Filters]}
          style={columnStyle} onClick={()=>choose(popup,o.key)}><span>{o.code}</span><span>{o.name}</span></button>)}
      </div>
    })()}
    {report && <TransferOutputList report={report} onClose={() => setReport(null)} />}
  </div></div>
}
