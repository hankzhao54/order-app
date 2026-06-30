import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchList } from '../lib/db'
import { downloadCSV, today } from '../lib/csv'

const HUF = n => new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' Ft'
function rangeStart(kind) {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  if (kind === 'week') { const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day) }
  else if (kind === 'month') { d.setDate(1) }
  else return null
  return d
}
const REASONS = {
  produced: { label: 'Produced', emoji: '🍳' },
  dispatched: { label: 'Dispatched', emoji: '🚚' },
  received: { label: 'Received', emoji: '📥' },
  return_out: { label: 'Sent back', emoji: '↩' },
  return_in: { label: 'Return in', emoji: '↩' },
  stocktake: { label: 'Stocktake adj.', emoji: '📋' },
  scrap: { label: 'Scrap/expired', emoji: '🗑' },
  manual: { label: 'Manual', emoji: '✏️' },
}

export default function ReportsPage() {
  const [tab, setTab] = useState('spend')
  return (
    <div className="reports">
      <div className="seg" style={{ marginBottom: 4 }}>
        <button className={tab === 'spend' ? 'on' : ''} onClick={() => setTab('spend')}>Purchasing spend</button>
        <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>Stock log</button>
      </div>
      {tab === 'spend' ? <Spend /> : <StockLog />}
    </div>
  )
}

function Spend() {
  const [range, setRange] = useState('month')
  const [view, setView] = useState('item')
  const [tasks, setTasks] = useState([])
  const [prices, setPrices] = useState({})
  const [locs, setLocs] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const [pr, sup, lc] = await Promise.all([
        fetchList('item_prices', { select: 'catalog_item_id, price, pack_qty, supplier_id, effective_date', build: q => q.order('effective_date', { ascending: false }) }),
        fetchList('suppliers', { select: 'id, name' }),
        fetchList('locations', { select: 'id, name_en' })
      ])
      const supMap = Object.fromEntries(sup.map(s => [s.id, s.name]))
      const pmap = {}
      for (const p of pr) if (!pmap[p.catalog_item_id]) pmap[p.catalog_item_id] = { unit: Number(p.price) / (Number(p.pack_qty) || 1), supplier: supMap[p.supplier_id] || '—' }
      setPrices(pmap); setLocs(Object.fromEntries(lc.map(l => [l.id, l.name_en]))); setLoading(false)
    })()
  }, [])
  useEffect(() => {
    (async () => {
      const data = await fetchList('procurement_tasks', {
        select: 'id, catalog_item_id, item_name, quantity, target_location_id, bought_at',
        build: q => { q = q.eq('status', 'bought'); const s = rangeStart(range); return s ? q.gte('bought_at', s.toISOString()) : q }
      })
      setTasks(data)
    })()
  }, [range])

  const rows = useMemo(() => tasks.map(t => {
    const p = t.catalog_item_id ? prices[t.catalog_item_id] : null
    return { ...t, cost: p ? Number(t.quantity) * p.unit : null, supplier: p?.supplier || '—', hasPrice: !!p }
  }), [tasks, prices])
  const total = rows.reduce((a, r) => a + (r.cost || 0), 0)
  const unknownCount = rows.filter(r => !r.hasPrice).length
  function group(keyFn, labelFn) {
    const m = new Map()
    for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, { label: labelFn(r), cost: 0, qty: 0, known: true }); const g = m.get(k); g.cost += r.cost || 0; g.qty += Number(r.quantity); if (!r.hasPrice) g.known = false }
    return [...m.values()].sort((a, b) => b.cost - a.cost)
  }
  const current = view === 'item' ? group(r => r.catalog_item_id || r.item_name, r => r.item_name)
    : view === 'supplier' ? group(r => r.supplier, r => r.supplier)
    : group(r => r.target_location_id, r => locs[r.target_location_id] || '—')

  return (
    <div>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <div className="seg">
          <button className={range === 'week' ? 'on' : ''} onClick={() => setRange('week')}>This week</button>
          <button className={range === 'month' ? 'on' : ''} onClick={() => setRange('month')}>This month</button>
          <button className={range === 'all' ? 'on' : ''} onClick={() => setRange('all')}>All time</button>
        </div>
        <button className="ghost" disabled={!current.length} onClick={() => downloadCSV(
          `purchasing-spend-${view}-${range}-${today()}`,
          [{ label: view === 'item' ? 'Item' : view === 'supplier' ? 'Supplier' : 'Store', key: 'label' },
           { label: 'Qty', key: 'qty' },
           { label: 'Spend (HUF)', value: r => Math.round(r.cost) },
           { label: 'Share %', value: r => total > 0 ? Math.round(r.cost / total * 100) : 0 }],
          current
        )}>⬇ Export CSV</button>
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
            <tbody>{current.map((g, i) => (
              <tr key={i}><td>{g.label}{!g.known && <span className="muted small"> (some no price)</span>}</td><td className="num">{g.qty}</td><td className="num"><b>{HUF(g.cost)}</b></td><td className="num">{total > 0 ? Math.round(g.cost / total * 100) : 0}%</td></tr>
            ))}</tbody>
          </table>}
      <p className="muted small" style={{ marginTop: 10 }}>Spend = bought qty × latest unit price (Catalog prices). Items without a price are counted but not in totals.</p>
    </div>
  )
}

function StockLog() {
  const [range, setRange] = useState('month')
  const [moves, setMoves] = useState([])
  const [cat, setCat] = useState({})
  const [locs, setLocs] = useState({})
  const [prices, setPrices] = useState({})
  const [fReason, setFReason] = useState('')
  const [fLoc, setFLoc] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const [c, l, pr] = await Promise.all([
        fetchList('catalog_items', { select: 'id, name_en' }),
        fetchList('locations', { select: 'id, name_en' }),
        fetchList('item_prices', { select: 'catalog_item_id, price, pack_qty, effective_date', build: q => q.order('effective_date', { ascending: false }) })
      ])
      setCat(Object.fromEntries(c.map(x => [x.id, x.name_en])))
      setLocs(Object.fromEntries(l.map(x => [x.id, x.name_en])))
      const pmap = {}; for (const p of pr) if (!pmap[p.catalog_item_id]) pmap[p.catalog_item_id] = Number(p.price) / (Number(p.pack_qty) || 1)
      setPrices(pmap)
    })()
  }, [])
  useEffect(() => {
    (async () => {
      setLoading(true)
      const data = await fetchList('stock_moves', {
        select: 'id, catalog_item_id, delta, reason, note, location_id, created_at',
        build: q => { q = q.order('created_at', { ascending: false }).limit(500); const s = rangeStart(range); return s ? q.gte('created_at', s.toISOString()) : q }
      })
      setMoves(data); setLoading(false)
    })()
  }, [range])

  const filtered = useMemo(() => moves.filter(m =>
    (!fReason || m.reason === fReason) &&
    (!fLoc || m.location_id === fLoc) &&
    (!q || (cat[m.catalog_item_id] || '').toLowerCase().includes(q.toLowerCase()))
  ), [moves, fReason, fLoc, q, cat])

  // scrap loss this period (by price)
  const scrapLoss = moves.filter(m => m.reason === 'scrap').reduce((a, m) => a + Math.abs(Number(m.delta)) * (prices[m.catalog_item_id] || 0), 0)
  const scrapQty = moves.filter(m => m.reason === 'scrap').reduce((a, m) => a + Math.abs(Number(m.delta)), 0)

  return (
    <div>
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="seg">
          <button className={range === 'week' ? 'on' : ''} onClick={() => setRange('week')}>Week</button>
          <button className={range === 'month' ? 'on' : ''} onClick={() => setRange('month')}>Month</button>
          <button className={range === 'all' ? 'on' : ''} onClick={() => setRange('all')}>All</button>
        </div>
        <input className="search" placeholder="Search item…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 180 }} />
        <select value={fReason} onChange={e => setFReason(e.target.value)}><option value="">All reasons</option>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select value={fLoc} onChange={e => setFLoc(e.target.value)}><option value="">All locations</option>{Object.entries(locs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="ghost" disabled={!filtered.length} onClick={() => downloadCSV(
          `stock-log-${range}-${today()}`,
          [{ label: 'When', value: m => new Date(m.created_at).toLocaleString() },
           { label: 'Item', value: m => cat[m.catalog_item_id] || '' },
           { label: 'Location', value: m => locs[m.location_id] || '' },
           { label: 'Reason', value: m => (REASONS[m.reason]?.label || m.reason) },
           { label: 'Change', value: m => Number(m.delta) }],
          filtered
        )}>⬇ Export CSV</button>
      </div>
      <div className="stats" style={{ marginTop: 12 }}>
        <div className="statcard bad"><div className="statn">{HUF(scrapLoss)}</div><div className="statl">Scrap / waste loss</div></div>
        <div className="statcard"><div className="statn">{scrapQty}</div><div className="statl">Units scrapped</div></div>
        <div className="statcard"><div className="statn">{filtered.length}</div><div className="statl">Movements shown</div></div>
      </div>
      {loading ? <div className="center muted">Loading…</div>
        : filtered.length === 0 ? <div className="center muted">No stock movements.</div>
        : <table className="tbl" style={{ marginTop: 10 }}>
            <thead><tr><th>When</th><th>Item</th><th>Location</th><th>Reason</th><th>Change</th></tr></thead>
            <tbody>{filtered.map(m => {
              const r = REASONS[m.reason] || { label: m.reason, emoji: '•' }
              const pos = Number(m.delta) >= 0
              return (
                <tr key={m.id}>
                  <td className="muted small">{new Date(m.created_at).toLocaleString()}</td>
                  <td>{cat[m.catalog_item_id] || '—'}</td>
                  <td className="muted small">{locs[m.location_id] || '—'}</td>
                  <td>{r.emoji} {r.label}</td>
                  <td className="num" style={{ color: pos ? 'var(--make)' : 'var(--bad)', fontWeight: 700 }}>{pos ? '+' : ''}{Number(m.delta)}</td>
                </tr>
              )
            })}</tbody>
          </table>}
      <p className="muted small" style={{ marginTop: 10 }}>Every stock change is logged: production, dispatch, receiving, returns, stocktake adjustments and scrap. Waste loss = scrapped qty × latest unit price.</p>
    </div>
  )
}
