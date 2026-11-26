import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import TransferMessage, { type Message } from './TransferMessage'
import { SettingsPromptContext } from './settingsPrompt'

export default function SettingsPrompts({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<Message>()
  const pending = useRef<{ resolve: (answer: boolean) => void; answer: boolean } | null>(null)
  useEffect(() => () => { pending.current?.resolve(false); pending.current = null }, [])
  const show = useCallback((text: string, confirm = false) => new Promise<boolean>(resolve => {
    if (pending.current) { resolve(false); return }
    const entry = { resolve, answer: !confirm }
    pending.current = entry
    setMessage(confirm ? { text, yes: () => { entry.answer = true } } : { text })
  }), [])
  function dismiss() {
    const finished = pending.current
    pending.current = null
    setMessage(undefined)
    finished?.resolve(finished.answer)
  }
  return <SettingsPromptContext.Provider value={show}>{children}
    {message && <div className="settings-message-scope"><TransferMessage message={message} close={dismiss} /></div>}
  </SettingsPromptContext.Provider>
}
