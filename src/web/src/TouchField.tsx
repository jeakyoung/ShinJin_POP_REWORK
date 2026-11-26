import { useId, useRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  label: string
  value: string
  onValueChange: (value: string) => void
  layout?: 'code' | 'decimal'
  editableKeypad?: boolean
}

export default function TouchField({ label, value, onValueChange, layout = 'code', editableKeypad = false, ...input }: Props) {
  const title = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState('')
  const [lower, setLower] = useState(false)
  const keys = layout === 'decimal' ? '7894561230.' : '1234567890QWERTYUIOPASDFGHJKLZXCVBNM-:'
  const decimal = layout === 'decimal'
  const validDraft = !decimal || /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(draft)
  function open() {
    setDraft(decimal ? '' : value)
    setLower(false)
    dialog.current?.showModal()
  }
  function close() {
    dialog.current?.close()
    setDraft('')
  }
  return <div className="pop-field">
    <label>{label}<input {...input} onClick={event => {
      input.onClick?.(event)
      if (decimal && 'pointerType' in event.nativeEvent && event.nativeEvent.pointerType === 'touch' && !event.defaultPrevented) open()
    }} value={value} onChange={e => onValueChange(e.target.value)} /></label>
    <button type="button" disabled={input.disabled} aria-label={label + ' 키패드'} onClick={open}>키패드</button>
    <dialog ref={dialog} aria-labelledby={title} className="pop-keypad" onClose={() => setDraft('')}>
      <h2 id={title}>{label}</h2>
      {editableKeypad ? <input aria-label={label + ' 키패드 입력란'} type={input.type ?? 'text'}
        autoComplete="off" autoFocus maxLength={input.maxLength} readOnly={input.readOnly}
        value={draft} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onValueChange(draft)
            close()
          }
        }} /> : <output>{input.type === 'password' ? '•'.repeat(draft.length) : draft}</output>}
      <div className={'pop-keys ' + layout}>{[...(lower ? keys.toLowerCase() : keys)].map(key =>
        <button type="button" key={key} onClick={() => setDraft(old => {
          if (input.maxLength !== undefined && old.length >= input.maxLength) return old
          if (layout === 'decimal' && key === '.' && old.includes('.')) return old
          return old + key
        })}>{key}</button>)}</div>
      <div className="pop-key-actions">
        {layout === 'code' && <button type="button" onClick={() => setLower(!lower)}>대소문자</button>}
        <button type="button" onClick={() => setDraft(draft.slice(0,-1))}>한 글자 삭제</button>
        <button type="button" onClick={() => setDraft('')}>전체 삭제</button>
        <button type="button" onClick={close}>취소</button>
        <button type="button" disabled={input.disabled || !validDraft} onClick={() => {
          onValueChange(decimal ? draft.replace(/^\./, '0.').replace(/\.$/, '') : draft)
          close()
        }}>입력 확인</button>
      </div>
    </dialog>
  </div>
}
