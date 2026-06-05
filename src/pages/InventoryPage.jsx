import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

const isLow = (qty, reorder) => {
  const q = Number(qty)
  const t = reorder == null || reorder === '' ? 1 : Number(reorder)
  return q <= t
}

const fmtTotal = (qty, i) => {
  const w = Number(i.unit_weight)
  if (!w || !Number(qty)) return null
  const grams = w * Number(qty) * (i.weight_unit === 'kg' ? 1000 : 1)
  return grams >= 1000 ? `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 2)} kg` : `${Math.round(grams)} g`
}

export default function InventoryPage() {
  const { role, locationId } = useAuth()
  const canPickLoc = role === 'kitchen_manager' || role === 'admin'
  const canOverview = role === 'kitchen_manager' || role === 'admin'

  const [topTab, setTopTab] = useState('count')   // count | overview
  const [locs, setLocs] = useState([])
  const [locId, setLocId] = useState(locationId || '')
  const [catalog, setCatalog] = useState([])      // all make items (specs)
  const [rows, setRows] = useState([])            // location_stock rows for locId
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [groupBy, setGroupBy] = useState('location')   // location | category
  const [onlyUncounted, setOnlyUncounted] = useState(false)
  const [counted, setCounted] = useState({})
  const [collapsed, setCollapsed] = useState({})
  const [adding, setAdding] = useState(false)
  const [edit, setEdit] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [msg, setMsg] = useState('')

  // bootstrap: locations (for picker) + catalog specs
  useEffect(() => {
    (async () => {
      const [{ data: l }, { data: c }] = await Promise.all([
        supabase.from('locations').select('id,name_en,is_central').eq('is_active', true).order('is_central', { ascending: false }).order('name_en'),
        supabase.from('catalog_items').select('id,name_en,name_hu,stock_unit,unit_weight,weight_unit,category:categories(name_en)')
          .eq('default_fulfillment', 'make').eq('is_active', true).order('name_en')
      ])
      setLocs(l || []); setCatalog(c || [])
      if (!locId) {
        const central = (l || []).find(x => x.is_central)
        setLocId(locationId || central?.id || (l || [])[0]?.id || '')
      }
    })()
  }, [])

  const catMap = useMemo(() => Object.fromEntries(catalog.map(c => [c.id, c])), [catalog])

  async function load() {
    if (!locId) return
    setLoading(true)
    const { data } = await supabase.from('location_stock')
      .select('catalog_item_id, qty, storage_location, reorder_level').eq('location_id', locId)
    setRows(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [locId])

  // merge stock rows with catalog specs
  const items = useMemo(() => rows.map(r => ({
    ...catMap[r.catalog_item_id], id: r.catalog_item_id,
    qty: Number(r.qty), storage_location: r.storage_location, reorder_level: r.reorder_level
  })).filter(i => i.name_en), [rows, catMap])

  function openCount(item) { setEdit(item); setEditVal(String(item.qty)) }
  function nudge(d) { setEditVal(v => String(Math.max(0, (Number(v) || 0) + d))) }
  async function commitCount() {
    const val = Number(editVal)
    if (isNaN(val) || val < 0) { setMsg('Enter a valid number.'); return }
    const { error } = await supabase.rpc('set_loc_stock', { p_loc: locId, p_item: edit.id, p_value: val, p_note: 'stocktake' })
    if (error) { setMsg(error.message); return }
    setRows(p => p.map(r => r.catalog_item_id === edit.id ? { ...r, qty: val } : r))
    setCounted(c => ({ ...c, [edit.id]: true })); setEdit(null); setMsg('')
  }
  async function saveLoc(item, storage) {
    setRows(p => p.map(r => r.catalog_item_id === item.id ? { ...r, storage_location: storage } : r))
    await supabase.from('location_stock').update({ storage_location: storage || null }).eq('location_id', locId).eq('catalog_item_id', item.id)
  }
  async function addItem(catId) {
    const { error } = await supabase.rpc('add_loc_item', { p_loc: locId, p_item: catId })
    if (error) { setMsg(error.message); return }
    load()
  }
  async function removeItem(item) {
    if (!confirm(`Remove ${item.name_en} from this location's stocktake list?`)) return
    await supabase.from('location_stock').delete().eq('location_id', locId).eq('catalog_item_id', item.id)
    setRows(p => p.filter(r => r.catalog_item_id !== item.id))
  }

  const inListIds = useMemo(() => new Set(rows.map(r => r.catalog_item_id)), [rows])

  const filtered = useMemo(() => {
    let r = items
    if (q) r = r.filter(i => `${i.name_en} ${i.name_hu || ''} ${i.storage_location || ''}`.toLowerCase().includes(q.toLowerCase()))
    if (onlyUncounted) r = r.filter(i => !counted[i.id])
    return r
  }, [items, q, onlyUncounted, counted])

  const groups = useMemo(() => {
    const m = new Map()
    for (const i of filtered) {
      const key = (groupBy === 'location' ? i.storage_location : i.category?.name_en) || 'Unassigned'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(i)
    }
    return [...m.entries()].sort((a, b) => a[0] === 'Unassigned' ? 1 : b[0] === 'Unassigned' ? -1 : a[0].localeCompare(b[0]))
  }, [filtered, groupBy])

  const addable = useMemo(() => catalog.filter(c => !inListIds.has(c.id) &&
    (!q || `${c.name_en} ${c.name_hu || ''}`.toLowerCase().includes(q.toLowerCase()))), [catalog, inListIds, q])

  const countedN = Object.keys(counted).length
  const locName = locs.find(l => l.id === locId)?.name_en || ''

  return (
    <div className="inventory">
      {canOverview && (
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={topTab === 'count' ? 'on' : ''} onClick={() => { setTopTab('count'); load() }}>Stocktake</button>
          <button className={topTab === 'overview' ? 'on' : ''} onClick={() => setTopTab('overview')}>Overview</button>
          <button className={topTab === 'receiving' ? 'on' : ''} onClick={() => setTopTab('receiving')}>Receiving</button>
        </div>
      )}
      {!canOverview && (
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={topTab === 'count' ? 'on' : ''} onClick={() => { setTopTab('count'); load() }}>Stocktake</button>
          <button className={topTab === 'receiving' ? 'on' : ''} onClick={() => setTopTab('receiving')}>Receiving</button>
        </div>
      )}
      {topTab === 'receiving'
        ? <Receiving canPickLoc={canPickLoc} locs={locs} myLoc={locationId} catMap={catMap} onReceived={load} />
        : topTab === 'overview' && canOverview
        ? <Overview locs={locs} catMap={catMap} />
        : <Stocktake {...{ canPickLoc, locs, locId, setLocId, catalog, catMap, rows, setRows, loading, q, setQ, groupBy, setGroupBy, onlyUncounted, setOnlyUncounted, counted, setCounted, collapsed, setCollapsed, adding, setAdding, edit, setEdit, editVal, setEditVal, msg, setMsg, items, openCount, nudge, commitCount, saveLoc, addItem, removeItem, filtered, groups, addable, countedN, locName, inListIds }} />}
    </div>
  )
}

function Stocktake(p) {
  const { canPickLoc, locs, locId, setLocId, catalog, q, setQ, groupBy, setGroupBy, onlyUncounted, setOnlyUncounted,
    counted, setCounted, collapsed, setCollapsed, adding, setAdding, edit, setEdit, editVal, setEditVal, msg,
    items, openCount, nudge, commitCount, saveLoc, addItem, removeItem, loading, groups, addable, countedN, locName } = p
  return (
    <>
      <div className="inv-top">
        {canPickLoc ? (
          <select className="locselect-inv" value={locId} onChange={e => { setLocId(e.target.value); setCounted({}) }}>
            {locs.map(l => <option key={l.id} value={l.id}>{l.name_en}{l.is_central ? ' (kitchen)' : ''}</option>)}
          </select>
        ) : <span className="inv-loc">📍 {locName}</span>}
        <input className="search" placeholder="Search item or location…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="seg">
          <button className={groupBy === 'location' ? 'on' : ''} onClick={() => setGroupBy('location')}>By location</button>
          <button className={groupBy === 'category' ? 'on' : ''} onClick={() => setGroupBy('category')}>By category</button>
        </div>
        <label className="inline"><input type="checkbox" checked={onlyUncounted} onChange={e => setOnlyUncounted(e.target.checked)} /> only uncounted</label>
        <span className="inv-prog">Counted {countedN}/{items.length}</span>
        <button className="ghost" onClick={() => setAdding(a => !a)}>{adding ? 'Done adding' : '➕ Add items'}</button>
      </div>
      {msg && <div className="error" style={{ marginBottom: 10 }}>{msg}</div>}

      {adding && (
        <div className="addpanel card">
          <div className="muted small" style={{ marginBottom: 6 }}>Tap to add to <b>{locName}</b>'s stocktake list (search above to filter):</div>
          <div className="addchips">
            {addable.slice(0, 60).map(c => <button key={c.id} className="chip addchip" onClick={() => addItem(c.id)}>+ {c.name_en}</button>)}
            {addable.length === 0 && <span className="muted small">All matching items already added.</span>}
          </div>
        </div>
      )}

      {loading ? <div className="center muted">Loading…</div>
        : items.length === 0 ? <div className="center muted">No items in {locName}'s list yet. Tap “➕ Add items”.</div>
        : groups.map(([g, list]) => (
          <div className="invgroup" key={g}>
            <div className="invgrouphd" onClick={() => setCollapsed(c => ({ ...c, [g]: !c[g] }))}>
              <span>{collapsed[g] ? '▸' : '▾'} 📍 {g}</span>
              <span className="muted small">{list.filter(i => counted[i.id]).length}/{list.length}</span>
            </div>
            {!collapsed[g] && list.map(i => (
              <div key={i.id} className={`invrow2 ${counted[i.id] ? 'done' : ''} ${isLow(i.qty, i.reorder_level) ? 'low' : ''}`} onClick={() => openCount(i)}>
                <span className="ck">{counted[i.id] ? '✓' : ''}</span>
                <div className="invinfo">
                  <span className="invname">{i.name_en}{isLow(i.qty, i.reorder_level) && <span className="lowtag">low</span>}</span>
                  <span className="muted small">{i.unit_weight ? `${i.unit_weight}${i.weight_unit || 'g'}/${i.stock_unit || 'unit'}` : (i.stock_unit || '')}</span>
                </div>
                <span className="qbig">{i.qty}<small>{i.stock_unit ? ` ${i.stock_unit}` : ''}</small></span>
                <span className="twt">{fmtTotal(i.qty, i) || ''}</span>
              </div>
            ))}
          </div>
        ))}

      {edit && (
        <div className="cnt-overlay" onClick={() => setEdit(null)}>
          <div className="cnt-card" onClick={e => e.stopPropagation()}>
            <div className="cnt-name">{edit.name_en}</div>
            <div className="cnt-sub muted">{locName} · {edit.storage_location || 'Unassigned'} · {edit.stock_unit || 'unit'}</div>
            <div className="cnt-row">
              <button className="cnt-pm" onClick={() => nudge(-1)}>−</button>
              <input className="cnt-val" inputMode="decimal" value={editVal} onChange={e => setEditVal(e.target.value)} autoFocus />
              <button className="cnt-pm" onClick={() => nudge(1)}>+</button>
            </div>
            <div className="cnt-quick">{[-10, -5, +5, +10].map(d => <button key={d} onClick={() => nudge(d)}>{d > 0 ? `+${d}` : d}</button>)}</div>
            <div className="cnt-meta">
              <input className="cnt-loc" placeholder="storage location (this site)" defaultValue={edit.storage_location || ''}
                onBlur={e => saveLoc(edit, e.target.value)} />
              <input className="cnt-loc" style={{ marginTop: 8 }} placeholder="low-stock alert when ≤ (blank = ≤1)" inputMode="decimal" defaultValue={edit.reorder_level ?? ''}
                onBlur={async e => { const v = e.target.value === '' ? null : Number(e.target.value); await supabase.from('location_stock').update({ reorder_level: v }).eq('location_id', locId).eq('catalog_item_id', edit.id); setRows(p => p.map(r => r.catalog_item_id === edit.id ? { ...r, reorder_level: v } : r)) }} />
              <div className="cnt-spec">
                <input placeholder="unit (bag…)" defaultValue={edit.stock_unit || ''}
                  onBlur={async e => { await supabase.from('catalog_items').update({ stock_unit: e.target.value || null }).eq('id', edit.id) }} />
                <input placeholder="wt" inputMode="decimal" defaultValue={edit.unit_weight ?? ''}
                  onBlur={async e => { const v = e.target.value === '' ? null : Number(e.target.value); await supabase.from('catalog_items').update({ unit_weight: v }).eq('id', edit.id) }} />
                <select defaultValue={edit.weight_unit || 'g'}
                  onChange={async e => { await supabase.from('catalog_items').update({ weight_unit: e.target.value }).eq('id', edit.id) }}>
                  <option value="g">g</option><option value="kg">kg</option>
                </select>
              </div>
              <div className="faint sm" style={{ marginTop: 4 }}>Unit & weight are shared across all sites.</div>
            </div>
            <div className="cnt-actions">
              <button className="ghost danger" onClick={() => { removeItem(edit); setEdit(null) }}>Remove</button>
              <button className="ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button className="primary" onClick={commitCount}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Overview({ locs, catMap }) {
  const [mode, setMode] = useState('item')   // item | site
  const [data, setData] = useState(null)
  useEffect(() => {
    supabase.from('location_stock').select('location_id, catalog_item_id, qty, reorder_level').then(({ data }) => setData(data || []))
  }, [])
  if (!data) return <div className="center muted">Loading…</div>

  const siteOrder = locs.slice().sort((a, b) => (b.is_central ? 1 : 0) - (a.is_central ? 1 : 0))
  const fmt = (qty, spec) => fmtTotal(qty, spec || {})

  // by item: rows = items, cols = sites
  const byItem = () => {
    const m = new Map()  // itemId -> {site: {qty,reorder}}
    for (const r of data) {
      if (!m.has(r.catalog_item_id)) m.set(r.catalog_item_id, {})
      m.get(r.catalog_item_id)[r.location_id] = { qty: Number(r.qty), reorder: r.reorder_level }
    }
    const rows = [...m.entries()].map(([id, bySite]) => ({ item: catMap[id], id, bySite, total: Object.values(bySite).reduce((a, b) => a + b.qty, 0) }))
      .filter(r => r.item).sort((a, b) => a.item.name_en.localeCompare(b.item.name_en))
    return (
      <div className="ovwrap">
        <table className="ovtable">
          <thead><tr><th>Item</th>{siteOrder.map(s => <th key={s.id}>{s.is_central ? '🏭 ' : ''}{s.name_en}</th>)}<th>Total</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="ovname">{r.item.name_en}{r.item.stock_unit ? <span className="faint sm"> {r.item.stock_unit}</span> : ''}</td>
                {siteOrder.map(s => {
                  const cell = r.bySite[s.id]
                  if (!cell) return <td key={s.id} className="ovnum zero">·</td>
                  const low = isLow(cell.qty, cell.reorder)
                  return <td key={s.id} className={`ovnum ${cell.qty > 0 ? '' : 'zero'} ${low ? 'lowcell' : ''}`}>{cell.qty}{low ? ' ⚠' : ''}</td>
                })}
                <td className="ovtotal">{r.total}{r.item.unit_weight ? <span className="faint sm"> · {fmt(r.total, r.item)}</span> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // by site: grouped lists
  const bySite = () => {
    const m = new Map()
    for (const r of data) {
      if (!m.has(r.location_id)) m.set(r.location_id, [])
      m.get(r.location_id).push(r)
    }
    return (
      <div>
        {siteOrder.map(s => {
          const list = (m.get(s.id) || []).map(r => ({ ...catMap[r.catalog_item_id], qty: Number(r.qty) })).filter(x => x.name_en)
            .sort((a, b) => a.name_en.localeCompare(b.name_en))
          return (
            <div className="invgroup" key={s.id}>
              <div className="invgrouphd"><span>{s.is_central ? '🏭 ' : '📍 '}{s.name_en}</span><span className="muted small">{list.length} items</span></div>
              {list.map(i => (
                <div className="invrow2" key={i.id} style={{ cursor: 'default' }}>
                  <div className="invinfo"><span className="invname">{i.name_en}</span></div>
                  <span className="qbig">{i.qty}<small>{i.stock_unit ? ` ${i.stock_unit}` : ''}</small></span>
                  <span className="twt">{fmt(i.qty, i) || ''}</span>
                </div>
              ))}
              {list.length === 0 && <div className="invrow2" style={{ cursor: 'default' }}><span className="muted small">No stock recorded.</span></div>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={mode === 'item' ? 'on' : ''} onClick={() => setMode('item')}>By item</button>
        <button className={mode === 'site' ? 'on' : ''} onClick={() => setMode('site')}>By site</button>
      </div>
      {mode === 'item' ? byItem() : bySite()}
    </div>
  )
}

function Receiving({ canPickLoc, locs, myLoc, catMap, onReceived }) {
  const [locId, setLocId] = useState(myLoc || '')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!locId && canPickLoc) { const f = locs.find(l => !l.is_central); setLocId(f?.id || locs[0]?.id || '') }
  }, [locs])

  async function load() {
    if (!locId) return
    setLoading(true)
    // dispatched items belonging to this location's orders, not yet received
    const { data } = await supabase.from('order_items')
      .select('id, catalog_item_id, item_name_snapshot, unit_snapshot, quantity, fulfilled_qty, fulfillment_type, dispatch_status, order:orders!inner(location_id, location:locations(name_en), created_at)')
      .eq('dispatch_status', 'dispatched').eq('order.location_id', locId)
      .order('id', { ascending: false })
    setRows(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [locId])

  async function receive(item) {
    const qty = Number(item.fulfilled_qty ?? item.quantity) || 0
    await supabase.from('order_items').update({ dispatch_status: 'received' }).eq('id', item.id)
    if (item.catalog_item_id && qty) {
      await supabase.rpc('adjust_loc_stock', { p_loc: locId, p_item: item.catalog_item_id, p_delta: qty, p_reason: 'received', p_note: null, p_order_item: item.id })
    }
    setRows(p => p.filter(r => r.id !== item.id))
    onReceived && onReceived()
  }
  async function receiveAll() {
    if (!rows.length) return
    if (!confirm(`Confirm receiving all ${rows.length} item(s)? Stock will be added to this location.`)) return
    for (const it of rows) await receive(it)
  }

  const locName = locs.find(l => l.id === locId)?.name_en || ''
  return (
    <div>
      <div className="inv-top">
        {canPickLoc ? (
          <select className="locselect-inv" value={locId} onChange={e => setLocId(e.target.value)}>
            {locs.filter(l => !l.is_central).map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
          </select>
        ) : <span className="inv-loc">📍 {locName}</span>}
        <span className="inv-prog">{rows.length} to receive</span>
        {rows.length > 0 && <button className="primary" onClick={receiveAll}>✓ Receive all</button>}
      </div>
      {msg && <div className="error">{msg}</div>}
      {loading ? <div className="center muted">Loading…</div>
        : rows.length === 0 ? <div className="center muted">Nothing waiting to be received. ✅</div>
        : <div className="invgroup">
            {rows.map(i => (
              <div className="invrow2" key={i.id} style={{ cursor: 'default' }}>
                <div className="invinfo">
                  <span className="invname">{i.item_name_snapshot}</span>
                  <span className="muted small">{i.fulfillment_type === 'make' ? '🍳' : '🛒'} · sent {i.order?.created_at ? new Date(i.order.created_at).toLocaleDateString() : ''}</span>
                </div>
                <span className="qbig">{Number(i.fulfilled_qty ?? i.quantity)}<small>{i.unit_snapshot ? ` ${i.unit_snapshot}` : ''}</small></span>
                <button className="mini ok" onClick={() => receive(i)}>✓ Received</button>
              </div>
            ))}
          </div>}
      <p className="muted small" style={{ marginTop: 10 }}>Confirming adds the quantity to {locName}'s stock. Items not on the list are added automatically.</p>
    </div>
  )
}
