import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'
import {
  loadCatalog, addFavorite, removeFavorite, submitOrder,
  loadTemplates, saveTemplate, loadHistory
} from '../lib/orderData'
import { loadCutoff, productionWeek, cutoffLabel } from '../lib/cutoff'

export default function OrderingPage() {
  const { locationId, isStaff, profile } = useAuth()
  const [cutoff, setCutoff] = useState(null)
  const [locations, setLocations] = useState([])
  const [locId, setLocId] = useState(locationId || '')
  const [cats, setCats] = useState([])
  const [items, setItems] = useState([])
  const [favs, setFavs] = useState([])
  const [open, setOpen] = useState({ __fav: true })   // which category drawers are open
  const [cart, setCart] = useState({})                 // id -> qty
  const [adhoc, setAdhoc] = useState([])
  const [orderType, setOrderType] = useState('weekly')
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('order')              // order | history
  const [templates, setTemplates] = useState([])
  const [history, setHistory] = useState([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [amending, setAmending] = useState(null)   // { id, label } when adding to a locked order

  useEffect(() => { loadCutoff().then(setCutoff) }, [])
  const prodWeek = cutoff && orderType === 'weekly' ? productionWeek(cutoff) : null

  // staff (no fixed location) can pick a location to order for
  useEffect(() => {
    if (isStaff || !locationId)
      supabase.from('locations').select('id,name_en').eq('is_active', true).order('name_en')
        .then(({ data }) => { setLocations(data || []); if (!locId && data?.length) setLocId(data[0].id) })
  }, [])

  useEffect(() => {
    if (!locId) return
    loadCatalog(locId).then(({ cats, items, favs }) => { setCats(cats); setItems(items); setFavs(favs) })
    loadTemplates(locId).then(setTemplates)
  }, [locId])

  const byId = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])
  const favItems = favs.map(f => ({ fav: f, it: byId[f.catalog_item_id] })).filter(x => x.it)
  const favSet = new Set(favs.map(f => f.catalog_item_id))
  const catName = id => cats.find(c => c.id === id)?.name_en || 'Uncategorized'
  const unitOf = it => it.order_unit || it.stock_unit || ''
  const locName = locations.find(l => l.id === locId)?.name_en
    || profile?.location?.name_en || ''

  const search = q.trim().toLowerCase()
  const itemsByCat = useMemo(() => {
    const m = new Map()
    for (const it of items) {
      const k = it.category_id || 'none'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(it)
    }
    return m
  }, [items])
  const searchHits = search
    ? items.filter(i => `${i.name_en} ${i.name_hu || ''}`.toLowerCase().includes(search))
    : null

  const lines = Object.entries(cart).filter(([, n]) => n > 0)
    .map(([id, n]) => ({ ...byId[id], qty: n }))
  const totalLines = lines.length + adhoc.filter(a => a.name).length

  function add(id) { setCart(p => ({ ...p, [id]: p[id] ? p[id] : 1 })) }
  function setQty(id, n) { setCart(p => ({ ...p, [id]: Math.max(0, n) })) }
  function toggleCat(k) { setOpen(p => ({ ...p, [k]: !p[k] })) }

  async function toggleFav(id) {
    const existing = favs.find(f => f.catalog_item_id === id)
    if (existing) { await removeFavorite(id); setFavs(p => p.filter(f => f.catalog_item_id !== id)) }
    else { const f = await addFavorite(id); if (f) setFavs(p => [...p, f]) }
  }

  async function doSubmit() {
    if (!locId) { setMsg('Pick a location.'); return }
    if (totalLines === 0) { setMsg('Cart is empty.'); return }
    setBusy(true); setMsg('')
    try {
      const res = await submitOrder({ locationId: locId, orderType, lines, adhoc, parentOrderId: amending?.id, productionWeek: orderType === 'weekly' ? prodWeek : null })
      const n = res?.count ?? res
      setCart({}); setAdhoc([])
      setMsg(amending
        ? `✓ Top-up submitted for ${amending.label} — ${n} item(s).`
        : res?.merged
          ? `✓ Added to this week's existing order — ${n} item(s) merged.`
          : `✓ Order submitted — ${n} item(s).`)
      setAmending(null)
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  function loadTemplateIntoCart(t) {
    const next = {}
    for (const it of t.items) if (it.catalog_item_id) next[it.catalog_item_id] = it.default_qty
    setCart(next); setMsg(`Loaded template "${t.name}" — adjust & submit.`)
  }
  async function repeatLastOrder() {
    if (!locId) { setMsg('Pick a location.'); return }
    const { data, error } = await supabase.from('orders')
      .select('id, created_at, items:order_items(catalog_item_id, quantity)')
      .eq('location_id', locId).neq('status', 'cancelled')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) { setMsg(error.message); return }
    if (!data || !data.items?.length) { setMsg('No previous order found for this location.'); return }
    const next = {}
    for (const it of data.items) if (it.catalog_item_id) next[it.catalog_item_id] = (next[it.catalog_item_id] || 0) + Number(it.quantity)
    if (Object.keys(next).length === 0) { setMsg('Last order had no standard items to repeat.'); return }
    setCart(next); setTab('order')
    setMsg(`Loaded your last order (${new Date(data.created_at).toLocaleDateString()}) — adjust & submit.`)
  }
  async function doSaveTemplate() {
    const name = prompt('Template name (e.g. "Weekly – 101 Neo")')
    if (!name) return
    try { await saveTemplate(locId, name, lines); setTemplates(await loadTemplates(locId)); setMsg(`Saved template "${name}".`) }
    catch (e) { setMsg(e.message) }
  }

  function openHistory() { setTab('history'); loadHistory(locId).then(setHistory) }

  function startAmend(o) {
    setAmending({ id: o.id, label: `${o.order_type} order ${new Date(o.created_at).toLocaleDateString()}` })
    setCart({}); setAdhoc([]); setTab('order')
    setMsg('')
  }

  // ---------- render ----------
  const ItemRow = ({ it }) => (
    <div className={`orow ${cart[it.id] > 0 ? 'in' : ''}`}>
      <button className="favstar" title="Favorite" onClick={() => toggleFav(it.id)}>
        {favSet.has(it.id) ? '★' : '☆'}
      </button>
      <div className="oinfo" onClick={() => add(it.id)}>
        <div className="oname">{it.name_en}{unitOf(it) && <span className="ounit">/ {unitOf(it)}</span>}</div>
        <div className="osub muted">{it.name_hu}</div>
      </div>
      {cart[it.id] > 0
        ? <div className="ministep">
            <button onClick={() => setQty(it.id, cart[it.id] - 1)}>−</button>
            <span>{cart[it.id]}{unitOf(it) ? <small> {unitOf(it)}</small> : ''}</span>
            <button onClick={() => setQty(it.id, cart[it.id] + 1)}>+</button>
          </div>
        : <button className="addbtn" onClick={() => add(it.id)}>Add</button>}
    </div>
  )

  return (
    <div className="orderpage">
      {/* sticky location bar */}
      <div className="locbar">
        <div className="locpick">
          <span className="locpin">📍</span>
          {(isStaff || !locationId) ? (
            <select className="locselect" value={locId} onChange={e => setLocId(e.target.value)}>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
            </select>
          ) : (
            <span className="locname">{locName || '—'}</span>
          )}
        </div>
        <div className="seg locbartabs">
          <button className={tab === 'order' ? 'on' : ''} onClick={() => setTab('order')}>Order</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={openHistory}>History</button>
        </div>
      </div>

      {tab === 'history' ? (
        <HistoryView history={history} onAmend={startAmend} />
      ) : (
        <div className="orderbody">
          <div className="browse">
            {amending && (
              <div className="amend-banner">
                <span>➕ Adding a top-up to <b>{amending.label}</b>. Submit creates a linked urgent order.</span>
                <button className="mini" onClick={() => { setAmending(null); setMsg('') }}>Cancel</button>
              </div>
            )}
            <input className="search" placeholder="Search all items…" value={q} onChange={e => setQ(e.target.value)} />

            {search ? (
              <div className="catdrawer openalways">
                <div className="cathdr static">Search results ({searchHits.length})</div>
                <div className="catitems">{searchHits.map(it => <ItemRow key={it.id} it={it} />)}</div>
              </div>
            ) : (
              <>
                {/* favorites drawer */}
                <div className="catdrawer">
                  <button className="cathdr" onClick={() => toggleCat('__fav')}>
                    <span>★ Favorites <span className="muted">({favItems.length})</span></span>
                    <span>{open.__fav ? '▾' : '▸'}</span>
                  </button>
                  {open.__fav && (
                    <div className="catitems">
                      {favItems.length === 0 && <p className="muted pad">Tap ☆ on any item to pin it to your favorites.</p>}
                      {favItems.map(({ it }) => <ItemRow key={it.id} it={it} />)}
                    </div>
                  )}
                </div>

                {/* quick start */}
                <div className="quickstart">
                  <button className="btn-repeat" onClick={repeatLastOrder}>↻ Repeat last order</button>
                  {templates.length > 0 && <span className="muted small" style={{ marginLeft: 4 }}>or a template:</span>}
                  {templates.map(t => (
                    <button key={t.id} className="chip" onClick={() => loadTemplateIntoCart(t)}>{t.name}</button>
                  ))}
                </div>

                {/* category drawers */}
                {cats.map(c => {
                  const list = itemsByCat.get(c.id) || []
                  if (!list.length) return null
                  return (
                    <div className="catdrawer" key={c.id}>
                      <button className="cathdr" onClick={() => toggleCat(c.id)}>
                        <span>{c.name_en} <span className="muted">({list.length})</span></span>
                        <span>{open[c.id] ? '▾' : '▸'}</span>
                      </button>
                      {open[c.id] && <div className="catitems">{list.map(it => <ItemRow key={it.id} it={it} />)}</div>}
                    </div>
                  )
                })}
              </>
            )}
          </div>

          {/* cart */}
          <aside className="cart">
            <h3>Cart <span className="muted">({totalLines})</span></h3>
            {cutoff && orderType === 'weekly' && prodWeek && (
              <div className="cutoff-banner">📅 This weekly order is for production week of <b>{prodWeek}</b> (cutoff {cutoffLabel(cutoff)}).</div>
            )}
            {orderType === 'urgent' && (
              <div className="cutoff-banner locked">🔥 Urgent order — handled right away, not tied to a production week.</div>
            )}
            <div className="seg">
              {['weekly', 'urgent'].map(t =>
                <button key={t} className={orderType === t ? 'on' : ''} onClick={() => setOrderType(t)}>{t}</button>)}
            </div>
            <div className="cartlist">
              {lines.length === 0 && adhoc.length === 0 && <p className="muted">Cart is empty.</p>}
              {lines.map(l => (
                <div key={l.id} className="cartrow">
                  <span className="cn">{l.name_en}</span>
                  <div className="ministep">
                    <button onClick={() => setQty(l.id, l.qty - 1)}>−</button>
                    <span>{l.qty}</span>
                    <button onClick={() => setQty(l.id, l.qty + 1)}>+</button>
                  </div>
                </div>
              ))}
              {adhoc.map((a, i) => (
                <div key={i} className="cartrow adhoc">
                  <input placeholder="Custom item" value={a.name} onChange={e => setAdhoc(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <input className="qty" placeholder="qty" value={a.qty} onChange={e => setAdhoc(p => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                </div>
              ))}
            </div>
            <button className="ghost full" onClick={() => setAdhoc(p => [...p, { name: '', qty: '', unit: '' }])}>+ Custom item</button>
            {lines.length > 0 && <button className="ghost full" onClick={doSaveTemplate}>Save as template</button>}
            {msg && <div className="notice">{msg}</div>}
            <button className="primary full" disabled={busy} onClick={doSubmit}>{busy ? 'Submitting…' : `Submit (${totalLines})`}</button>
          </aside>
        </div>
      )}
    </div>
  )
}

function HistoryView({ history, onAmend }) {
  if (!history.length) return <div className="center muted">No past orders for this location yet.</div>
  return (
    <div className="history">
      {history.map(o => (
        <div className="hcard" key={o.id}>
          <div className="hhead">
            <b>{new Date(o.created_at).toLocaleDateString()}</b>
            <span className={`tag ${o.order_type}`}>{o.order_type}</span>
            <span className={`tag st-${o.status}`}>{o.status}</span>
            {o.parent_order_id && <span className="tag amend">top-up</span>}
            <span className="muted small">{o.items.length} items</span>
            {onAmend && ['in_progress', 'submitted'].includes(o.status) &&
              <button className="mini amend-btn" onClick={() => onAmend(o)}>➕ Add to this</button>}
          </div>
          <div className="hitems">
            {o.items.map(i => (
              <span key={i.id} className="hitem">
                {i.quantity}{i.unit_snapshot ? ` ${i.unit_snapshot}` : ''} {i.item_name_snapshot}
                {i.fulfillment_type === 'make' ? ' 🍳' : i.fulfillment_type === 'purchase' ? ' 🛒' : ''}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
