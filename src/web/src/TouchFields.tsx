import { Children, isValidElement, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { InputHTMLAttributes, ReactNode } from 'react'

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string
  onValue: (value: string) => void
}

export function TouchInput({ value, onValue, inputMode, ...props }: InputProps) {
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  const numeric = inputMode === 'decimal' || inputMode === 'numeric'
  function open() {
    if (!input.current || input.current.matches(':disabled')) return
    setName(props['aria-label'] || input.current.labels?.[0]?.textContent?.trim() || '수량')
    setDraft(value)
    dialog.current?.showModal()
  }
  return <>
    <input {...props} ref={input} value={value} inputMode={numeric ? 'none' : inputMode}
      onChange={event => onValue(event.target.value)}
      onPointerUp={event => { if (numeric && event.pointerType === 'touch') open() }}
      onKeyDown={event => { if (numeric && event.key === 'F2') { event.preventDefault(); open() } }} />
    {numeric && createPortal(<dialog ref={dialog} className="pop-number-pad" aria-labelledby={title}
      onClick={event => event.stopPropagation()} onClose={() => input.current?.focus()}>
      <h3 id={title}>{name}</h3><output aria-live="polite">{draft || '0'}</output>
      <div className="digits">{['7','8','9','4','5','6','1','2','3','0'].map(key =>
        <button type="button" key={key} onClick={() => setDraft(current => current + key)}>{key}</button>)}
        {inputMode === 'decimal' && <button type="button" disabled={draft.includes('.')}
          onClick={() => setDraft(current => (current || '0') + '.')}>.</button>}
        <button type="button" onClick={() => setDraft(current => current.slice(0, -1))}>한 자 삭제</button>
      </div>
      <div className="actions"><button type="button" onClick={() => setDraft('')}>지우기</button>
        <button type="button" onClick={() => dialog.current?.close()}>취소</button>
        <button type="button" onClick={() => {
          if (input.current?.isConnected && !input.current.matches(':disabled')) onValue(draft)
          dialog.current?.close()
        }}>입력 확인</button></div>
    </dialog>, document.body)}
  </>
}

type ChoiceProps = { value: string; disabled?: boolean; children: ReactNode; onValue: (value: string) => void }

export function TouchSelect({ value, disabled, children, onValue }: ChoiceProps) {
  return <span className="pop-touch-choice">
    <select value={value} disabled={disabled} onChange={event => onValue(event.target.value)}>{children}</select>
    <span className="pop-touch-options">{Children.map(children, child => {
      if (!isValidElement<{value?: string; children: string}>(child)) return null
      const id = child.props.value ?? child.props.children
      return <button type="button" disabled={disabled} aria-pressed={id === value}
        onClick={event => { event.preventDefault(); onValue(id) }}>{child.props.children}</button>
    })}</span>
  </span>
}
