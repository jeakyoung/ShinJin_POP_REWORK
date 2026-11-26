import { useLayoutEffect, useRef } from 'react'

export type Message = { text: string; yes?: () => void }

export default function TransferMessage({ message, close }: { message: Message; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    if (message.yes) return
    const timer = window.setTimeout(() => element?.close(), 2000)
    return () => window.clearTimeout(timer)
  }, [message])
  return <dialog className="transfer-message" ref={dialog} aria-label="System Message" onClose={close}
    onCancel={event => event.preventDefault()}>
    <div className="transfer-message-text">{message.text}</div>
    {message.yes ? <>
      <button type="button" className="answer-yes" autoFocus onClick={() => { dialog.current?.close(); message.yes?.() }}>예</button>
      <button type="button" className="answer-no" onClick={() => dialog.current?.close()}>아니오</button>
    </> : <button type="button" className="answer-ok" autoFocus onClick={() => dialog.current?.close()}>확인</button>}
  </dialog>
}
