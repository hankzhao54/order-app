import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const HUF = n => new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' Ft'

function rangeStart(kind) {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  if (kind === 'week') { const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day) }
  else if (kind === 'month') { d.setDate(1) }
  else return null
  return d
}

export default function ReportsPage() {
  const [range, setRange] = useState('month')
  const [view, setView] = useState('item')   // item | supplier | store
  const [tasks, setTasks] = useState([])
  const [prices, setPrices] = useState({})    // catalog_item_id -> {unit, supplier}
  const [locs, setLocs] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [{ data: pr }, { data: sup }, { data: lc }] = await Promise.all([
        supabase.from('item_prices').select('catalog_item_id, price, pack_qty, supplier_id, effective_date').order('effective_date', { ascending: false }),
        supabase.from('suppliers').select('id, name'),
        supabase.from('locations').select('id, name_en')
      ])
      const supMap = Object.fromEntries((sup || []).map(s => [s.id, s.name]))
      const pmap = {}
      for (const p of pr || []) {  // first seen = latest (ordered desc)
        if (!pmap[p.catalog_item_id]) pmap[p.catalog_item_id] = { unit: Number(p.price) / (Number(p.pack_qty) || 1), supplier: supMap[p.supplier_id] || '—' }
      }
      setPrices(pmap)
      setLocs(Object.fromEntries((lc || []).map(l => [l.id, l.name_en])))
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    (async () => {
      let qb = supabase.from('procurement_tasks')
        .select('id, catalog_item_id, item_name, quantity, unit, target_location_id, bought_at')
        .eq('status', 'bought')
      const s = rangeStart(range)
      if (s) qb = qb.gte('bought_at', s.toISOString())
      const { data } = await qb
      setTasks(data || [])
    })()
  }, [range])

  const rows = useMemo(() => tasks.map(t => {
    const p = t.catalog_item_id ? prices[t.catalog_item_id] : null
    const cost = p ? Number(t.quantity) * p.unit : null
    return { ...t, cost, supplier: p?.supplier || '—', hasPrice: !!p }
  }), [tasks, prices])

  const total = rows.reduce((a, r) => a + (r.cost || 0), 0)
  const unknownCount = rows.filter(r => !r.hasPrice).length

  function group(keyFn, labelFn) {
    const m = new Map()
    for (const r of rows) {
      const k = keyFn(r)
      if (!m.has(k)) m.set(k, { label: labelFn(r), cost: 0, qty: 0, known: true })
      const g = m.get(k); g.cost += r.cost || 0; g.qty += Number(r.quantity)
      if (!r.hasPrice) g.known = false
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost)
  }
  const byItem = useMemo(() => group(r => r.catalog_item_id || r.item_name, r => r.item_name), [rows])
  const bySupplier = useMemo(() => group(r => r.supplier, r => r.supplier), [rows])
  const byStore = useMemo(() => group(r => r.target_location_id, r => locs[r.target_location_id] || '—'), [rows, locs])

  const current = view === 'item' ? byItem : view === 'supplier' ? bySupplier : byStore

  return (
    <div className="reports">
      <div className="toolbar">
        <div className="seg">
          <button className={range === 'week' ? 'on' : ''} onClick={() => setRange('week')}>This week</button>
          <button className={range === 'month' ? 'on' : ''} onClick={() => setRange('month')}>This month</button>
          <button className={range === 'all' ? 'on' : ''} onClick={() => setRange('all')}>All time</button>
        </div>
      </div>

      <div className="stats" style={{ marginTop: 12 }}>
        <div className="statcard"><div className="statn">{HUF(total)}</div><div className="statl">Total purchasing spend</div></div>
        <div className="statcard"><div className="statn">{rows.length}</div><div className="statl">Items bought</div></div>
        {unknownCount > 0 && <div className="statcard warn"><div className="statn">{unknownCount}</div><div className="statl">No price set (not counted)</div></div>}
      </div>

      <div className="seg" style={{ marginTop: 16 }}>
        <button className={view === 'item' ? 'on' : ''} onClick={() => setView('item')}>By item</button>
        <button className={view === 'supplier' ? 'on' : ''} onClick={() => setView('supplier')}>By supplier</button>
        <button className={view === 'store' ? 'on' : ''} onClick={() => setView('store')}>By store</button>
      </div>

      {loading ? <div className="center muted">Loading…</div>
        : rows.length === 0 ? <div className="center muted">No purchases in this period.</div>
        : <table className="tbl" style={{ marginTop: 10 }}>
            <thead><tr><th>{view === 'item' ? 'Item' : view === 'supplier' ? 'Supplier' : 'Store'}</th><th>Qty</th><th>Spend</th><th>Share</th></tr></thead>
            <tbody>
              {current.map((g, i) => (
                <tr key={i}>
                  <td>{g.label}{!g.known && <span className="muted small"> (some no price)</span>}</td>
                  <td className="num">{g.qty}</td>
                  <td className="num"><b>{HUF(g.cost)}</b></td>
                  <td className="num">{total > 0 ? Math.round(g.cost / total * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>}
      <p className="muted small" style={{ marginTop: 10 }}>Spend = bought quantity × latest unit price (from Catalog prices). Items without a price are shown in the count but not in the totals — set prices in Catalog → 💰.</p>
    </div>
  )
}
