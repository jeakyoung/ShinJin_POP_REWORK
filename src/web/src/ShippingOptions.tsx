import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { FilterType, Option } from './shippingFilterSettings'

const titles = { customer: '거래처 검색', material: '재질 선택', kind: '품목유형', center: '작업반' }
function ShippingDialog({ title, className, children }: { title: string; className: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} className={className} aria-label={title} onCancel={event => event.preventDefault()}>
    {children}
  </dialog>
}

export function ShippingOptions({ type, options, selected, onSave, onClose }: {
  type: FilterType; options: Option[]; selected: string[]; onSave: (selected: string[]) => void; onClose: () => void
}) {
  const [checks, setChecks] = useState(selected)
  const title = titles[type]
  return <ShippingDialog className={'ship-options ship-option-' + type} title={title}>
    <header><img src={type === 'material' ? '/shipping/material.png' : '/shipping/option.png'} alt="" />{title}<button aria-label="닫기" onClick={onClose}>×</button></header>
    <div className="ship-option-scroll"><table><colgroup>
      {(type === 'material' ? [20,20,20,40] : [25,25,50]).map((size, i) => <col key={i} style={{width:size+'%'}} />)}
    </colgroup><thead><tr>
      <th><button onClick={() => setChecks(checks.length === options.length ? [] : options.map(o => o.code))}>{type === 'material' ? '사용' : '선택'}</button></th>
      {type === 'material' && <th>순번</th>}<th>{type === 'material' ? '재질코드' : '코드'}</th>
      <th>{type === 'material' ? '재질명' : title}</th>
    </tr></thead><tbody>{options.map((o,i) => <tr key={o.code} aria-selected={checks.includes(o.code)}
      onClick={() => setChecks(checks.includes(o.code) ? checks.filter(v => v !== o.code) : [...checks, o.code])}>
      <td><input autoFocus={i === 0} aria-label={o.code + ' 선택'} type="checkbox" checked={checks.includes(o.code)} readOnly /></td>
      {type === 'material' && <td>{i+1}</td>}<td>{o.code}</td><td>{o.name}</td></tr>)}</tbody></table></div>
    <footer><button onClick={() => onSave(checks)}>저장</button><button onClick={onClose}>취소</button></footer>
  </ShippingDialog>
}

export function ShippingCustomer({ options, onSave, onClose }: {
  options: Option[]; onSave: (customer: Option) => void; onClose: () => void
}) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState('')
  const rows = options.filter(row => [row.code, row.name, row.abbreviation].some(v => v?.toLowerCase().includes(query.toLowerCase())))
  const selected = rows.find(row => row.code === chosen) ?? rows[0]
  function search() { setQuery(input.trim()); setChosen('') }
  return <ShippingDialog title="거래처 검색" className="ship-customer">
    <header>거래처 검색</header><div className="ship-customer-tools"><span><input autoFocus aria-label="거래처명 검색" placeholder="거래처명 검색" value={input}
      onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search() }} />
      <button aria-label="검색" onClick={search}><img src="/shipping/customer-search.svg" alt="" /></button></span><button onClick={() => setInput('')}>Clear</button>
      <button aria-label="키보드" onClick={() => {
        const el = document.querySelector<HTMLInputElement>('.ship-customer-tools input')
        el?.focus(); (navigator as Navigator & { virtualKeyboard?: { show(): void } }).virtualKeyboard?.show()
      }}><img src="/shipping/keyboard.svg" alt="" /></button></div>
    <div className="ship-customer-list"><table><thead><tr><th>No</th><th>거래처 코드</th><th>거래처명</th><th>약어</th></tr></thead>
    <tbody>{rows.map((row,i) => <tr key={row.code} aria-selected={selected?.code === row.code} onClick={() => setChosen(row.code)}
      ><td>{i+1}</td><td>{row.code}</td><td>{row.name}</td><td>{row.abbreviation}</td></tr>)}</tbody></table></div>
    <footer><button onClick={() => { if (selected) onSave(selected); else window.alert('선택 된 거래처가 없습니다.') }}>적용</button><button onClick={onClose}>닫기</button></footer>
  </ShippingDialog>
}
