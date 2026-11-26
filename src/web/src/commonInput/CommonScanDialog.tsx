import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './commonScanDialog.css'

type Mode = 'integrated' | 'integrated-employee' | 'order' | 'material'
type Result = 'ok' | 'cancel'
export type ScanOutcome =
  | { next: 'retry' }
  | { next: 'continue'; closeResult?: Result }
  | { next: 'close'; result: Result }

type Props = {
  mode: Mode
  position: { left: number; top: number }
  onEnter: (raw: string, signal: AbortSignal) => Promise<ScanOutcome>
  onError: (error: unknown) => void | Promise<void>
  onClose: (result: Result) => void
}
const prompt = {
  integrated: '바코드를 스캔하세요.', 'integrated-employee': '사원번호를 스캔해주세요.',
  order: '수주번호를 스캔하세요.', material: 'Lot No를 스캔하세요.',
}

export default function CommonScanDialog({ mode, position, onEnter, onError, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const pending = useRef<AbortController | null>(null)
  const closeResult = useRef<Result>('cancel')
  const [raw, setRaw] = useState('')
  const [hint, showHint] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    field.current?.focus()
    return () => { pending.current?.abort(); element.close() }
  }, [])
  function close(result: Result) {
    dialog.current?.close()
    onClose(result)
  }
  async function submit() {
    if (pending.current) return
    const operation = new AbortController()
    pending.current = operation
    setBusy(true)
    try {
      const outcome = await onEnter(raw, operation.signal)
      if (operation.signal.aborted) return
      if (outcome.next === 'close') { close(outcome.result); return }
      if (outcome.next === 'continue' && outcome.closeResult && mode !== 'material') closeResult.current = outcome.closeResult
    } catch (error) {
      if (!operation.signal.aborted) await onError(error)
    } finally {
      if (!operation.signal.aborted && dialog.current?.open) {
        setRaw(''); showHint(true); setBusy(false); field.current?.focus()
      }
      pending.current = null
    }
  }
  return createPortal(<dialog ref={dialog} className="common-scan-dialog" data-mode={mode}
    aria-label={prompt[mode]} style={position} onCancel={event => event.preventDefault()}>
    <input ref={field} aria-label={prompt[mode]} value={raw} readOnly={busy} autoComplete="off"
      onChange={e => {setRaw(e.target.value);showHint(false)}} onKeyDown={event => {
        showHint(false)
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {event.preventDefault();void submit()}
      }} />
    {hint && <span aria-hidden="true">{prompt[mode]}</span>}
    <button type="button" disabled={busy} onClick={() => close(closeResult.current)}>닫기</button>
  </dialog>,document.body)
}
