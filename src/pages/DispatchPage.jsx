import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { useRealtimeReload } from '../lib/useRealtimeReload'

const SELECT = `id, order_type, status, created_at, parent_order_id,
  location_id, location:locations(name_en),
  items:order_items(id, item_name_snapshot, unit_snapshot, quantity, fulfillment_type,
                    dispatch_status, fulfilled_qty, unavail_reason)`

const REASONS = ['Out of stock', "Can't make", 'Not found']
// terminal = ok to archive at week close
const TERMINAL = ['dispatched', 'unavailable']

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
    const { data } = await supabase.from('orders').select(SELECT)
      .in('status', ['in_progress', 'completed'])
      .order('created_at', { ascending: true })
    setOrders(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])
  useRealtimeReload(['orders', 'order_items'], load)

  function patchLocal(itemId, fields) {
    setOrders(os => os.map(o => ({ ...o, items: o.items.map(i => i.id === itemId ? { ...i, ...fields } : i) })))
  }
  async function markReady(item) {
    await supabase.from('order_items').update({ dispatch_status: 'ready', status: 'done', fulfilled_qty: item.quantity, handled_by: user.id }).eq('id', item.id)
    patchLocal(item.id, { dispatch_status: 'ready', fulfilled_qty: item.quantity })
  }
  async function markUnavailable(item, reason) {
    await supabase.from('order_items').update({ dispatch_status: 'unavailable', status: 'done', fulfilled_qty: 0, unavail_reason: reason, handled_by: user.id }).eq('id', item.id)
    patchLocal(item.id, { dispatch_status: 'unavailable', unavail_reason: reason }); setReasonFor(null)
  }
  async function dispatchItem(item) {
    await supabase.from('order_items').update({ dispatch_status: 'dispatched' }).eq('id', item.id)
    patchLocal(item.id, { dispatch_status: 'dispatched' })
  }
  async function dispatchAllReady(locItems) {
    const ids = locItems.filter(i => ['ready', 'short'].includes(i.dispatch_status)).map(i => i.id)
    if (!ids.length) return
    await supabase.from('order_items').update({ dispatch_status: 'dispatched' }).in('id', ids)
    setOrders(os => os.map(o => ({ ...o, items: o.items.map(i => ids.includes(i.id) ? { ...i, dispatch_status: 'dispatched' } : i) })))
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
        <label className="inline"><input type="checkbox" checked={showDispatched} onChange={e => setShowDispatched(e.target.checked)} /> show already-dispatched</label>
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
  const visible = items.filter(i => showDispatched || i.dispatch_status !== 'dispatched')
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
