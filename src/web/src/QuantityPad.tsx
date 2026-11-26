import { useRef, useState } from 'react'
import './logisticsTouch.css'

export function QuantityPad({ value, onApply, disabled }: {
  value: string
  onApply: (quantity: string) => void
  disabled?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState('')
  const [replace, setReplace] = useState(false)
  function press(key: string) {
    const previous = replace ? '' : draft
    setReplace(false)
    if (key === '지움') return setDraft(draft.slice(0, -1))
    if (key === '전체 삭제') return setDraft('')
    if (previous.length >= 19 || (key === '.' && previous.includes('.'))) return
    setDraft(previous === '' && key === '.' ? '0.' : previous + key)
  }
  return <>
    <button type="button" disabled={disabled} onClick={() => {
      setDraft(value)
      setReplace(true)
      dialog.current?.showModal()
    }}>수량 키패드</button>
    <dialog ref={dialog} aria-label="수량 입력">
      <output aria-live="polite">{draft || '0'}</output>
      <div className="logistics-keys">{['7','8','9','4','5','6','1','2','3','0','.','지움'].map(key =>
        <button type="button" key={key} onClick={() => press(key)}>{key}</button>)}</div>
      <button type="button" onClick={() => press('전체 삭제')}>전체 삭제</button>
      <button type="button" onClick={() => dialog.current?.close()}>취소</button>
      <button type="button" disabled={disabled || !/^\d+(\.\d+)?$/.test(draft) || Number(draft) <= 0}
        onClick={() => { onApply(draft); dialog.current?.close() }}>적용</button>
    </dialog>
  </>
}
