import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

// Monday-based week helpers
function startOfWeek(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0,0,0,0); x.setDate(x.getDate() - day); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function iso(d) { return new Date(d).toISOString() }
function fmtDate(d) { return new Date(d).toLocaleDateString() }

export default function HistoryPage() {
  const { role, locationId, isStaff } = useAuth()
  const seesAll = isStaff || role === 'driver'

  const [mode, setMode] = useState('week')          // week | range
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()))
  const [from, setFrom] = useState(() => addDays(new Date(), -30).toISOString().slice(0,10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0,10))
  const [tab, setTab] = useState('orders')          // orders | dispatch | procurement
  const [locations, setLocations] = useState([])
  const [locFilter, setLocFilter] = useState('')    // '' = all (staff only)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (seesAll) supabase.from('locations').select('id,name_en').eq('is_active', true).order('name_en').then(({ data }) => setLocations(data || []))
  }, [])

  const range = useMemo(() => {
    if (mode === 'week') return { gte: iso(weekStart), lt: iso(addDays(weekStart, 7)) }
    return { gte: iso(new Date(from + 'T00:00:00')), lt: iso(addDays(new Date(to + 'T00:00:00'), 1)) }
  }, [mode, weekStart, from, to])

  async function load() {
    setLoading(true)
    const effectiveLoc = seesAll ? (locFilter || null) : locationId
    let data = []
    if (tab === 'orders') {
      let q = supabase.from('orders')
        .select('id,order_type,status,created_at,location:locations(name_en),items:order_items(id,item_name_snapshot,quantity,unit_snapshot,fulfillment_type,dispatch_status)')
        .gte('created_at', range.gte).lt('created_at', range.lt)
        .order('created_at', { ascending: false })
      if (effectiveLoc) q = q.eq('location_id', effectiveLoc)
      data = (await q).data || []
    } else if (tab === 'procurement') {
      let q = supabase.from('procurement_tasks')
        .select('id,item_name,quantity,unit,status,target:locations(name_en),created_at,bought_at')
        .gte('created_at', range.gte).lt('created_at', range.lt)
        .order('created_at', { ascending: false })
      if (effectiveLoc) q = q.eq('target_location_id', effectiveLoc)
      data = (await q).data || []
    } else { // dispatch: order_items that were dispatched in range
      let q = supabase.from('order_items')
        .select('id,item_name_snapshot,quantity,unit_snapshot,fulfillment_type,dispatched_at,order:orders!inner(location_id,location:locations(name_en))')
        .eq('dispatch_status', 'dispatched')
        .gte('dispatched_at', range.gte).lt('dispatched_at', range.lt)
        .order('dispatched_at', { ascending: false })
      if (effectiveLoc) q = q.eq('order.location_id', effectiveLoc)
      data = (await q).data || []
    }
    setRows(data); setLoading(false)
  }
  useEffect(() => { load() }, [tab, range, locFilter])

  const weekLabel = `${fmtDate(weekStart)} – ${fmtDate(addDays(weekStart, 6))}`

  return (
    <div className="historypage">
      <div className="hfilters">
        <div className="seg">
          <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>By week</button>
          <button className={mode === 'range' ? 'on' : ''} onClick={() => setMode('range')}>Date range</button>
        </div>
        {mode === 'week' ? (
          <div className="weekpick">
            <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
            <span className="wlabel">{weekLabel}</span>
            <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
            <button className="ghost" onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</button>
          </div>
        ) : (
          <div className="rangepick">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <span className="muted">→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        )}
        {seesAll && (
          <select value={locFilter} onChange={e => setLocFilter(e.target.value)}>
            <option value="">All locations</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
          </select>
        )}
      </div>

      <div className="seg tabs2">
        {['orders', 'dispatch', 'procurement'].map(t =>
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {loading ? <div className="center muted">Loading…</div>
        : rows.length === 0 ? <div className="center muted">Nothing in this period.</div>
        : <div className="hlist">
            {tab === 'orders' && rows.map(o => (
              <div className="hcard" key={o.id}>
                <div className="hhead">
                  <b>{fmtDate(o.created_at)}</b>
                  {seesAll && <span className="tag">{o.location?.name_en}</span>}
                  <span className={`tag ${o.order_type}`}>{o.order_type}</span>
                  <span className={`tag st-${o.status}`}>{o.status}</span>
                  <span className="muted small">{o.items.length} items</span>
                </div>
                <div className="hitems">
                  {o.items.map(i => <span key={i.id} className="hitem">{i.quantity}{i.unit_snapshot ? ` ${i.unit_snapshot}` : ''} {i.item_name_snapshot}{i.fulfillment_type === 'make' ? ' 🍳' : i.fulfillment_type === 'purchase' ? ' 🛒' : ''}</span>)}
                </div>
              </div>
            ))}
            {tab === 'dispatch' && rows.map(r => (
              <div className="hrow" key={r.id}>
                <span>{fmtDate(r.dispatched_at)}</span>
                {seesAll && <span className="tag">{r.order?.location?.name_en}</span>}
                <span className="grow">{r.quantity}{r.unit_snapshot ? ` ${r.unit_snapshot}` : ''} {r.item_name_snapshot}</span>
                <span>{r.fulfillment_type === 'make' ? '🍳' : '🛒'} 📦</span>
              </div>
            ))}
            {tab === 'procurement' && rows.map(r => (
              <div className="hrow" key={r.id}>
                <span>{fmtDate(r.created_at)}</span>
                {seesAll && <span className="tag">{r.target?.name_en || '—'}</span>}
                <span className="grow">{r.quantity}{r.unit ? ` ${r.unit}` : ''} {r.item_name}</span>
                <span className={`tag st-${r.status === 'bought' ? 'completed' : r.status === 'unavailable' ? 'cancelled' : 'submitted'}`}>{r.status}</span>
              </div>
            ))}
          </div>}
    </div>
  )
}
