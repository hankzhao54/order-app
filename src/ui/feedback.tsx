import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { Sheet } from './Sheet'
import { Button, Input } from './primitives'
import { useT } from '@/lib/i18n'

// ---- toasts --------------------------------------------------------------------
type ToastKind = 'ok' | 'bad' | 'info'
interface ToastItem { id: number; kind: ToastKind; text: string }

// ---- dialogs ---------------------------------------------------------------------
interface ConfirmOpts { title: string; body?: ReactNode; confirm?: string; danger?: boolean }
interface PromptOpts { title: string; body?: ReactNode; placeholder?: string; initial?: string; confirm?: string; choices?: string[] }

interface Feedback {
  toast: (text: string, kind?: ToastKind) => void
  ok: (text: string) => void
  error: (e: unknown) => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
  prompt: (o: PromptOpts) => Promise<string | null>
}

const Ctx = createContext<Feedback | null>(null)
export function useFeedback(): Feedback {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFeedback outside FeedbackProvider')
  return v
}

type Dialog =
  | { kind: 'confirm'; o: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; o: PromptOpts; resolve: (v: string | null) => void }

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [text, setText] = useState('')
  const seq = useRef(0)

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq.current
    setToasts(ts => [...ts.slice(-3), { id, kind, text }])
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), kind === 'bad' ? 7000 : 3500)
  }, [])
  const ok = useCallback((text: string) => toast(text, 'ok'), [toast])
  const error = useCallback((e: unknown) => toast((e as Error)?.message || String(e), 'bad'), [toast])
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>(resolve => setDialog({ kind: 'confirm', o, resolve })), [])
  const prompt = useCallback((o: PromptOpts) => new Promise<string | null>(resolve => {
    setText(o.initial ?? '')
    setDialog({ kind: 'prompt', o, resolve })
  }), [])

  const close = (v: boolean | string | null) => {
    if (!dialog) return
    if (dialog.kind === 'confirm') dialog.resolve(Boolean(v))
    else dialog.resolve(typeof v === 'string' ? v : null)
    setDialog(null)
  }

  return (
    <Ctx.Provider value={{ toast, ok, error, confirm, prompt }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map(x => (
          <div key={x.id} className={`toast toast-${x.kind}`} onClick={() => setToasts(ts => ts.filter(y => y.id !== x.id))}>
            {x.kind === 'ok' ? <CheckCircle2 size={18} /> : x.kind === 'bad' ? <AlertCircle size={18} /> : <Info size={18} />}
            <span>{x.text}</span>
          </div>
        ))}
      </div>
      <Sheet
        open={!!dialog}
        size="sm"
        onClose={() => close(dialog?.kind === 'confirm' ? false : null)}
        title={dialog?.o.title}
        footer={dialog && (dialog.kind === 'confirm' || !dialog.o.choices) ? (
          <>
            <Button variant="ghost" onClick={() => close(dialog.kind === 'confirm' ? false : null)}>{t('common.cancel')}</Button>
            <Button
              variant={dialog.kind === 'confirm' && dialog.o.danger ? 'danger' : 'primary'}
              disabled={dialog.kind === 'prompt' && !text.trim()}
              onClick={() => close(dialog.kind === 'confirm' ? true : text.trim())}
            >
              {dialog.o.confirm ?? t('common.ok')}
            </Button>
          </>
        ) : undefined}
      >
        {dialog?.o.body && <div className="dialog-body">{dialog.o.body}</div>}
        {dialog?.kind === 'prompt' && dialog.o.choices && (
          <div className="choice-list">
            {dialog.o.choices.map(c => <Button key={c} block onClick={() => close(c)}>{c}</Button>)}
          </div>
        )}
        {dialog?.kind === 'prompt' && (
          <form onSubmit={e => { e.preventDefault(); if (text.trim()) close(text.trim()) }}>
            <Input autoFocus value={text} placeholder={dialog.o.placeholder} onChange={e => setText(e.target.value)} />
            {dialog.o.choices && (
              <Button type="submit" variant="primary" block disabled={!text.trim()} className="mt-2">{dialog.o.confirm ?? t('common.ok')}</Button>
            )}
          </form>
        )}
      </Sheet>
    </Ctx.Provider>
  )
}
