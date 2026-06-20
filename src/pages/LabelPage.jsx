import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'

const fmt = d => d ? new Date(d).toLocaleDateString('en-GB') : '—'

export default function LabelPage() {
  const { id } = useParams()
  const [row, setRow] = useState(null)
  const [qr, setQr] = useState('')
  const [state, setState] = useState('loading')

  useEffect(() => {
    let alive = true
    supabase.rpc('trace_batch', { p_batch: id }).then(async ({ data, error }) => {
      if (!alive) return
      if (error || !data || data.length === 0) { setState('notfound'); return }
      setRow(data[0]); setState('ok')
      const url = `${window.location.origin}/trace/${id}`
      try { setQr(await QRCode.toDataURL(url, { margin: 0, width: 240 })) } catch { /* ignore */ }
    })
    return () => { alive = false }
  }, [id])

  if (state === 'loading') return <div className="center muted">Loading…</div>
  if (state === 'notfound') return <div className="center muted">Label not found.</div>

  return (
    <div className="label-page">
      <div className="label">
        <div className="label-main">
          <div className="label-name">{row.name_en}</div>
          {row.name_hu && row.name_hu !== row.name_en && <div className="label-hu">{row.name_hu}</div>}
          <div className="label-dates">
            <div><span>Prod</span><b>{fmt(row.produced_on)}</b></div>
            <div><span>Use by</span><b>{fmt(row.expires_on)}</b></div>
          </div>
          <div className="label-batch">#{String(row.batch_id).slice(0, 8)}</div>
        </div>
        {qr && <img className="label-qr" src={qr} alt="QR" />}
      </div>
      <button className="primary noprint" onClick={() => window.print()}>🖨 Print label</button>
      <p className="muted small noprint">Tip: in the print dialog, pick the Brother label printer and the right DK roll size. Scan the QR to open the trace page.</p>
    </div>
  )
}
