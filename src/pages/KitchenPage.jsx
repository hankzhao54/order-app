import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const SELECT = `id, order_type, status, created_at, parent_order_id,
  location:locations(name_en),
  items:order_items(id, item_name_snapshot, unit_snapshot, quantity, fulfillment_type,
                    dispatch_status, fulfilled_qty, unavail_reason)`

const REASONS = ['Out of stock', "Can't make in time", 'Temporarily unavailable']

export default function KitchenPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // { itemId, mode: 'short'|'none'|'qty', qty }
  const [showCancelled, setShowCancelled] = useState(false)
  const [cancelled, setCancelled] = useState([])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('orders').select(SELECT)
      .in('status', ['submitted', 'in_progress'])
      .order('created_at', { ascending: true })
    setOrders(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  function patchItemLocal(itemId, fields) {
    setOrders(os => os.map(o => ({ ...o, items: o.items.map(i => i.id === itemId ? { ...i, ...fields } : i) })))
  }
  async function ensureStarted(orderId) {
    const o = orders.find(x => x.id === orderId)
    if (o && o.status === 'submitted') {
      await supabase.from('orders').update({ status: 'in_progress' }).eq('id', orderId)
      setOrders(os => os.map(x => x.id === orderId ? { ...x, status: 'in_progress' } : x))
    }
  }
  async function setFulfillment(item, type) {
    await supabase.from('order_items').update({ fulfillment_type: type }).eq('id', item.id)
    patchItemLocal(item.id, { fulfillment_type: type })
  }
  async function setReady(item, orderId) {
    setEditing(null)
    await ensureStarted(orderId)
    await supabase.from('order_items').update({ dispatch_status: 'ready', status: 'done', fulfilled_qty: item.quantity, unavail_reason: null }).eq('id', item.id)
    patchItemLocal(item.id, { dispatch_status: 'ready', fulfilled_qty: item.quantity, unavail_reason: null })
  }
  async function confirmShort(item, orderId, qty) {
    await ensureStarted(orderId)
    await supabase.from('order_items').update({ dispatch_status: 'short', status: 'done', fulfilled_qty: qty, unavail_reason: null }).eq('id', item.id)
    patchItemLocal(item.id, { dispatch_status: 'short', fulfilled_qty: qty, unavail_reason: null })
    setEditing(null)
  }
  async function confirmNone(item, orderId, reason) {
    await ensureStarted(orderId)
    await supabase.from('order_items').update({ dispatch_status: 'unavailable', status: 'done', fulfilled_qty: 0, unavail_reason: reason }).eq('id', item.id)
    patchItemLocal(item.id, { dispatch_status: 'unavailable', fulfilled_qty: 0, unavail_reason: reason })
    setEditing(null)
  }
  async function resetItem(item) {
    setEditing(null)
    await supabase.from('order_items').update({ dispatch_status: 'pending', status: 'pending', fulfilled_qty: null, unavail_reason: null }).eq('id', item.id)
    patchItemLocal(item.id, { dispatch_status: 'pending', fulfilled_qty: null, unavail_reason: null })
  }
  async function completeOrder(orderId) {
    await supabase.from('orders').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', orderId)
    setOrders(os => os.filter(o => o.id !== orderId))
  }

  async function sendToProcurement(item, order) {
    const { error } = await supabase.from('procurement_tasks').insert({
      item_name: item.item_name_snapshot,
      catalog_item_id: null,
      quantity: item.quantity,
      unit: item.unit_snapshot || null,
      target_location_id: null,
      source_order_item_id: item.id,
      note: `from ${order.location?.name_en || 'order'}`,
      created_by: (await supabase.auth.getUser()).data.user?.id
    })
    if (error) { alert(error.message); return }
    // kitchen is done with this line — it now goes through the buy list
    await supabase.from('order_items').update({ dispatch_status: 'procuring', status: 'done' }).eq('id', item.id)
    patchItemLocal(item.id, { dispatch_status: 'procuring' })
  }

  async function saveQty(item, qty) {
    await supabase.from('order_items').update({ quantity: qty }).eq('id', item.id)
    patchItemLocal(item.id, { quantity: qty })
    setEditing(null)
  }
  async function deleteItem(item) {
    if (!confirm(`Delete "${item.item_name_snapshot}" from this order?`)) return
    await supabase.from('order_items').delete().eq('id', item.id)
    setOrders(os => os.map(o => ({ ...o, items: o.items.filter(i => i.id !== item.id) })))
  }
  async function cancelOrder(orderId) {
    if (!confirm('Cancel this whole order? It will move to the cancelled list (recoverable).')) return
    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId)
    setOrders(os => os.filter(o => o.id !== orderId))
  }
  async function loadCancelled() {
    const { data } = await supabase.from('orders').select(SELECT)
      .eq('status', 'cancelled').order('created_at', { ascending: false }).limit(30)
    setCancelled(data || [])
  }
  async function restoreOrder(orderId) {
    await supabase.from('orders').update({ status: 'submitted' }).eq('id', orderId)
    setCancelled(cs => cs.filter(o => o.id !== orderId))
    load()
  }
  function toggleCancelled() {
    const next = !showCancelled
    setShowCancelled(next)
    if (next) loadCancelled()
  }

  if (loading) return <div className="center muted">Loading…</div>

  return (
    <div className="tickets">
      <div className="toolbar">
        <span className="muted">{orders.length} open order(s)</span>
        <button className="ghost" onClick={toggleCancelled}>
          {showCancelled ? 'Hide cancelled' : 'View cancelled'}
        </button>
      </div>

      {orders.length === 0 && <div className="center muted">No open orders. 🎉</div>}
      {orders.map(o => {
        const handled = o.items.filter(i => i.dispatch_status !== 'pending').length
        const allHandled = o.items.length > 0 && handled === o.items.length
        const n = s => o.items.filter(i => i.dispatch_status === s).length
        const pend = n('pending'), rdy = n('ready'), sh = n('short'), un = n('unavailable'), dis = n('dispatched')
        const proc = n('procuring')
        return (
          <div key={o.id} className="ticket">
            <div className="tickethead">
              <div>
                <b>{o.location?.name_en}</b>
                <span className={`tag ${o.order_type}`}>{o.order_type}</span>
                {o.parent_order_id && <span className="tag amend">🔁 amendment</span>}
              </div>
              <span className="muted small">{new Date(o.created_at).toLocaleString()}</span>
            </div>
            <div className="progressline">
              {pend > 0 && <span className="pc pend">待做 {pend}</span>}
              {rdy > 0 && <span className="pc ok">✅ {rdy}</span>}
              {sh > 0 && <span className="pc warn">≈ {sh}</span>}
              {un > 0 && <span className="pc bad">✕ {un}</span>}
              {proc > 0 && <span className="pc buy">📋 {proc}</span>}
              {dis > 0 && <span className="pc sent">📦 {dis}</span>}
            </div>

            <div className="ticketitems">
              {o.items.map(i => {
                const isEditing = editing?.itemId === i.id
                return (
                  <div key={i.id} className={`tline ds-${i.dispatch_status}`}>
                    <div className="tline-top">
                      <span className="qty">{i.quantity}{i.unit_snapshot ? ` ${i.unit_snapshot}` : ''}</span>
                      <span className="tname">{i.item_name_snapshot}</span>
                      <div className="seg tiny mlauto">
                        <button className={i.fulfillment_type === 'make' ? 'on make' : ''} onClick={() => setFulfillment(i, 'make')}>🍳</button>
                        <button className={i.fulfillment_type === 'purchase' ? 'on buy' : ''} onClick={() => setFulfillment(i, 'purchase')}>🛒</button>
                      </div>
                    </div>
                    <div className="tline-tools">
                      <button className="linkbtn" onClick={() => setEditing({ itemId: i.id, mode: 'qty', qty: i.quantity })}>✏️ qty</button>
                      <button className="linkbtn" onClick={() => deleteItem(i)}>🗑 remove</button>
                      <button className="linkbtn" onClick={() => sendToProcurement(i, o)}>📋 to buyer</button>
                    </div>

                    {/* inline QTY editor (kitchen can correct the ordered amount) */}
                    {isEditing && editing.mode === 'qty' && (
                      <div className="inline-edit">
                        <span className="muted small">Ordered qty</span>
                        <div className="ministep">
                          <button onClick={() => setEditing(e => ({ ...e, qty: Math.max(0, e.qty - 1) }))}>−</button>
                          <input value={editing.qty} onChange={e => setEditing(s => ({ ...s, qty: Math.max(0, Number(e.target.value) || 0) }))} />
                          <button onClick={() => setEditing(e => ({ ...e, qty: e.qty + 1 }))}>+</button>
                        </div>
                        <button className="mini ok" onClick={() => saveQty(i, editing.qty)}>Save</button>
                        <button className="mini" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    )}

                    {/* action row */}
                    {i.dispatch_status === 'pending' && !isEditing && (
                      <div className="dispatch-actions">
                        <button className="mini ok" onClick={() => setReady(i, o.id)}>✓ Ready</button>
                        <button className="mini warn" onClick={() => setEditing({ itemId: i.id, mode: 'short', qty: i.quantity })}>≈ Short</button>
                        <button className="mini bad" onClick={() => setEditing({ itemId: i.id, mode: 'none' })}>✕ None</button>
                      </div>
                    )}

                    {/* inline SHORT editor */}
                    {isEditing && editing.mode === 'short' && (
                      <div className="inline-edit">
                        <span className="muted small">Made how many? (of {i.quantity})</span>
                        <div className="ministep">
                          <button onClick={() => setEditing(e => ({ ...e, qty: Math.max(0, e.qty - 1) }))}>−</button>
                          <input value={editing.qty} onChange={e => setEditing(s => ({ ...s, qty: Math.max(0, Number(e.target.value) || 0) }))} />
                          <button onClick={() => setEditing(e => ({ ...e, qty: e.qty + 1 }))}>+</button>
                        </div>
                        <button className="mini warn" onClick={() => confirmShort(i, o.id, editing.qty)}>Confirm</button>
                        <button className="mini" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    )}

                    {/* inline NONE editor */}
                    {isEditing && editing.mode === 'none' && (
                      <div className="inline-edit wrap">
                        <span className="muted small">Why not?</span>
                        {REASONS.map(r => (
                          <button key={r} className="mini bad" onClick={() => confirmNone(i, o.id, r)}>{r}</button>
                        ))}
                        <button className="mini" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    )}

                    {/* settled status chip */}
                    {i.dispatch_status !== 'pending' && !isEditing && (
                      <div className="dispatch-actions">
                        <span className="statuschip" onClick={() => resetItem(i)} title="tap to redo">
                          {i.dispatch_status === 'ready' && '✅ ready'}
                          {i.dispatch_status === 'short' && `≈ short (${i.fulfilled_qty}/${i.quantity})`}
                          {i.dispatch_status === 'unavailable' && `✕ none — ${i.unavail_reason || ''}`}
                          {i.dispatch_status === 'procuring' && '📋 with buyer'}
                          {i.dispatch_status === 'dispatched' && '📦 dispatched'}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="ticketfoot">
              <button className="primary" disabled={!allHandled} onClick={() => completeOrder(o.id)}>
                {allHandled ? 'Mark order complete' : `Handle all items (${handled}/${o.items.length})`}
              </button>
              <button className="ghost danger" onClick={() => cancelOrder(o.id)}>Cancel order</button>
            </div>
          </div>
        )
      })}

      {showCancelled && (
        <div className="cancelled-zone">
          <h3>Cancelled orders</h3>
          {cancelled.length === 0 && <p className="muted">None.</p>}
          {cancelled.map(o => (
            <div key={o.id} className="ticket cancelled">
              <div className="tickethead">
                <div>
                  <b>{o.location?.name_en}</b>
                  <span className={`tag ${o.order_type}`}>{o.order_type}</span>
                  <span className="tag st-cancelled">cancelled</span>
                </div>
                <span className="muted small">{new Date(o.created_at).toLocaleString()}</span>
              </div>
              <div className="hitems">
                {o.items.map(i => (
                  <span key={i.id} className="hitem">{i.quantity}{i.unit_snapshot ? ` ${i.unit_snapshot}` : ''} {i.item_name_snapshot}</span>
                ))}
              </div>
              <button className="ghost full" onClick={() => restoreOrder(o.id)}>↩ Restore order</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
