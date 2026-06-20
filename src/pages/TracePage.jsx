import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const fmt = d => d ? new Date(d).toLocaleDateString('en-GB') : '—'

export default function TracePage() {
  const { id } = useParams()
  const [row, setRow] = useState(null)
  const [state, setState] = useState('loading') // loading | ok | notfound

  useEffect(() => {
    let alive = true
    supabase.rpc('trace_batch', { p_batch: id }).then(({ data, error }) => {
      if (!alive) return
      if (error || !data || data.length === 0) { setState('notfound'); return }
      setRow(data[0]); setState('ok')
    })
    return () => { alive = false }
  }, [id])

  const expired = row?.expires_on && new Date(row.expires_on) < new Date(new Date().toDateString())
  const soon = row?.expires_on && !expired && (new Date(row.expires_on) - new Date()) / 86400000 <= 7

  return (
    <div className="trace-wrap">
      <div className="trace-card">
        <div className="trace-brand">订货 · Trace</div>
        {state === 'loading' && <p className="muted">Loading…</p>}
        {state === 'notfound' && <p className="muted">This label could not be found. It may have been removed.</p>}
        {state === 'ok' && (
          <>
            <h1 className="trace-name">{row.name_en}</h1>
            {row.name_hu && row.name_hu !== row.name_en && <div className="trace-hu">{row.name_hu}</div>}
            {expired && <div className="trace-flag bad">⚠ Expired</div>}
            {soon && <div className="trace-flag warn">⏳ Expiring soon</div>}
            <dl className="trace-dl">
              <dt>Produced</dt><dd>{fmt(row.produced_on)}</dd>
              <dt>Use by</dt><dd className={expired ? 'bad' : ''}>{fmt(row.expires_on)}</dd>
              <dt>Quantity</dt><dd>{Number(row.qty)}</dd>
              <dt>Made at</dt><dd>{row.location}</dd>
              <dt>Batch</dt><dd className="mono">{String(row.batch_id).slice(0, 8)}</dd>
            </dl>
          </>
        )}
      </div>
    </div>
  )
}
