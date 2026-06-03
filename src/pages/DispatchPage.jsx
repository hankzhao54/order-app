import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

const SELECT = `id, order_type, status, created_at, parent_order_id,
  location_id, location:locations(name_en),
  items:order_items(id, item_name_snapshot, unit_snapshot, quantity, fulfillment_type,
                    dispatch_status, fulfilled_qty, unavail_reason)`

export default function DispatchPage() {
  const { user, role } = useAuth()
  const isDriver = role === 'driver'
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDispatched, setShowDispatched] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('orders').select(SELECT)
      .in('status', ['in_progress', 'completed'])
      .order('created_at', { ascending: true })
    setOrders(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  function patchLocal(itemId, fields) {
    setOrders(os => os.map(o => ({ ...o, items: o.items.map(i => i.id === itemId ? { ...i, ...fields } : i) })))
  }
  async function dispatchItem(item) {
    await supabase.from('order_items').update({ dispatch_status: 'dispatched' }).eq('id', item.id)
    patchLocal(item.id, { dispatch_status: 'dispatched' })
  }
  async function driverGotItem(item) {
    await supabase.from('order_items')
      .update({ dispatch_status: 'ready', fulfilled_qty: item.quantity, handled_by: user.id }).eq('id', item.id)
    patchLocal(item.id, { dispatch_status: 'ready', fulfilled_qty: item.quantity })
  }
  async function dispatchAllReady(locItems) {
    const ids = locItems.filter(i => i.dispatch_status === 'ready').map(i => i.id)
    if (!ids.length) return
    await supabase.from('order_items').update({ dispatch_status: 'dispatched' }).in('id', ids)
    setOrders(os => os.map(o => ({ ...o, items: o.items.map(i => ids.includes(i.id) ? { ...i, dispatch_status: 'dispatched' } : i) })))
  }

  // group all items by location
  const byLocation = useMemo(() => {
    const m = new Map()
    for (const o of orders) {
      for (const it of o.items) {
        const key = o.location_id
        if (!m.has(key)) m.set(key, { name: o.location?.name_en || '—', items: [] })
        m.get(key).items.push({ ...it, _order: o })
      }
    }
    return m
  }, [orders])

  if (loading) return <div className="center muted">Loading…</div>
  if (byLocation.size === 0) return <div className="center muted">Nothing in the kitchen pipeline right now.</div>

  return (
    <div className="dispatch">
      <div className="toolbar">
        <label className="inline"><input type="checkbox" checked={showDispatched} onChange={e => setShowDispatched(e.target.checked)} /> show already-dispatched</label>
      </div>
      {[...byLocation.values()].map((loc, idx) => {
        const make = loc.items.filter(i => i.fulfillment_type === 'make' || !i.fulfillment_type)
        const buy = loc.items.filter(i => i.fulfillment_type === 'purchase')
        const ready = loc.items.filter(i => i.dispatch_status === 'ready')
        return (
          <div className="dcard" key={idx}>
            <div className="dhead">
              <h3>{loc.name}</h3>
              <div className="dcounts">
                <span className="cnt ok">✅ {loc.items.filter(i => i.dispatch_status === 'ready').length}</span>
                <span className="cnt wait">⏳ {loc.items.filter(i => i.dispatch_status === 'pending').length}</span>
                <span className="cnt warn">⚠️ {loc.items.filter(i => ['short', 'unavailable'].includes(i.dispatch_status)).length}</span>
                <span className="cnt sent">📦 {loc.items.filter(i => i.dispatch_status === 'dispatched').length}</span>
              </div>
              {!isDriver && <button className="primary" disabled={!ready.length} onClick={() => dispatchAllReady(loc.items)}>Dispatch {loc.name} ({ready.length})</button>}
            </div>
            <div className="dcols">
              <Column title="🍳 Make" items={make} {...{ showDispatched, isDriver, dispatchItem, driverGotItem }} />
              <Column title="🛒 Buy"  items={buy}  {...{ showDispatched, isDriver, dispatchItem, driverGotItem }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Column({ title, items, showDispatched, isDriver, dispatchItem, driverGotItem }) {
  const visible = items.filter(i => showDispatched || i.dispatch_status !== 'dispatched')
  return (
    <div className="dcol">
      <div className="dcoltitle">{title} <span className="muted">({visible.length})</span></div>
      {visible.length === 0 && <p className="muted small pad">—</p>}
      {visible.map(i => (
        <div key={i.id} className={`drow ds-${i.dispatch_status}`}>
          <div className="dinfo">
            <span className="dname">{i.item_name_snapshot}</span>
            <span className="dqty muted">
              {i.dispatch_status === 'short' ? `${i.fulfilled_qty}/${i.quantity}` : i.quantity}{i.unit_snapshot ? ` ${i.unit_snapshot}` : ''}
              {i.dispatch_status === 'unavailable' && ` · ✕ ${i.unavail_reason || 'none'}`}
            </span>
          </div>
          <div className="dactions">
            {i.dispatch_status === 'dispatched' && <span className="statuschip sent">📦 sent</span>}
            {i.dispatch_status === 'pending' && isDriver && i.fulfillment_type === 'purchase' &&
              <button className="mini ok" onClick={() => driverGotItem(i)}>I got it</button>}
            {i.dispatch_status === 'pending' && !isDriver && <span className="statuschip wait">⏳ in progress</span>}
            {['ready', 'short'].includes(i.dispatch_status) &&
              <button className="mini send" onClick={() => dispatchItem(i)}>📦 Dispatch</button>}
            {i.dispatch_status === 'unavailable' && <span className="statuschip bad">needs arranging</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
