import { useId, useRef } from 'react'

export default function FloorConfirm({ label, summary, disabled, onConfirm }: {
  label: string
  summary: string
  disabled?: boolean
  onConfirm: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  return <>
    <button type="button" disabled={disabled} onClick={() => dialog.current?.showModal()}>{label}</button>
    <dialog ref={dialog} aria-labelledby={title} className="floor-confirm">
      <h3 id={title}>{label} 확인</h3>
      <p>{summary}</p>
      <button type="button" onClick={() => dialog.current?.close()}>취소</button>
      <button type="button" disabled={disabled} onClick={() => {
        dialog.current?.close()
        onConfirm()
      }}>확정</button>
    </dialog>
  </>
}
