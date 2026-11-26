import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './commonNumericPad.css'

export type NumericPadMode = 'integer' | 'decimal' | 'preset'
type Props = {
  mode: NumericPadMode
  onApply: (value: string) => void
  onCancel: () => void
}

const dimensions = {
  integer: { width: 800, height: 1000, displayY: 12, displayHeight: 238, keysY: 252, actionsY: 875 },
  decimal: { width: 800, height: 912, displayY: 7, displayHeight: 150, keysY: 164, actionsY: 787 },
  preset: { width: 798, height: 968, displayY: 7, displayHeight: 194, keysY: 207, actionsY: 842 },
}
const formatInteger = new Intl.NumberFormat('ko-KR')
const digits = ['1','2','3','4','5','6','7','8','9','C','0']
const presets = Array.from({ length: 28 }, (_, i) => String(200 + 50 * i))

function update(mode: NumericPadMode, current: string, key: string) {
  if (key === 'C') return '0'
  if (mode === 'preset') return key
  if (key === '.') return current.includes('.') ? current : current + '.'
  const raw = current.replaceAll(',', '')
  if (key === '←') return formatInteger.format(Number(raw.slice(0, -1)))
  if (current.length >= 8) return current
  const next = current === '0' ? key : raw + key
  return mode === 'integer' ? formatInteger.format(Number(next)) : next
}

export default function CommonNumericPad({ mode, onApply, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const applyButton = useRef<HTMLButtonElement>(null)
  const finished = useRef(false)
  const [display, setDisplay] = useState('0')
  const layout = dimensions[mode]
  const horizontal = (pixels: number) => (pixels / layout.width * 100) + '%'
  const vertical = (pixels: number) => (pixels / layout.height * 100) + '%'
  const frame = (left: number, top: number, width: number, height: number) => ({
    left: horizontal(left), top: vertical(top), width: horizontal(width), height: vertical(height),
  })
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    applyButton.current?.focus({ preventScroll: true })
    return () => element.close()
  }, [])
  function finish(apply: boolean) {
    if (finished.current || (apply && mode === 'preset' && display === '0')) return
    finished.current = true
    dialog.current?.close()
    if (apply) onApply(String(Number(display.replaceAll(',', ''))))
    else onCancel()
  }
  const keys = mode === 'preset' ? [...presets, 'C'] : [...digits, mode === 'decimal' ? '.' : '←']
  return createPortal(<dialog ref={dialog} className="common-numeric-pad" aria-label="숫자 입력"
    onCancel={event => event.preventDefault()}>
    <div style={{ width: `min(${layout.width}px, 100dvw, ${100 * layout.width / layout.height}dvh)`, aspectRatio: layout.width / layout.height }}>
      <output style={frame(10, layout.displayY, 781, layout.displayHeight)}>{display}</output>
      {keys.map((key, index) => {
        const preset = mode === 'preset'
        const clearColumn = preset && key === 'C'
        const style = clearColumn ? frame(686, 217, 105, 610)
          : preset ? frame(10 + index % 4 * 170, layout.keysY + 10 + Math.floor(index / 4) * 90, 150, 70)
          : frame(10 + index % 3 * 265, layout.keysY + 30 + Math.floor(index / 3) * 150, 250, 120)
        return <button type="button" key={key} style={style} data-preset={preset} data-edit={key === 'C' || key === '←'}
          onClick={() => setDisplay(old => update(mode, old, key))}>{key}</button>
      })}
      <button type="button" ref={applyButton} className="cn-apply" style={frame(10, layout.actionsY, 382, 113)} onClick={() => finish(true)}>적용</button>
      <button type="button" className="cn-cancel" style={frame(409, layout.actionsY, 382, 113)} onClick={() => finish(false)}>취소</button>
    </div>
  </dialog>, document.body)
}
