import TouchField from './TouchField'
import './floor-work.css'
import { useId, useRef, useState } from 'react'
import { createScanDispatcher } from './scan-contract'
import type { Mode, Route } from './scan-contract'

type Props = {
  actor: string
  modes: readonly { value: Mode; label: string }[]
  onRoute: (route: Route) => void
  disabled?: boolean
  label?: string
}

export default function ScanInput({ actor, modes, onRoute, disabled, label = '스캔 입력' }: Props) {
  const [mode, setMode] = useState(modes[0].value)
  const [text, setText] = useState('')
  const [notice, setNotice] = useState('')
  const inputId = useId()
  const sequence = useRef(0)
  const [dispatch] = useState(() => createScanDispatcher((route) => route))
  function deliver() {
    const result = dispatch({
      mode, text, terminator: 'Enter', focused: document.activeElement === document.getElementById(inputId),
      sessionKey: actor, eventId: String(++sequence.current),
    })
    if (result.status === 'DELIVERED') {
      onRoute(result.route)
      setNotice('')
      setText('')
    } else if (result.status === 'INVALID_INPUT') setNotice('스캔 형식을 확인해 주세요.')
  }
  return (
    <div className="floor-work floor-scan">
      {modes.length > 1 && <label>스캔 종류
        <select value={mode} disabled={disabled} onChange={(event) => {
          setMode(event.target.value as Mode)
          setNotice('')
        }}>{modes.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select>
      </label>}
      <TouchField label={label} id={inputId} layout={mode === 'work-order' ? 'decimal' : 'code'}
        disabled={disabled} value={text} onValueChange={setText} onKeyDown={event => {
          if (event.key !== 'Enter' || event.repeat || event.nativeEvent.isComposing) return
          event.preventDefault()
          deliver()
        }} />
      <button type="button" disabled={disabled || !text.trim()} onClick={() => {
        document.getElementById(inputId)?.focus()
        deliver()
      }}>스캔 확인</button>
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
