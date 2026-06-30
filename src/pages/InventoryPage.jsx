import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchList, patchRow } from '../lib/db'
import { useAuth } from '../lib/AuthProvider'
import { downloadCSV, today } from '../lib/csv'
import { expiryState, rowExpiry, isLow, fmtTotal } from '../lib/inventory'
import { transitionItem } from '../lib/orderLifecycle'
import { SkeletonRows } from '../components/Skeleton'

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
      const [l, c] = await Promise.all([
        fetchList('locations', { select: 'id,name_en,is_central', build: q => q.eq('is_active', true).order('is_central', { ascending: false }).order('name_en') }),
        fetchList('catalog_items', { select: 'id,name_en,name_hu,stock_unit,unit_weight,weight_unit,shelf_life_days,storage_location,reorder_level,category:categories(name_en)', build: q => q.eq('is_active', true).order('name_en') })
      ])
      setLocs(l); setCatalog(c)
      if (!locId) {
        const central = l.find(x => x.is_central)
        setLocId(locationId || central?.id || l[0]?.id || '')
      }
    })()
  }, [])

  const catMap = useMemo(() => Object.fromEntries(catalog.map(c => [c.id, c])), [catalog])

  async function load() {
    if (!locId) return
    setLoading(true)
    const [ls, batches] = await Promise.all([
      fetchList('location_stock', { select: 'catalog_item_id, qty, storage_location, reorder_level', build: q => q.eq('location_id', locId) }),
      fetchList('stock_batches', { select: 'id, catalog_item_id, qty, produced_on, expires_on', build: q => q.eq('location_id', locId).gt('qty', 0).order('expires_on', { nullsFirst: false }) })
    ])
    const byItem = {}
    for (const b of batches) (byItem[b.catalog_item_id] ||= []).push(b)
    setRows(ls.map(r => ({ ...r, batches: byItem[r.catalog_item_id] || [] })))
    setLoading(false)
  }
  useEffect(() => { load() }, [locId])

  // merge stock rows with catalog specs
  const items = useMemo(() => rows.map(r => ({
    ...catMap[r.catalog_item_id], id: r.catalog_item_id,
    qty: Number(r.qty),
    storage_location: catMap[r.catalog_item_id]?.storage_location || null,
    reorder_level: catMap[r.catalog_item_id]?.reorder_level,
    batches: r.batches || []
  })).filter(i => i.name_en), [rows, catMap])

  function openCount(item) { setEdit(item); setEditVal('') }
  async function setTotal(item, target) {
    const n = Number(target)
    if (isNaN(n) || n < 0) { setMsg('Enter a valid number.'); return }
    const { error } = await supabase.rpc('set_total_fifo', { p_loc: locId, p_item: item.id, p_target: n, p_note: 'stocktake' })
    if (error) { setMsg(error.message); return }
    setCounted(c => ({ ...c, [item.id]: true })); setMsg(''); await load()
  }
  async function scrapBatch(batch, itemId) {
    if (!confirm('Throw away this batch? Stock will be reduced and logged as scrap.')) return
    await supabase.rpc('scrap_batch', { p_batch: batch.id, p_note: 'expired/scrapped' })
    await load()
  }
  async function sendBack(item, qty) {
    const n = Number(qty)
    if (isNaN(n) || n <= 0) { setMsg('Enter a quantity to send back.'); return }
    if (n > item.qty) { setMsg(`Only ${item.qty} in stock.`); return }
    if (!confirm(`Send ${n}${item.stock_unit ? ' ' + item.stock_unit : ''} of ${item.name_en} back to Central Kitchen? It will leave this store's stock now and await kitchen sign-off.`)) return
    const { error } = await supabase.rpc('send_back', { p_from: locId, p_item: item.id, p_qty: n, p_note: null })
    if (error) { setMsg(error.message); return }
    setMsg(''); await load()
  }
  async function addBatch(item, qty, produced) {
    const n = Number(qty)
    if (isNaN(n) || n <= 0) { setMsg('Enter a batch quantity.'); return }
    const { error } = await supabase.rpc('add_batch', { p_loc: locId, p_item: item.id, p_qty: n, p_produced: produced || new Date().toISOString().slice(0, 10), p_expires: null, p_note: null })
    if (error) { setMsg(error.message); return }
    setCounted(c => ({ ...c, [item.id]: true })); setMsg(''); await load()
  }
  async function editBatchQty(batch, newQty, itemId) {
    const n = Number(newQty)
    if (isNaN(n) || n < 0) return
    await patchRow('stock_batches', batch.id, { qty: n })
    await supabase.rpc('sync_loc_qty', { p_loc: locId, p_item: itemId })
    await load()
  }
  async function deleteBatch(batch, itemId) {
    await supabase.from('stock_batches').delete().eq('id', batch.id)
    await supabase.rpc('sync_loc_qty', { p_loc: locId, p_item: itemId })
    await load()
  }
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
      {!canOverview && role !== 'bar_staff' && (
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={topTab === 'count' ? 'on' : ''} onClick={() => { setTopTab('count'); load() }}>Stocktake</button>
          <button className={topTab === 'receiving' ? 'on' : ''} onClick={() => setTopTab('receiving')}>Receiving</button>
        </div>
      )}
      {topTab === 'receiving'
        ? <Receiving canPickLoc={canPickLoc} locs={locs} myLoc={locationId} catMap={catMap} onReceived={load} />
        : topTab === 'overview' && canOverview
        ? <Overview locs={locs} catMap={catMap} />
        : <Stocktake {...{ canPickLoc, locs, locId, setLocId, catalog, catMap, rows, setRows, loading, q, setQ, groupBy, setGroupBy, onlyUncounted, setOnlyUncounted, counted, setCounted, collapsed, setCollapsed, adding, setAdding, edit, setEdit, msg, setMsg, items, openCount, saveLoc, addItem, removeItem, filtered, groups, addable, countedN, locName, inListIds, load, setTotal, scrapBatch, sendBack, addBatch, editBatchQty, deleteBatch }} />}
    </div>
  )
}

function Stocktake(p) {
  const { canPickLoc, locs, locId, setLocId, catalog, q, setQ, groupBy, setGroupBy, onlyUncounted, setOnlyUncounted,
    counted, setCounted, collapsed, setCollapsed, adding, setAdding, edit, setEdit, msg,
    items, openCount, saveLoc, addItem, removeItem, loading, groups, addable, countedN, locName,
    setTotal, scrapBatch, sendBack, addBatch, editBatchQty, deleteBatch } = p
  const live = edit ? (items.find(x => x.id === edit.id) || edit) : null
  const isCentral = locs.find(l => l.id === locId)?.is_central
  const [totalVal, setTotalVal] = useState('')
  const [showBatches, setShowBatches] = useState(false)
  const [backQty, setBackQty] = useState('')
  const [newQty, setNewQty] = useState('')
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10))
  useEffect(() => { if (live) { setTotalVal(String(live.qty)); setShowBatches(false); setNewQty(''); setBackQty('') } }, [edit])
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
            {addable.slice(0, 60).map(c => <button key={c.id} className="chip addchip" onClick={() => addItem(c.id)}>+ {c.name_en}{c.name_hu ? ` (${c.name_hu})` : ''}</button>)}
            {addable.length === 0 && <span className="muted small">All matching items already added.</span>}
          </div>
        </div>
      )}

      {loading ? <SkeletonRows count={8} />
        : items.length === 0 ? <div className="center muted">No items in {locName}'s list yet. Tap “➕ Add items”.</div>
        : groups.map(([g, list]) => (
          <div className="invgroup" key={g}>
            <div className="invgrouphd" onClick={() => setCollapsed(c => ({ ...c, [g]: !c[g] }))}>
              <span>{collapsed[g] ? '▸' : '▾'} 📍 {g}</span>
              <span className="muted small">{list.filter(i => counted[i.id]).length}/{list.length}</span>
            </div>
            {!collapsed[g] && list.map(i => {
              const ex = rowExpiry(i.batches)
              return (
              <div key={i.id} className={`invrow2 ${counted[i.id] ? 'done' : ''} ${isLow(i.qty, i.reorder_level) ? 'low' : ''}`} onClick={() => openCount(i)}>
                <span className="ck">{counted[i.id] ? '✓' : ''}</span>
                <div className="invinfo">
                  <span className="invname">{i.name_en}
                    {isLow(i.qty, i.reorder_level) && <span className="lowtag">low</span>}
                    {ex.cls === 'expired' && <span className="exptag expired">expired</span>}
                    {ex.cls === 'expsoon' && <span className="exptag expsoon">{ex.label}</span>}
                  </span>
                  <span className="muted small">{i.name_hu || ''}</span>
                </div>
                <span className="qbig">{i.qty}<small>{i.stock_unit ? ` ${i.stock_unit}` : ''}</small></span>
                <span className="twt">{fmtTotal(i.qty, i) || ''}</span>
              </div>
            )})}
          </div>
        ))}

      {live && (
        <div className="cnt-overlay" onClick={() => setEdit(null)}>
          <div className="cnt-card" onClick={e => e.stopPropagation()}>
            <div className="cnt-name">{live.name_en}{live.name_hu ? <span className="muted" style={{ fontWeight: 400, fontSize: '0.8em' }}> · {live.name_hu}</span> : ''}</div>
            <div className="cnt-sub muted">{locName} · system has {live.qty}{live.stock_unit ? ` ${live.stock_unit}` : ''}</div>

            {/* main: actual total count */}
            <div className="cnt-row" style={{ marginTop: 14 }}>
              <button className="cnt-pm" onClick={() => setTotalVal(v => String(Math.max(0, (Number(v) || 0) - 1)))}>−</button>
              <input className="cnt-val" inputMode="decimal" value={totalVal} onChange={e => setTotalVal(e.target.value)} autoFocus />
              <button className="cnt-pm" onClick={() => setTotalVal(v => String((Number(v) || 0) + 1))}>+</button>
            </div>
            <div className="cnt-quick">{[-10, -5, +5, +10].map(d => <button key={d} onClick={() => setTotalVal(v => String(Math.max(0, (Number(v) || 0) + d)))}>{d > 0 ? `+${d}` : d}</button>)}</div>
            <button className="primary cnt-savebtn" onClick={() => setTotal(live, totalVal)}>Save count ({totalVal || 0})</button>

            {/* expiring / expired batches to throw away */}
            {(live.batches || []).filter(b => { const s = expiryState(b.expires_on); return s.cls === 'expired' || s.cls === 'expsoon' }).length > 0 && (
              <div className="scrapsec">
                <div className="scrapsec-h">⚠ Expiring / expired — throw away?</div>
                {(live.batches || []).filter(b => { const s = expiryState(b.expires_on); return s.cls === 'expired' || s.cls === 'expsoon' }).map(b => {
                  const st = expiryState(b.expires_on)
                  return (
                    <div key={b.id} className={`batchrow ${st.cls}`}>
                      <div className="batchinfo">
                        <span className="batchmade">{Number(b.qty)}{live.stock_unit ? ` ${live.stock_unit}` : ''} · made {b.produced_on}</span>
                        <span className={`batchexp ${st.cls}`}>{b.expires_on ? `exp ${b.expires_on} · ${st.label}` : ''}</span>
                      </div>
                      <button className="mini danger" onClick={() => scrapBatch(b, live.id)}>🗑 Throw</button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* send back to central kitchen (stores only) */}
            {!isCentral && live.qty > 0 && (
              <div className="backsec">
                <div className="backsec-h">↩ Send back to Central Kitchen</div>
                <div className="addbatch-row">
                  <input className="bq" inputMode="decimal" placeholder="qty" value={backQty} onChange={e => setBackQty(e.target.value)} />
                  <button className="ghost" onClick={() => { sendBack(live, backQty); setBackQty('') }}>Send back</button>
                </div>
                <div className="faint sm">Leaves this store now; kitchen confirms receipt in Receiving.</div>
              </div>
            )}

            {/* batch detail (collapsed by default) */}
            <button className="linkish" onClick={() => setShowBatches(s => !s)}>{showBatches ? '▾ Hide batches' : `▸ Batches & new delivery (${(live.batches || []).length})`}</button>
            {showBatches && (
              <div className="batchdetail">
                {(live.batches || []).map(b => {
                  const st = expiryState(b.expires_on)
                  return (
                    <div key={b.id} className={`batchrow ${st.cls}`}>
                      <div className="batchinfo">
                        <span className="batchmade">made {b.produced_on}</span>
                        <span className={`batchexp ${st.cls}`}>{b.expires_on ? `exp ${b.expires_on}${st.label ? ` · ${st.label}` : ''}` : 'no expiry'}</span>
                      </div>
                      <input className="batchqty" inputMode="decimal" defaultValue={Number(b.qty)}
                        onBlur={e => { if (Number(e.target.value) !== Number(b.qty)) editBatchQty(b, e.target.value, live.id) }} />
                      <button className="mini danger" onClick={() => deleteBatch(b, live.id)}>✕</button>
                    </div>
                  )
                })}
                <div className="addbatch-row" style={{ marginTop: 8 }}>
                  <input className="bq" inputMode="decimal" placeholder="qty" value={newQty} onChange={e => setNewQty(e.target.value)} />
                  <input className="bd" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
                  <button className="primary" onClick={() => { addBatch(live, newQty, newDate); setNewQty('') }}>+ New delivery</button>
                </div>
                <div className="faint sm">{live.shelf_life_days ? `Expiry auto-set: +${live.shelf_life_days} days.` : 'No shelf life set (Catalog → Shelf d).'}</div>
              </div>
            )}

            <div className="cnt-actions">
              <button className="ghost danger" onClick={() => { removeItem(live); setEdit(null) }}>Remove item</button>
              <button className="ghost" onClick={() => setEdit(null)}>Done</button>
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
    fetchList('location_stock', { select: 'location_id, catalog_item_id, qty, reorder_level' }).then(setData)
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
                  const low = isLow(cell.qty, r.item.reorder_level)
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
      <div className="seg" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex' }}>
          <button className={mode === 'item' ? 'on' : ''} onClick={() => setMode('item')}>By item</button>
          <button className={mode === 'site' ? 'on' : ''} onClick={() => setMode('site')}>By site</button>
        </span>
        <button className="ghost" onClick={() => {
          const locName = Object.fromEntries(locs.map(l => [l.id, l.name_en]))
          const rows = data.map(r => ({
            item: catMap[r.catalog_item_id]?.name_en, item_hu: catMap[r.catalog_item_id]?.name_hu,
            loc: locName[r.location_id] || '', qty: Number(r.qty), unit: catMap[r.catalog_item_id]?.stock_unit || ''
          })).filter(r => r.item).sort((a, b) => a.loc.localeCompare(b.loc) || a.item.localeCompare(b.item))
          downloadCSV(`inventory-snapshot-${today()}`,
            [{ label: 'Location', key: 'loc' }, { label: 'Item (EN)', key: 'item' }, { label: 'Item (HU)', key: 'item_hu' }, { label: 'Qty', key: 'qty' }, { label: 'Unit', key: 'unit' }],
            rows)
        }}>⬇ Export CSV</button>
      </div>
      {mode === 'item' ? byItem() : bySite()}
    </div>
  )
}

function Receiving({ canPickLoc, locs, myLoc, catMap, onReceived }) {
  const [locId, setLocId] = useState(myLoc || '')
  const [rows, setRows] = useState([])
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!locId && canPickLoc) { const f = locs.find(l => !l.is_central); setLocId(f?.id || locs[0]?.id || '') }
  }, [locs])

  async function load() {
    if (!locId) return
    setLoading(true)
    const [items, rets] = await Promise.all([
      fetchList('order_items', {
        select: 'id, catalog_item_id, item_name_snapshot, unit_snapshot, quantity, fulfilled_qty, fulfillment_type, dispatch_status, order:orders!inner(location_id, location:locations(name_en), created_at)',
        build: q => q.eq('dispatch_status', 'dispatched').eq('order.location_id', locId).order('id', { ascending: false })
      }),
      fetchList('stock_returns', {
        select: 'id, catalog_item_id, qty, expires_on, created_at, from_location, from:locations!stock_returns_from_location_fkey(name_en)',
        build: q => q.eq('status', 'pending').eq('to_location', locId)
      })
    ])
    setRows(items); setReturns(rets); setLoading(false)
  }
  useEffect(() => { load() }, [locId])

  async function receive(item) {
    const qty = Number(item.fulfilled_qty ?? item.quantity) || 0
    await transitionItem(item, 'received')
    if (item.catalog_item_id && qty) {
      await supabase.rpc('add_batch', { p_loc: locId, p_item: item.catalog_item_id, p_qty: qty, p_produced: new Date().toISOString().slice(0,10), p_expires: null, p_note: 'received' })
    }
    setRows(p => p.filter(r => r.id !== item.id))
    onReceived && onReceived()
  }
  async function receiveReturn(r) {
    await supabase.rpc('receive_return', { p_return: r.id })
    setReturns(p => p.filter(x => x.id !== r.id))
    onReceived && onReceived()
  }
  async function receiveAll() {
    if (!rows.length) return
    if (!confirm(`Confirm receiving all ${rows.length} item(s)? Stock will be added to this location.`)) return
    // add_batch is additive (new batch row + qty bump) so order doesn't
    // matter across different deliveries — safe to fire concurrently,
    // unlike FIFO consumption which must stay serial.
    await Promise.all(rows.map(it => receive(it)))
  }

  const locName = locs.find(l => l.id === locId)?.name_en || ''
  return (
    <div>
      <div className="inv-top">
        {canPickLoc ? (
          <select className="locselect-inv" value={locId} onChange={e => setLocId(e.target.value)}>
            {locs.map(l => <option key={l.id} value={l.id}>{l.name_en}{l.is_central ? ' (kitchen)' : ''}</option>)}
          </select>
        ) : <span className="inv-loc">📍 {locName}</span>}
        <span className="inv-prog">{rows.length + returns.length} to receive</span>
        {rows.length > 0 && <button className="primary" onClick={receiveAll}>✓ Receive all deliveries</button>}
      </div>
      {msg && <div className="error">{msg}</div>}
      {loading ? <div className="center muted">Loading…</div>
        : (rows.length === 0 && returns.length === 0) ? <div className="center muted">Nothing waiting to be received. ✅</div>
        : <>
            {returns.length > 0 && (
              <div className="invgroup">
                <div className="invgrouphd"><span>↩ Returns from stores</span><span className="muted small">{returns.length}</span></div>
                {returns.map(r => (
                  <div className="invrow2" key={r.id} style={{ cursor: 'default' }}>
                    <div className="invinfo">
                      <span className="invname">{catMap[r.catalog_item_id]?.name_en || 'Item'}</span>
                      <span className="muted small">from {r.from?.name_en || '—'}{r.expires_on ? ` · exp ${r.expires_on}` : ''}</span>
                    </div>
                    <span className="qbig">{Number(r.qty)}<small>{catMap[r.catalog_item_id]?.stock_unit ? ` ${catMap[r.catalog_item_id].stock_unit}` : ''}</small></span>
                    <button className="mini ok" onClick={() => receiveReturn(r)}>✓ Received</button>
                  </div>
                ))}
              </div>
            )}
            {rows.length > 0 && (
              <div className="invgroup">
                <div className="invgrouphd"><span>📦 Deliveries</span><span className="muted small">{rows.length}</span></div>
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
              </div>
            )}
          </>}
      <p className="muted small" style={{ marginTop: 10 }}>Confirming adds the quantity to {locName}'s stock.</p>
    </div>
  )
}
