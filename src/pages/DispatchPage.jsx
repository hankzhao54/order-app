import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchList, patchRow } from '../lib/db'
import { useAuth } from '../lib/AuthProvider'
import { useRealtimeReload } from '../lib/useRealtimeReload'

const SELECT = `id, order_type, status, created_at, parent_order_id,
  location_id, location:locations(name_en),
  items:order_items(id, catalog_item_id, item_name_snapshot, unit_snapshot, quantity, fulfillment_type,
                    dispatch_status, fulfilled_qty, unavail_reason)`

const REASONS = ['Out of stock', "Can't make", 'Not found']
// terminal = ok to archive at week close
const TERMINAL = ['dispatched', 'received', 'unavailable']

export default function DispatchPage() {
  const { user, role } = useAuth()
  const isDriver = role === 'driver'
  const isStaff = role === 'kitchen_manager' || role === 'admin'
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDispatched, setShowDispatched] = useState(false)
  const [reasonFor, setReasonFor] = useState(null)   // item id awaiting reason
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    const data = await fetchList('orders', {
      select: SELECT,
      build: q => q.in('status', ['in_progress', 'completed']).order('created_at', { ascending: true }).limit(500)
    })
    setOrders(data); setLoading(false)
  }
  useEffect(() => { load() }, [])
  useRealtimeReload(['orders', 'order_items'], load)

  function patchLocal(itemId, fields) {
    setOrders(os => os.map(o => ({ ...o, items: o.items.map(i => i.id === itemId ? { ...i, ...fields } : i) })))
  }
  async function markReady(item) {
    await patchRow('order_items', item.id, { dispatch_status: 'ready', status: 'done', fulfilled_qty: item.quantity, handled_by: user.id })
    patchLocal(item.id, { dispatch_status: 'ready', fulfilled_qty: item.quantity })
  }
  async function markUnavailable(item, reason) {
    await patchRow('order_items', item.id, { dispatch_status: 'unavailable', status: 'done', fulfilled_qty: 0, unavail_reason: reason, handled_by: user.id })
    patchLocal(item.id, { dispatch_status: 'unavailable', unavail_reason: reason }); setReasonFor(null)
  }
  async function centralLoc() {
    const { data } = await supabase.from('locations').select('id').eq('is_central', true).eq('is_active', true).limit(1).maybeSingle()
    return data?.id || null
  }
  async function dispatchItem(item) {
    await patchRow('order_items', item.id, { dispatch_status: 'dispatched' })
    patchLocal(item.id, { dispatch_status: 'dispatched' })
    if (item.catalog_item_id && item.fulfillment_type === 'make') {
      const qty = Number(item.fulfilled_qty ?? item.quantity) || 0
      const c = await centralLoc()
      if (qty && c) await supabase.rpc('consume_fifo', { p_loc: c, p_item: item.catalog_item_id, p_qty: qty, p_reason: 'dispatched', p_order_item: item.id })
    }
  }
  async function dispatchAllReady(locItems) {
    const ready = locItems.filter(i => ['ready', 'short'].includes(i.dispatch_status))
    const ids = ready.map(i => i.id)
    if (!ids.length) return
    await supabase.from('order_items').update({ dispatch_status: 'dispatched' }).in('id', ids)
    setOrders(os => os.map(o => ({ ...o, items: o.items.map(i => ids.includes(i.id) ? { ...i, dispatch_status: 'dispatched' } : i) })))
    const c = await centralLoc()
    // consume_fifo mutates shared stock-batch state for (location, item), so
    // calls for the same item must stay serial to avoid a race in FIFO
    // consumption order; only the bulk status update above was parallelizable.
    for (const it of ready) {
      if (c && it.catalog_item_id && it.fulfillment_type === 'make') {
        const qty = Number(it.fulfilled_qty ?? it.quantity) || 0
        if (qty) await supabase.rpc('consume_fifo', { p_loc: c, p_item: it.catalog_item_id, p_qty: qty, p_reason: 'dispatched', p_order_item: it.id })
      }
    }
  }

  function printSlip(locName, items) {
    const rows = items
      .filter(i => i.dispatch_status !== 'unavailable')
      .map(i => {
        const qty = i.dispatch_status === 'short' ? `${i.fulfilled_qty}/${i.quantity}` : i.quantity
        const tag = i.fulfillment_type === 'purchase' ? '🛒' : '🍳'
        return `<tr><td class="chk">☐</td><td>${tag} ${i.item_name_snapshot}</td><td class="q">${qty}${i.unit_snapshot ? ' ' + i.unit_snapshot : ''}</td></tr>`
      }).join('')
    const today = new Date().toLocaleDateString()
    const w = window.open('', '_blank', 'width=420,height=640')
    w.document.write(`<html><head><title>Delivery slip — ${locName}</title>
      <style>
        body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#111}
        h1{font-size:20px;margin:0 0 2px} .sub{color:#666;font-size:13px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse} td{padding:8px 6px;border-bottom:1px solid #ddd;font-size:15px}
        .chk{width:28px;font-size:18px} .q{text-align:right;white-space:nowrap;font-weight:600}
        .foot{margin-top:24px;font-size:13px;color:#666}
      </style></head><body>
      <h1>🚚 Delivery — ${locName}</h1>
      <div class="sub">${today} · ${items.filter(i => i.dispatch_status !== 'unavailable').length} items</div>
      <table>${rows}</table>
      <div class="foot">Received by: ____________________  Signature: ____________________</div>
      <script>window.onload=()=>{window.print()}</script>
      </body></html>`)
    w.document.close()
  }

  // ---- week close (archive) ----
  const unfinished = useMemo(() => {
    let n = 0
    for (const o of orders) for (const it of o.items) if (!TERMINAL.includes(it.dispatch_status)) n++
    return n
  }, [orders])

  async function closeWeek() {
    if (unfinished > 0) { setMsg(`Can't close: ${unfinished} item(s) still not dispatched or marked unavailable. Handle them first.`); return }
    if (!orders.length) { setMsg('Nothing to close.'); return }
    if (!confirm(`Close & archive ${orders.length} order(s)? They move to History (by week) and clear from here.`)) return
    const ids = orders.map(o => o.id)
    const { error } = await supabase.from('orders').update({ status: 'archived' }).in('id', ids)
    if (error) { setMsg(error.message); return }
    setMsg(`✓ Archived ${ids.length} order(s). New week starts clean.`); load()
  }

  const byLocation = useMemo(() => {
    const m = new Map()
    for (const o of orders) for (const it of o.items) {
      const key = o.location_id
      if (!m.has(key)) m.set(key, { name: o.location?.name_en || '—', items: [] })
      m.get(key).items.push(it)
    }
    return m
  }, [orders])

  if (loading) return <div className="center muted">Loading…</div>

  return (
    <div className="dispatch">
      <div className="toolbar dispatch-bar">
        <div className="seg">
          <button className={!showDispatched ? 'on' : ''} onClick={() => setShowDispatched(false)}>Active</button>
          <button className={showDispatched ? 'on' : ''} onClick={() => setShowDispatched(true)}>Dispatched</button>
        </div>
        {isStaff && (
          <button className={`primary ${unfinished > 0 ? 'is-disabled' : ''}`} onClick={closeWeek} title={unfinished > 0 ? `${unfinished} item(s) unfinished` : ''}>
            🗓 Close week & archive{unfinished > 0 ? ` (${unfinished} left)` : ''}
          </button>
        )}
      </div>
      {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}

      {byLocation.size === 0 && <div className="center muted">Nothing in the pipeline right now.</div>}

      {[...byLocation.values()].map((loc, idx) => {
        const make = loc.items.filter(i => i.fulfillment_type === 'make' || !i.fulfillment_type)
        const buy = loc.items.filter(i => i.fulfillment_type === 'purchase')
        const readyN = loc.items.filter(i => ['ready', 'short'].includes(i.dispatch_status)).length
        const shared = { showDispatched, isDriver, isStaff, reasonFor, setReasonFor, markReady, markUnavailable, dispatchItem }
        return (
          <div className="dcard" key={idx}>
            <div className="dhead">
              <h3>{loc.name}</h3>
              <div className="dcounts">
                <span className="cnt ok">✅ {loc.items.filter(i => ['ready', 'short'].includes(i.dispatch_status)).length}</span>
                <span className="cnt wait">⏳ {loc.items.filter(i => i.dispatch_status === 'pending').length}</span>
                <span className="cnt buy2">🛒 {loc.items.filter(i => i.dispatch_status === 'procuring').length}</span>
                <span className="cnt warn">⚠️ {loc.items.filter(i => i.dispatch_status === 'unavailable').length}</span>
                <span className="cnt sent">📦 {loc.items.filter(i => i.dispatch_status === 'dispatched').length}</span>
              </div>
              <button className="ghost" onClick={() => printSlip(loc.name, loc.items)}>🖨 Slip</button>
              {!isDriver && <button className="primary" disabled={!readyN} onClick={() => dispatchAllReady(loc.items)}>Dispatch {loc.name} ({readyN})</button>}
            </div>
            <div className="dcols">
              <Column title="🍳 Make" items={make} {...shared} />
              <Column title="🛒 Buy" items={buy} {...shared} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Column({ title, items, showDispatched, isDriver, isStaff, reasonFor, setReasonFor, markReady, markUnavailable, dispatchItem }) {
  const visible = items.filter(i => showDispatched || !['dispatched','received'].includes(i.dispatch_status))
  return (
    <div className="dcol">
      <div className="dcoltitle">{title} <span className="muted">({visible.length})</span></div>
      {visible.length === 0 && <p className="muted small pad">—</p>}
      {visible.map(i => {
        const isBuy = i.fulfillment_type === 'purchase'
        return (
          <div key={i.id} className={`drow ds-${i.dispatch_status}`}>
            <div className="dinfo">
              <span className="dname">{i.item_name_snapshot}</span>
              <span className="dqty muted">
                {i.dispatch_status === 'short' ? `${i.fulfilled_qty}/${i.quantity}` : i.quantity}{i.unit_snapshot ? ` ${i.unit_snapshot}` : ''}
                {i.dispatch_status === 'unavailable' && ` · ✕ ${i.unavail_reason || 'none'}`}
              </span>
            </div>
            <div className="dactions">
              {i.dispatch_status === 'dispatched' && <span className="statuschip sent">📦 delivered</span>}
              {i.dispatch_status === 'received' && <span className="statuschip ready">✓ received</span>}
              {i.dispatch_status === 'procuring' && (
                <>
                  <span className="statuschip buy2">🛒 with buyer</span>
                  <button className="mini ok" onClick={() => markReady(i)}>✓ Received</button>
                </>
              )}

              {i.dispatch_status === 'pending' && reasonFor !== i.id && (
                <>
                  <button className="mini ok" onClick={() => markReady(i)}>{isBuy ? '✓ Bought' : '✓ Ready'}</button>
                  <button className="mini bad" onClick={() => setReasonFor(i.id)}>✕ None</button>
                </>
              )}
              {reasonFor === i.id && (
                <div className="inline-edit wrap">
                  {REASONS.map(r => <button key={r} className="mini bad" onClick={() => markUnavailable(i, r)}>{r}</button>)}
                  <button className="mini" onClick={() => setReasonFor(null)}>Cancel</button>
                </div>
              )}

              {['ready', 'short'].includes(i.dispatch_status) &&
                <button className="mini send" onClick={() => dispatchItem(i)}>📦 Delivered</button>}
              {i.dispatch_status === 'unavailable' && <span className="statuschip bad">needs arranging</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
