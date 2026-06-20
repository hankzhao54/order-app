import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const fmt = d => d ? new Date(d).toLocaleDateString('en-GB') : '—'

export default function LabelsPage() {
  const [locs, setLocs] = useState([])
  const [locId, setLocId] = useState('')
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('locations').select('id,name_en,is_central').eq('is_active', true)
      .order('is_central', { ascending: false }).then(({ data }) => {
        setLocs(data || [])
        const central = (data || []).find(l => l.is_central)
        if (central) setLocId(central.id)
      })
  }, [])

  useEffect(() => {
    if (!locId) return
    setLoading(true)
    supabase.from('stock_batches')
      .select('id, produced_on, expires_on, qty, catalog_item:catalog_items(name_en,name_hu)')
      .eq('location_id', locId).gt('qty', 0)
      .order('produced_on', { ascending: false }).limit(200)
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [locId])

  const filtered = rows.filter(r => {
    const n = (r.catalog_item?.name_en || '') + ' ' + (r.catalog_item?.name_hu || '')
    return n.toLowerCase().includes(q.toLowerCase())
  })

  return (
    <div className="labels-page">
      <h2>Print labels</h2>
      <p className="muted small">Pick a batch to print a label (name, dates, QR code). The QR opens a trace page anyone can scan.</p>
      <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select value={locId} onChange={e => setLocId(e.target.value)}>
          {locs.map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
        </select>
        <input className="search" placeholder="Search item…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {loading ? <p className="muted">Loading…</p>
        : filtered.length === 0 ? <p className="muted">No batches with stock here.</p>
        : (
          <div className="label-list">
            {filtered.map(r => {
              const expired = r.expires_on && new Date(r.expires_on) < new Date(new Date().toDateString())
              return (
                <div className="label-row" key={r.id}>
                  <div className="lr-main">
                    <b>{r.catalog_item?.name_en}</b>
                    {r.catalog_item?.name_hu && <span className="muted small"> · {r.catalog_item.name_hu}</span>}
                    <div className="muted small">Prod {fmt(r.produced_on)} · Use by <span className={expired ? 'bad' : ''}>{fmt(r.expires_on)}</span> · Qty {Number(r.qty)}</div>
                  </div>
                  <a className="mini primary" href={`/label/${r.id}`} target="_blank" rel="noopener">🏷 Label</a>
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}
