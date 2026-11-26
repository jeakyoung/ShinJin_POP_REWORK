import { useRef, useState } from 'react'
import type { ProductionReturn } from './basketApi'
import './BasketReturnGrid.css'

export default function BasketReturnGrid({ rows, disabled, revision, onSave, selected, onSelect }: {
  rows: ProductionReturn[]
  disabled: boolean
  revision: number
  onSave: (sequence: number, quantity: string, revision: number) => void
  selected: number[]
  onSelect: (rows:number[]) => void
}) {
  const pad = useRef<HTMLDialogElement>(null)
  const [edit, setEdit] = useState<{ sequence: number; original: string; revision: number }>()
  const [draft, setDraft] = useState('0')
  function finish(quantity: string) {
    if (!edit) return
    pad.current?.close()
    onSave(edit.sequence, quantity, edit.revision)
    setEdit(undefined)
  }
  function press(key: string) {
    if (key === 'C') setDraft('0')
    else if (key === '.') setDraft(old => old.includes('.') ? old : old + '.')
    else setDraft(old => old === '0' ? key : old.length < 8 ? old + key : old)
  }
  return <section className="basket-return-grid" aria-label="작업 중 반납자재">
    <h3>반납자재</h3>
    <table><thead><tr>{['선택','창고','로케이션','재질','두께','폭','길이','반납수량'].map(title => <th key={title}>{title}</th>)}</tr></thead>
      <tbody>{rows.map(({sequence, line, material},index) => <tr key={sequence}>
        <td><input type="checkbox" aria-label={'반납자재 ' + sequence + ' 선택'} checked={selected.includes(index)}
          onChange={event => onSelect(event.target.checked ? [...selected,index] : selected.filter(id => id !== index))} /></td>
        <td>{material?.warehouseName}</td><td>{material?.locationName}</td><td>{material?.qualityName}</td>
        <td>{material?.thickness}</td><td>{material?.width}</td><td>{line.length}</td>
        <td><button type="button" aria-label={'반납수량 ' + sequence + '행'} disabled={disabled} onClick={() => {
          setDraft('0')
          setEdit({ sequence, original: String(line.quantity), revision })
          pad.current?.showModal()
        }}>{line.quantity}</button></td>
      </tr>)}</tbody></table>
    <dialog className="basket-return-pad" ref={pad} aria-label="반납수량 입력" onCancel={event => {
      event.preventDefault()
      if (edit) finish(edit.original)
    }}>
      <output aria-live="polite">{draft}</output>
      <div className="basket-number-keys">{['1','2','3','4','5','6','7','8','9','C','0','.'].map(key =>
        <button type="button" key={key} onClick={() => press(key)}>{key}</button>)}</div>
      <div className="basket-pad-actions"><button type="button" onClick={() => finish(String(Number(draft)))}>적용</button>
        <button type="button" onClick={() => { if (edit) finish(edit.original) }}>취소</button></div>
    </dialog>
  </section>
}
