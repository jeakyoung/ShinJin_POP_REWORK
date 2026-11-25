import { useRef, useState } from 'react'
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
  const input = useRef<HTMLInputElement>(null)
  const sequence = useRef(0)
  const [dispatch] = useState(() => createScanDispatcher((route) => route))
  return (
    <div>
      {modes.length > 1 && <label>스캔 종류
        <select value={mode} disabled={disabled} onChange={(event) => {
          setMode(event.target.value as Mode)
          setNotice('')
        }}>{modes.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select>
      </label>}
      <label>{label}
        <input ref={input} disabled={disabled} value={text} onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.repeat || event.nativeEvent.isComposing) return
            event.preventDefault()
            const result = dispatch({
              mode, text, terminator: event.key, focused: document.activeElement === input.current,
              sessionKey: actor, eventId: String(++sequence.current),
            })
            if (result.status === 'DELIVERED') {
              onRoute(result.route)
              setNotice('')
              setText('')
            } else if (result.status === 'INVALID_INPUT') setNotice('스캔 형식을 확인해 주세요.')
          }} />
      </label>
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
