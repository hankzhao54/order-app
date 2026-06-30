import { useEffect, useMemo, useState, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchList, patchRow, insertRow } from '../../lib/db'

export default function CatalogAdmin() {
  const [tab, setTab] = useState('items')   // items | categories
  const [items, setItems] = useState([])
  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [it, c] = await Promise.all([
      fetchList('catalog_items', { select: 'id,name_en,name_hu,order_unit,default_fulfillment,is_active,category_id,batch_yield_qty,batch_yield_unit,stock_unit,unit_weight,weight_unit,shelf_life_days,storage_location,reorder_level,vacuum_level', build: q => q.order('name_en') }),
      fetchList('categories', { select: 'id,name_en,name_hu,sort_order,is_active', build: q => q.order('sort_order') })
    ])
    setItems(it); setCats(c); setLoading(false)
  }
  useEffect(() => { load() }, [])

  if (loading) return <div className="center muted">Loading…</div>
  return (
    <div className="catalogadmin">
      <div className="seg tabs2">
        <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>Items ({items.length})</button>
        <button className={tab === 'categories' ? 'on' : ''} onClick={() => setTab('categories')}>Categories ({cats.length})</button>
      </div>
      {tab === 'items'
        ? <Items items={items} cats={cats} reload={load} />
        : <Categories cats={cats} reload={load} />}
    </div>
  )
}

function Items({ items, cats, reload }) {
  const [q, setQ] = useState('')
  const [fCat, setFCat] = useState('')
  const [fActive, setFActive] = useState('active')   // active | inactive | all
  const [sortBy, setSortBy] = useState('name')        // name | category
  const [local, setLocal] = useState(items)
  useEffect(() => { setLocal(items) }, [items])
  const [add, setAdd] = useState({ name_en: '', name_hu: '', category_id: '', default_fulfillment: '', order_unit: '' })
  const [msg, setMsg] = useState('')
  const [priceFor, setPriceFor] = useState(null)
  const [specFor, setSpecFor] = useState(null)

  function set(id, fields) { setLocal(p => p.map(x => x.id === id ? { ...x, ...fields } : x)) }
  async function patch(id, fields) {
    set(id, fields)
    const { error } = await patchRow('catalog_items', id, fields)
    if (error) setMsg(error.message)
  }
  async function addItem() {
    if (!add.name_en.trim()) { setMsg('English name is required.'); return }
    const row = {
      name_en: add.name_en.trim(),
      name_hu: add.name_hu.trim() || null,
      category_id: add.category_id || null,
      default_fulfillment: add.default_fulfillment || null,
      order_unit: add.order_unit || null
    }
    const { error } = await insertRow('catalog_items', row)
    if (error) { setMsg(error.message); return }
    setAdd({ name_en: '', name_hu: '', category_id: '', default_fulfillment: '', order_unit: '' }); setMsg(''); reload()
  }

  const catName = id => cats.find(c => c.id === id)?.name_en || '—'
  const filtered = local
    .filter(i => !q || `${i.name_en} ${i.name_hu || ''}`.toLowerCase().includes(q.toLowerCase()))
    .filter(i => !fCat || i.category_id === fCat)
    .filter(i => fActive === 'all' || (fActive === 'active' ? i.is_active : !i.is_active))
    .sort((a, b) => sortBy === 'category'
      ? (catName(a.category_id).localeCompare(catName(b.category_id)) || a.name_en.localeCompare(b.name_en))
      : a.name_en.localeCompare(b.name_en))

  return (
    <div>
      <div className="addrow card">
        <input placeholder="Name EN *" value={add.name_en} onChange={e => setAdd({ ...add, name_en: e.target.value })} />
        <input placeholder="Name HU" value={add.name_hu} onChange={e => setAdd({ ...add, name_hu: e.target.value })} />
        <select value={add.category_id} onChange={e => setAdd({ ...add, category_id: e.target.value })}>
          <option value="">Category…</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
        </select>
        <select value={add.default_fulfillment} onChange={e => setAdd({ ...add, default_fulfillment: e.target.value })}>
          <option value="">default…</option>
          <option value="make">🍳 make</option>
          <option value="purchase">🛒 purchase</option>
        </select>
        <input className="unit" placeholder="unit" value={add.order_unit} onChange={e => setAdd({ ...add, order_unit: e.target.value })} />
        <button className="primary" onClick={addItem}>+ Add item</button>
      </div>
      {msg && <div className="error" style={{ marginBottom: 8 }}>{msg}</div>}

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input className="search" placeholder="Search items…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={fCat} onChange={e => setFCat(e.target.value)}>
          <option value="">All categories</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
        </select>
        <select value={fActive} onChange={e => setFActive(e.target.value)}>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="all">All statuses</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="name">Sort: name</option>
          <option value="category">Sort: category</option>
        </select>
        <span className="muted">{filtered.length} items</span>
      </div>

      <table className="tbl">
        <thead><tr>
          <Th label="Name (EN)" hint="Item name in English. Shown to staff when ordering." />
          <Th label="Name (HU)" hint="Item name in Hungarian. Secondary label." />
          <Th label="Category" hint="Group the item belongs to. Controls grouping on order & inventory pages." />
          <Th label="Default" hint="Make = produced by Central Kitchen; Buy = purchased from a supplier." />
          <Th label="Unit" hint="Order unit — what stores order in (e.g. kg, bag, box)." />
          <Th label="Specs" hint="Stock unit, per-unit content, shelf life, storage, low-stock threshold. Click ⚙ to expand." />
          <Th label="Price" hint="Supplier price history (used for spend reports)." />
          <Th label="Active" hint="Uncheck to hide from ordering & inventory without deleting." />
        </tr></thead>
        <tbody>
          {filtered.map(i => (
            <Fragment key={i.id}>
            <tr className={i.is_active ? '' : 'inactive'}>
              <td><input className="cell wide" value={i.name_en} onChange={e => set(i.id, { name_en: e.target.value })} onBlur={e => patch(i.id, { name_en: e.target.value })} /></td>
              <td><input className="cell wide" value={i.name_hu || ''} onChange={e => set(i.id, { name_hu: e.target.value })} onBlur={e => patch(i.id, { name_hu: e.target.value || null })} /></td>
              <td>
                <select value={i.category_id || ''} onChange={e => patch(i.id, { category_id: e.target.value || null })}>
                  <option value="">—</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
                </select>
              </td>
              <td>
                <select value={i.default_fulfillment || ''} onChange={e => patch(i.id, { default_fulfillment: e.target.value || null })}>
                  <option value="">—</option>
                  <option value="make">🍳</option>
                  <option value="purchase">🛒</option>
                </select>
              </td>
              <td><input className="cell" value={i.order_unit || ''} onChange={e => set(i.id, { order_unit: e.target.value })} onBlur={e => patch(i.id, { order_unit: e.target.value || null })} /></td>
              <td><button className={`mini ${specSet(i) ? 'on' : ''}`} onClick={() => setSpecFor(specFor === i.id ? null : i.id)}>⚙ {specFor === i.id ? '▾' : (specSet(i) ? 'set' : 'specs')}</button></td>
              <td><button className="mini" onClick={() => setPriceFor(priceFor === i.id ? null : i.id)}>💰 {priceFor === i.id ? '▾' : 'prices'}</button></td>
              <td><input type="checkbox" checked={i.is_active} onChange={e => patch(i.id, { is_active: e.target.checked })} /></td>
            </tr>
            {specFor === i.id && (
              <tr className="specrow"><td colSpan={8}>
                <div className="specgrid">
                  <label>Stock unit<input className="cell" placeholder="bag…" value={i.stock_unit || ''} onChange={e => set(i.id, { stock_unit: e.target.value })} onBlur={e => patch(i.id, { stock_unit: e.target.value || null })} /></label>
                  <label>Per unit
                    <span className="perunit">
                      <input className="cell tiny" placeholder="0" value={i.unit_weight ?? ''} onChange={e => set(i.id, { unit_weight: e.target.value })} onBlur={e => patch(i.id, { unit_weight: e.target.value === '' ? null : Number(e.target.value) })} />
                      <select className="cell tiny" value={i.weight_unit || 'g'} onChange={e => patch(i.id, { weight_unit: e.target.value })}><option value="g">g</option><option value="kg">kg</option><option value="pcs">pcs (db)</option></select>
                    </span>
                  </label>
                  <label>Batch yield
                    <span className="perunit">
                      <input className="cell tiny" value={i.batch_yield_qty ?? ''} onChange={e => set(i.id, { batch_yield_qty: e.target.value })} onBlur={e => patch(i.id, { batch_yield_qty: e.target.value === '' ? null : Number(e.target.value) })} />
                      <input className="cell tiny" placeholder="unit" value={i.batch_yield_unit || ''} onChange={e => set(i.id, { batch_yield_unit: e.target.value })} onBlur={e => patch(i.id, { batch_yield_unit: e.target.value || null })} />
                    </span>
                  </label>
                  <label>Shelf life (days)<input className="cell tiny" placeholder="days" value={i.shelf_life_days ?? ''} onChange={e => set(i.id, { shelf_life_days: e.target.value })} onBlur={e => patch(i.id, { shelf_life_days: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                  <label>Storage<input className="cell" placeholder="fridge…" value={i.storage_location || ''} onChange={e => set(i.id, { storage_location: e.target.value })} onBlur={e => patch(i.id, { storage_location: e.target.value || null })} /></label>
                  <label>Low-stock ≤<input className="cell tiny" placeholder="≤" value={i.reorder_level ?? ''} onChange={e => set(i.id, { reorder_level: e.target.value })} onBlur={e => patch(i.id, { reorder_level: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                  <label>Vacuum level<input className="cell tiny" placeholder="P0–P7" value={i.vacuum_level || ''} onChange={e => set(i.id, { vacuum_level: e.target.value })} onBlur={e => patch(i.id, { vacuum_level: e.target.value || null })} /></label>
                </div>
              </td></tr>
            )}
            {priceFor === i.id && (
              <tr className="pricerow"><td colSpan={8}><PricePanel item={i} /></td></tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="muted small" style={{ marginTop: 8 }}>Edits to text fields save when you click away (blur). Dropdowns & checkboxes save immediately.</p>
    </div>
  )
}

function Categories({ cats, reload }) {
  const [local, setLocal] = useState(cats)
  useEffect(() => { setLocal(cats) }, [cats])
  const [add, setAdd] = useState({ name_en: '', name_hu: '' })
  const [msg, setMsg] = useState('')

  function set(id, fields) { setLocal(p => p.map(x => x.id === id ? { ...x, ...fields } : x)) }
  async function patch(id, fields) {
    set(id, fields)
    const { error } = await patchRow('categories', id, fields)
    if (error) setMsg(error.message)
  }
  async function addCat() {
    if (!add.name_en.trim()) { setMsg('English name is required.'); return }
    const sort = (local.reduce((m, c) => Math.max(m, c.sort_order || 0), 0)) + 10
    const { error } = await insertRow('categories', { name_en: add.name_en.trim(), name_hu: add.name_hu.trim() || null, sort_order: sort })
    if (error) { setMsg(error.message); return }
    setAdd({ name_en: '', name_hu: '' }); setMsg(''); reload()
  }

  return (
    <div>
      <div className="addrow card">
        <input placeholder="Category EN *" value={add.name_en} onChange={e => setAdd({ ...add, name_en: e.target.value })} />
        <input placeholder="Category HU" value={add.name_hu} onChange={e => setAdd({ ...add, name_hu: e.target.value })} />
        <button className="primary" onClick={addCat}>+ Add category</button>
      </div>
      {msg && <div className="error" style={{ marginBottom: 8 }}>{msg}</div>}

      <table className="tbl">
        <thead><tr><th style={{ width: 70 }}>Order</th><th>Name (EN)</th><th>Name (HU)</th><th style={{ width: 70 }}>Active</th></tr></thead>
        <tbody>
          {local.map(c => (
            <tr key={c.id} className={c.is_active ? '' : 'inactive'}>
              <td><input className="cell tiny" value={c.sort_order ?? 0} onChange={e => set(c.id, { sort_order: e.target.value })} onBlur={e => patch(c.id, { sort_order: Number(e.target.value) || 0 })} /></td>
              <td><input className="cell wide" value={c.name_en} onChange={e => set(c.id, { name_en: e.target.value })} onBlur={e => patch(c.id, { name_en: e.target.value })} /></td>
              <td><input className="cell wide" value={c.name_hu || ''} onChange={e => set(c.id, { name_hu: e.target.value })} onBlur={e => patch(c.id, { name_hu: e.target.value || null })} /></td>
              <td><input type="checkbox" checked={c.is_active} onChange={e => patch(c.id, { is_active: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small" style={{ marginTop: 8 }}>Lower "Order" number shows first on the ordering page. Inactive categories hide from ordering but keep their items.</p>
    </div>
  )
}

function PricePanel({ item }) {
  const [prices, setPrices] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [f, setF] = useState({ supplier_id: '', price: '', pack_qty: '', pack_unit: '', effective_date: new Date().toISOString().slice(0, 10) })
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    const [p, s] = await Promise.all([
      fetchList('item_prices', { select: 'id,price,currency,pack_qty,pack_unit,effective_date,supplier:suppliers(name)', build: q => q.eq('catalog_item_id', item.id).order('effective_date', { ascending: false }) }),
      fetchList('suppliers', { select: 'id,name', build: q => q.eq('is_active', true).order('name') })
    ])
    setPrices(p); setSuppliers(s); setLoading(false)
  }
  useEffect(() => { load() }, [item.id])

  async function add() {
    setMsg('')
    if (!f.price) { setMsg('Price is required.'); return }
    const row = {
      catalog_item_id: item.id,
      supplier_id: f.supplier_id || null,
      price: Number(f.price),
      currency: 'HUF',
      pack_qty: f.pack_qty === '' ? null : Number(f.pack_qty),
      pack_unit: f.pack_unit || null,
      effective_date: f.effective_date
    }
    const { error } = await insertRow('item_prices', row)
    if (error) { setMsg(error.message); return }
    setF({ supplier_id: '', price: '', pack_qty: '', pack_unit: '', effective_date: new Date().toISOString().slice(0, 10) })
    load()
  }
  async function del(id) {
    await supabase.from('item_prices').delete().eq('id', id)
    setPrices(p => p.filter(x => x.id !== id))
  }

  const unitPrice = (p) => (p.pack_qty && p.pack_qty > 0) ? (p.price / p.pack_qty) : null
  const latest = prices[0]

  return (
    <div className="pricepanel">
      <div className="pp-head">
        <b>{item.name_en}</b> — price history
        {latest && <span className="pp-latest">latest: {latest.price} {latest.currency}{latest.pack_qty ? ` / ${latest.pack_qty}${latest.pack_unit || ''} = ${(latest.price / latest.pack_qty).toFixed(2)}/${latest.pack_unit || 'unit'}` : ''}</span>}
      </div>

      <div className="pp-add">
        <select value={f.supplier_id} onChange={e => setF({ ...f, supplier_id: e.target.value })}>
          <option value="">Supplier…</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input className="cell" placeholder="price (HUF)" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} />
        <span className="muted small">per</span>
        <input className="cell tiny" placeholder="qty" value={f.pack_qty} onChange={e => setF({ ...f, pack_qty: e.target.value })} />
        <input className="cell tiny" placeholder="unit" value={f.pack_unit} onChange={e => setF({ ...f, pack_unit: e.target.value })} />
        <input type="date" value={f.effective_date} onChange={e => setF({ ...f, effective_date: e.target.value })} />
        <button className="primary mini" onClick={add}>+ Add price</button>
      </div>
      {msg && <div className="error small">{msg}</div>}

      {loading ? <p className="muted small">Loading…</p> : prices.length === 0 ? <p className="muted small">No prices yet.</p> : (
        <table className="pp-table">
          <thead><tr><th>Date</th><th>Supplier</th><th>Price</th><th>Pack</th><th>Unit price</th><th></th></tr></thead>
          <tbody>
            {prices.map((p, idx) => (
              <tr key={p.id} className={idx === 0 ? 'pp-latest-row' : ''}>
                <td>{p.effective_date}</td>
                <td>{p.supplier?.name || '—'}</td>
                <td>{p.price} {p.currency}</td>
                <td>{p.pack_qty ? `${p.pack_qty}${p.pack_unit || ''}` : '—'}</td>
                <td>{unitPrice(p) != null ? `${unitPrice(p).toFixed(2)}/${p.pack_unit || 'unit'}` : '—'}</td>
                <td><button className="iconbtn" onClick={() => del(p.id)}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function specSet(i) {
  return !!(i.stock_unit || i.unit_weight != null || i.shelf_life_days != null || i.storage_location || i.reorder_level != null || i.batch_yield_qty != null)
}

function Th({ label, hint }) {
  return (
    <th>
      <span className="th-label">{label}<span className="th-info" title={hint}>ⓘ</span></span>
    </th>
  )
}
