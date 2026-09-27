import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** Modal that is a bottom sheet on phones and a centred dialog on larger screens. */
export function Sheet({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    const t = setTimeout(() => {
      // only fields that ask for it get focus — avoids popping the phone keyboard
      if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: true })
    }, 30)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`sheet sheet-${size}`} role="dialog" aria-modal="true" ref={ref} tabIndex={-1}>
        <div className="sheet-grip" aria-hidden />
        {title != null && (
          <div className="sheet-head">
            <div className="sheet-title">{title}</div>
            <button className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={onClose}><X size={18} /></button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
