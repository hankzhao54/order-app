import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Loader2, Minus, Plus } from 'lucide-react'
import type { Tone } from '@/lib/status'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ok' | 'warn'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, block, className = '', children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`btn btn-${variant} btn-${size}${block ? ' btn-block' : ''}${!children ? ' btn-icon' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="spin" size={16} aria-hidden /> : icon}
      {children && <span>{children}</span>}
    </button>
  )
})

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`badge tone-${tone} ${className}`}>{children}</span>
}

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...rest}>{children}</div>
}

export interface SegOption<T extends string> { value: T; label: ReactNode; count?: number }

export function Segmented<T extends string>({ value, onChange, options, size = 'md', ariaLabel }: {
  value: T; onChange: (v: T) => void; options: SegOption<T>[]; size?: 'sm' | 'md'; ariaLabel?: string
}) {
  return (
    <div className={`seg seg-${size}`} role="tablist" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count != null && o.count > 0 && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Stepper({ value, onChange, min = 0, step = 1, unit, size = 'md', label }: {
  value: number; onChange: (v: number) => void; min?: number; step?: number; unit?: string | null; size?: 'sm' | 'md' | 'lg'; label?: string
}) {
  const clamp = (n: number) => Math.max(min, Math.round(n * 1000) / 1000)
  return (
    <div className={`stepper stepper-${size}`}>
      <button type="button" aria-label="−" onClick={() => onChange(clamp(value - step))} disabled={value <= min}><Minus size={16} /></button>
      <label className="stepper-val">
        <input
          inputMode="decimal"
          aria-label={label}
          value={Number.isFinite(value) ? String(value) : ''}
          onFocus={e => e.currentTarget.select()}
          onChange={e => {
            const v = e.target.value.replace(',', '.')
            if (v === '') { onChange(min); return }
            const n = Number(v)
            if (Number.isFinite(n)) onChange(clamp(n))
          }}
        />
        {unit && <small>{unit}</small>}
      </label>
      <button type="button" aria-label="+" onClick={() => onChange(clamp(value + step))}><Plus size={16} /></button>
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`input ${className}`} {...rest} />
})

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input select ${className}`} {...rest}>{children}</select>
}

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  )
}

export function Skeleton({ rows = 5, variant = 'rows' }: { rows?: number; variant?: 'rows' | 'cards' }) {
  return (
    <div className={`skel skel-${variant}`} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skel-item" key={i}>
          <div className="skel-line" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
          {variant === 'cards' && <div className="skel-line" style={{ width: '80%' }} />}
          {variant === 'cards' && <div className="skel-line" style={{ width: '40%' }} />}
        </div>
      ))}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function Toolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`toolbar ${className}`}>{children}</div>
}

export function Stat({ value, label, tone = 'neutral' }: { value: ReactNode; label: ReactNode; tone?: Tone }) {
  return (
    <div className={`stat tone-${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return <div className="note note-bad" role="alert">{(error as Error).message ?? String(error)}</div>
}
