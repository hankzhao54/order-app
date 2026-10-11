import { useState } from 'react'
import { Input } from './primitives'

/** Text input that saves when it loses focus (or on Enter) and only if the value changed. */
export function BlurInput({ value, onCommit, className = '' }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value)
  const [prev, setPrev] = useState(value)
  if (value !== prev) { setPrev(value); setV(value) }
  return (
    <Input
      className={className}
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}
