import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export function Modal({ children, label, className, onClose }: { children: ReactNode; label: string; className: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} aria-label={label} className={'employee-modal ' + className}
    onCancel={e => { e.preventDefault(); onClose() }}>{children}</dialog>
}
