import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchList, patchRow, insertRow } from '../lib/db'
import { useRealtimeReload } from '../lib/useRealtimeReload'
import { thisMonday } from '../lib/cutoff'
import { BUCKET_LABELS, bucketOf, groupKey, buildOrderGroups, aggregateByItem, inThisWeek } from '../lib/kitchen'
import { SkeletonCards } from '../components/Skeleton'
import {
  transitionOrder, transitionOrdersBulk, transitionItem, transitionItemsBulk, transitionItemsUpsert,
  canTransitionItem, isItemPending, isItemHandled, isOrderCompleted
} from '../lib/orderLifecycle'

const SELECT = `id, order_type, status, created_at, parent_order_id, production_week, event_name, event_date,
  location:locations(name_en),
  items:order_items(id, catalog_item_id, item_name_snapshot, unit_snapshot, quantity, fulfillment_type,
                    dispatch_status, fulfilled_qty, unavail_reason)`

const REASONS = ['Out of stock', "Can't make in time", 'Temporarily unavailable']

export default function KitchenPage() {
  const [orders, setOrders] = useState([])          // active (submitted / in_progress) orders
  const [completed, setCompleted] = useState([])     // lazy-loaded on demand
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // { itemId, mode: 'short'|'none'|'qty', qty }
  const [showCancelled, setShowCancelled] = useState(false)
  const [cancelled, setCancelled] = useState([])
  const [view, setView] = useState('orders')      // orders | items
  const [range, setRange] = useState('open')       // open | week
  const [showCompleted, setShowCompleted] = useState(false)
  const [locations, setLocations] = useState([])
  const [procureFor, setProcureFor] = useState(null)  // { item, order } awaiting target store
  const [stock, setStock] = useState({})              // catalog_item_id -> qty
  const [centralId, setCentralId] = useState(null)
  const [expanded, setExpanded] = useState({})   // groupKey -> bool (override default fold)

  async function load() {
    setLoading(true)
    const data = await fetchList('orders', {
      select: SELECT,
      build: q => q.in('status', ['submitted', 'in_progress']).order('created_at', { ascending: true })
    })
    setOrders(data); setLoading(false)
  }
  async function loadCompleted() {
    const data = await fetchList('orders', {
      select: SELECT,
      build: q => q.eq('status', 'completed').order('completed_at', { ascending: false }).limit(50)
    })
    setCompleted(data)
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    fetchList('locations', { select: 'id,name_en,is_central', build: q => q.eq('is_active', true).order('name_en') })
      .then(setLocations)
  }, [])
  async function loadStock() {
    const { data: central } = await supabase.from('locations').select('id').eq('is_central', true).eq('is_active', true).limit(1).maybeSingle()
    if (!central) { setStock({}); return }
    setCentralId(central.id)
    const data = await fetchList('location_stock', {
      select: 'catalog_item_id, qty, item:catalog_items(stock_unit)',
      build: q => q.eq('location_id', central.id).gt('qty', 0)
    })
    const m = {}; for (const r of data) m[r.catalog_item_id] = { qty: Number(r.qty), unit: r.item?.stock_unit || '' }
    setStock(m)
  }
  useEffect(() => { loadStock() }, [])
  // auto-refresh on changes; pause while an inline editor is open
  useRealtimeReload(['orders', 'order_items'], () => { load(); if (showCompleted) loadCompleted() }, editing !== null || procureFor !== null)

  function patchItemLocal(itemId, fields) {
    setOrders(os => os.map(o => ({ ...o, items: o.items.map(i => i.id === itemId ? { ...i, ...fields } : i) })))
  }
  async function ensureStarted(orderId) {
    const o = orders.find(x => x.id === orderId)
    if (o && o.status === 'submitted') {
      await transitionOrder(o, 'in_progress')
      setOrders(os => os.map(x => x.id === orderId ? { ...x, status: 'in_progress' } : x))
    }
  }
  async function setFulfillment(item, type) {
    await patchRow('order_items', item.id, { fulfillment_type: type })
    patchItemLocal(item.id, { fulfillment_type: type })
  }
  async function fulfillFromStock(item, orderId) {
    setEditing(null)
    await ensureStarted(orderId)
    await transitionItem(item, 'ready', { fulfilled_qty: item.quantity, unavail_reason: null })
    patchItemLocal(item.id, { dispatch_status: 'ready', fulfilled_qty: item.quantity, unavail_reason: null })
    // fulfilled from existing stock: no production added; stock will be reduced on dispatch.
    // reflect the reservation locally so the prompt updates
    setStock(s => ({ ...s, [item.catalog_item_id]: { ...s[item.catalog_item_id], qty: Math.max(0, (s[item.catalog_item_id]?.qty || 0) - Number(item.quantity)) } }))
  }
  async function bumpStock(item, qty, reason) {
    if (!item.catalog_item_id || item.fulfillment_type !== 'make' || !qty || !centralId) return
    await supabase.rpc('add_batch', { p_loc: centralId, p_item: item.catalog_item_id, p_qty: qty, p_produced: new Date().toISOString().slice(0, 10), p_expires: null, p_note: null })
  }
  async function setReady(item, orderId) {
    setEditing(null)
    await ensureStarted(orderId)
    await transitionItem(item, 'ready', { fulfilled_qty: item.quantity, unavail_reason: null })
    patchItemLocal(item.id, { dispatch_status: 'ready', fulfilled_qty: item.quantity, unavail_reason: null })
    bumpStock(item, Number(item.quantity), 'produced')
  }
  async function confirmShort(item, orderId, qty) {
    await ensureStarted(orderId)
    await transitionItem(item, 'short', { fulfilled_qty: qty, unavail_reason: null })
    patchItemLocal(item.id, { dispatch_status: 'short', fulfilled_qty: qty, unavail_reason: null })
    bumpStock(item, Number(qty), 'produced')
    setEditing(null)
  }
  async function confirmNone(item, orderId, reason) {
    await ensureStarted(orderId)
    await transitionItem(item, 'unavailable', { fulfilled_qty: 0, unavail_reason: reason })
    patchItemLocal(item.id, { dispatch_status: 'unavailable', fulfilled_qty: 0, unavail_reason: reason })
    setEditing(null)
  }
  async function resetItem(item) {
    setEditing(null)
    await transitionItem(item, 'pending', { fulfilled_qty: null, unavail_reason: null })
    patchItemLocal(item.id, { dispatch_status: 'pending', fulfilled_qty: null, unavail_reason: null })
  }
  async function completeOrder(orderId) {
    const o = orders.find(x => x.id === orderId)
    const { error } = await transitionOrder(o, 'completed', { completed_at: new Date().toISOString() })
    if (error) { alert(error.message); return }
    setOrders(os => os.filter(o => o.id !== orderId))
    if (showCompleted) loadCompleted()
  }
  async function reopenOrder(orderId) {
    const o = completed.find(x => x.id === orderId)
    const { error } = await transitionOrder(o, 'in_progress', { completed_at: null })
    if (error) { alert(error.message); return }
    setCompleted(cs => cs.filter(o => o.id !== orderId))
    load()
  }

  async function finishWeek() {
    const open = orders
    const blocked = open.filter(o => o.items.some(i => isItemPending(i.dispatch_status)))
    if (blocked.length) {
      const names = [...new Set(blocked.map(o => o.location?.name_en))].join(', ')
      alert(`Can't finish: ${blocked.length} order(s) still have unhandled items (${names}). Handle every item first.`)
      return
    }
    if (!open.length) { alert('Nothing to finish — no open orders.'); return }
    if (!confirm(`Finish kitchen for the week? This marks ${open.length} handled order(s) as complete. (Dispatch still sends them out; weekly archive stays on the Dispatch page.)`)) return
    const now = new Date().toISOString()
    const { error } = await transitionOrdersBulk(open, 'completed', { completed_at: now })
    if (error) { alert(error.message); return }
    setOrders([])
    if (showCompleted) loadCompleted()
  }

  async function sendToProcurement(item, order, targetLocId) {
    const { error } = await insertRow('procurement_tasks', {
      item_name: item.item_name_snapshot,
      catalog_item_id: item.catalog_item_id || null,
      quantity: item.quantity,
      unit: item.unit_snapshot || null,
      target_location_id: targetLocId || null,
      source_order_item_id: item.id,
      note: `from ${order.location?.name_en || 'order'}`,
      created_by: (await supabase.auth.getUser()).data.user?.id
    })
    if (error) { alert(error.message); return }
    await transitionItem(item, 'procuring')
    patchItemLocal(item.id, { dispatch_status: 'procuring' })
    setProcureFor(null)
  }

  async function saveQty(item, qty) {
    await patchRow('order_items', item.id, { quantity: qty })
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
    const o = orders.find(x => x.id === orderId)
    await transitionOrder(o, 'cancelled')
    setOrders(os => os.filter(o => o.id !== orderId))
  }
  async function loadCancelled() {
    const data = await fetchList('orders', {
      select: SELECT,
      build: q => q.eq('status', 'cancelled').order('created_at', { ascending: false }).limit(30)
    })
    setCancelled(data)
  }
  async function restoreOrder(orderId) {
    const o = cancelled.find(x => x.id === orderId)
    await transitionOrder(o, 'submitted')
    setCancelled(cs => cs.filter(o => o.id !== orderId))
    load()
  }
  function toggleCancelled() {
    const next = !showCancelled
    setShowCancelled(next)
    if (next) loadCancelled()
  }

  const visibleOrders = showCompleted ? completed : orders

  const { list: groupedList, meta: groupMeta } = useMemo(
    () => buildOrderGroups(visibleOrders, thisMonday(), showCompleted),
    [visibleOrders, showCompleted]
  )

  if (loading) return <div className="tickets"><SkeletonCards count={5} /></div>

  return (
    <div className="tickets">
      <div className="toolbar kitchen-toolbar">
        <div className="seg">
          <button className={view === 'orders' ? 'on' : ''} onClick={() => setView('orders')}>By order</button>
          <button className={view === 'items' ? 'on' : ''} onClick={() => setView('items')}>By item</button>
        </div>
        {view === 'orders' ? (
          <div className="seg">
            <button className={!showCompleted ? 'on' : ''} onClick={() => setShowCompleted(false)}>Open</button>
            <button className={showCompleted ? 'on' : ''} onClick={() => { setShowCompleted(true); loadCompleted() }}>Completed</button>
          </div>
        ) : (
          <div className="seg">
            <button className={range === 'open' ? 'on' : ''} onClick={() => setRange('open')}>All open</button>
            <button className={range === 'week' ? 'on' : ''} onClick={() => setRange('week')}>This week</button>
          </div>
        )}
        <div className="tb-right">
          {view === 'orders' && !showCompleted &&
            <button className="primary" onClick={finishWeek}>🍳 Finish week</button>}
          <button className="ghost" onClick={toggleCancelled}>
            {showCancelled ? 'Hide cancelled' : 'View cancelled'}
          </button>
        </div>
      </div>

      {view === 'items' && <ByItem orders={orders} range={range} onChanged={load} />}

      {view === 'orders' && !showCompleted && orders.length === 0 && <div className="center muted">No open orders. 🎉</div>}
      {view === 'orders' && showCompleted && completed.length === 0 && <div className="center muted">No completed orders yet this week.</div>}
      {view === 'orders' && (() => {
        let lastB = null, lastK = null
        return groupedList.map(o => {
        const isDone = isOrderCompleted(o.status)
        const handled = o.items.filter(i => isItemHandled(i.dispatch_status)).length
        const allHandled = o.items.length > 0 && handled === o.items.length
        const n = s => o.items.filter(i => i.dispatch_status === s).length
        const pend = n('pending'), rdy = n('ready'), sh = n('short'), un = n('unavailable'), dis = n('dispatched')
        const proc = n('procuring')
        const tm = thisMonday()
        const b = bucketOf(o, tm); const sep = b !== lastB ? (lastB = b, BUCKET_LABELS[b]) : null
        const k = groupKey(o, tm); const m = groupMeta[k]
        const newGroup = k !== lastK; if (newGroup) lastK = k
        const multi = m.count >= 2
        const isOpen = expanded[k] ?? !multi
        return (
          <div key={o.id}>
            {sep && <div className="prodsep">{sep}</div>}
            {newGroup && multi && (
              <div className={`storegroup ${isOpen ? 'open' : ''}`} onClick={() => setExpanded(e => ({ ...e, [k]: !isOpen }))}>
                <div className="sg-head">
                  <span className="sg-name">{isOpen ? '▾' : '▸'} {m.loc}</span>
                  <span className="sg-count">{m.count} orders</span>
                </div>
                {!isOpen && (
                  <div className="sg-summary">
                    {Object.entries(m.items).map(([nm, qty]) => <span key={nm} className="sg-chip">{nm} <b>×{qty}</b></span>)}
                  </div>
                )}
              </div>
            )}
            {isOpen && (
          <div className={`ticket${isDone ? ' ticket-done' : ''}${multi ? ' ticket-grouped' : ''}`}>
            <div className="tickethead">
              <div>
                <b>{o.location?.name_en}</b>
                <span className={`tag ${o.order_type}`}>{o.order_type}</span>
                {o.order_type === 'event' && (o.event_name || o.event_date) && (
                  <span className="tag event">🎉 {o.event_name || 'Event'}{o.event_date ? ` · ${o.event_date}` : ''}</span>
                )}
                {o.parent_order_id && <span className="tag amend">🔁 amendment</span>}
                {isDone && <span className="tag st-completed">✓ completed</span>}
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
                      <button className="linkbtn" onClick={() => setProcureFor({ itemId: i.id })}>📋 to buyer</button>
                    </div>
                    {procureFor?.itemId === i.id && (
                      <div className="inline-edit wrap">
                        <span className="muted small">Buy & deliver to:</span>
                        {locations.map(l => (
                          <button key={l.id} className="mini" onClick={() => sendToProcurement(i, o, l.id)}>
                            {l.name_en}{l.is_central ? ' (kitchen)' : ''}
                          </button>
                        ))}
                        <button className="mini" onClick={() => setProcureFor(null)}>Cancel</button>
                      </div>
                    )}

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

                    {/* stock-first hint */}
                    {isItemPending(i.dispatch_status) && !isEditing && i.fulfillment_type === 'make' && stock[i.catalog_item_id]?.qty > 0 && (
                      <div className="stockhint">
                        <span>📦 In stock: <b>{stock[i.catalog_item_id].qty}{stock[i.catalog_item_id].unit ? ` ${stock[i.catalog_item_id].unit}` : ''}</b>. {stock[i.catalog_item_id].qty >= i.quantity
                          ? `Covers all ${i.quantity} — send from stock, no need to make.`
                          : `Send ${stock[i.catalog_item_id].qty} from stock, make ${i.quantity - stock[i.catalog_item_id].qty} more.`}</span>
                        {stock[i.catalog_item_id].qty >= i.quantity &&
                          <button className="mini ok" onClick={() => fulfillFromStock(i, o.id)}>Use stock</button>}
                      </div>
                    )}

                    {/* action row */}
                    {isItemPending(i.dispatch_status) && !isEditing && (
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
                    {isItemHandled(i.dispatch_status) && !isEditing && (
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
              {isDone ? (
                <>
                  <span className="muted small">✓ Completed {o.completed_at ? new Date(o.completed_at).toLocaleString() : ''}</span>
                  <button className="ghost" onClick={() => reopenOrder(o.id)}>↩ Reopen</button>
                </>
              ) : (
                <>
                  <button className="primary" disabled={!allHandled} onClick={() => completeOrder(o.id)}>
                    {allHandled ? 'Mark order complete' : `Handle all items (${handled}/${o.items.length})`}
                  </button>
                  <button className="ghost danger" onClick={() => cancelOrder(o.id)}>Cancel order</button>
                </>
              )}
            </div>
          </div>
          )}
          </div>
        )
      })
      })()}

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

// ---------- By-item production aggregation ----------
function ByItem({ orders, range, onChanged }) {
  const scope = useMemo(
    () => range === 'week' ? orders.filter(o => inThisWeek(o.created_at)) : orders,
    [orders, range]
  )
  const { make, buy, unsorted, adhoc } = useMemo(() => aggregateByItem(scope), [scope])

  async function sendAllToBuyer() {
    if (!buy.length) return
    if (!confirm(`Send ${buy.length} purchase item(s) to the buyer's list?`)) return
    const uid = (await supabase.auth.getUser()).data.user?.id
    // groups are independent of each other, so fire them concurrently instead
    // of one-at-a-time
    await Promise.all(buy.map(async g => {
      await insertRow('procurement_tasks', {
        item_name: g.name, quantity: g.total, unit: g.unit || null,
        target_location_id: null, created_by: uid, note: 'from weekly production aggregate'
      })
      // a product name can span rows in different states across stores (one
      // store's line already dispatched, another's still pending) — only the
      // still-pending ones are legal to send to the buyer
      const pending = g.locItems.filter(li => isItemPending(li.status)).map(li => ({ id: li.id, dispatch_status: li.status }))
      await transitionItemsBulk(pending, 'procuring')
    }))
    onChanged()
  }

  // mark every store's line for this product as fully ready
  async function markGroupReady(g) {
    const movable = g.locItems.filter(li => canTransitionItem(li.status, 'ready'))
    await transitionItemsBulk(movable.map(li => ({ id: li.id, dispatch_status: li.status })), 'ready')
    // ready means fulfilled = ordered qty; set per row to be exact. Values
    // differ per row so this can't be one bulk .update(), but a single
    // upsert still does it in one round trip instead of N sequential ones.
    if (movable.length) {
      await supabase.from('order_items').upsert(movable.map(li => ({ id: li.id, fulfilled_qty: li.qty })))
    }
    onChanged()
  }
  // apply per-store actual quantities: full -> ready, less -> short
  async function applyPartial(g, made) {   // made: { itemId: qty }
    const rows = []
    for (const li of g.locItems) {
      const got = Number(made[li.id])
      if (isNaN(got)) continue
      const toDispatchStatus = got >= li.qty ? 'ready' : 'short'
      if (!canTransitionItem(li.status, toDispatchStatus)) continue
      rows.push({ id: li.id, fromDispatchStatus: li.status, toDispatchStatus, fields: { fulfilled_qty: got } })
    }
    await transitionItemsUpsert(rows)
    onChanged()
  }

  const Section = ({ title, rows, tag }) => (
    <div className="prodsec">
      <div className="prodsec-h">{title} <span className="muted">({rows.length})</span></div>
      {rows.length === 0 && <p className="muted small pad">—</p>}
      {rows.map((g, i) => (
        <div className="prodrow" key={i}>
          <div className="prodmain">
            <span className="prodname">{g.name}</span>
            <span className="prodtotal">{g.total}{g.unit ? ` ${g.unit}` : ''} {tag}</span>
          </div>
          <div className="prodbreak">
            {[...g.byLoc.entries()].map(([loc, q]) => <span key={loc} className="brk">{loc}: <b>{q}</b></span>)}
          </div>
        </div>
      ))}
    </div>
  )

  if (scope.length === 0) return <div className="center muted">No orders in this range.</div>

  return (
    <div className="byitem">
      <div className="byitem-bar no-print">
        <span className="muted small">Production summary — {scope.length} order(s){range === 'week' ? ', this week' : ''}</span>
        <div>
          <button className="ghost" onClick={() => window.print()}>🖨 Print</button>
          {buy.length > 0 && <button className="primary" onClick={sendAllToBuyer}>Send all 🛒 to buyer ({buy.length})</button>}
        </div>
      </div>
      <MakeSection rows={make} onReady={markGroupReady} onPartial={applyPartial} />
      <Section title="🛒 To buy" rows={buy} tag="🛒" />
      {unsorted.length > 0 && <Section title="❓ Not sorted yet (set 🍳/🛒 in By order)" rows={unsorted} tag="" />}
      {adhoc.length > 0 && (
        <div className="prodsec">
          <div className="prodsec-h">✎ Custom items (not merged) <span className="muted">({adhoc.length})</span></div>
          {adhoc.map((a, i) => (
            <div className="prodrow" key={i}>
              <div className="prodmain"><span className="prodname">{a.item_name_snapshot}</span>
                <span className="prodtotal">{a.quantity}{a.unit_snapshot ? ` ${a.unit_snapshot}` : ''}</span></div>
              <div className="prodbreak"><span className="brk">{a.loc}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MakeSection({ rows, onReady, onPartial }) {
  return (
    <div className="prodsec">
      <div className="prodsec-h">🍳 To make <span className="muted">({rows.length})</span></div>
      {rows.length === 0 && <p className="muted small pad">—</p>}
      {rows.map((g, i) => <MakeRow key={i} g={g} onReady={onReady} onPartial={onPartial} />)}
    </div>
  )
}

function MakeRow({ g, onReady, onPartial }) {
  const [open, setOpen] = useState(false)
  const [made, setMade] = useState(() => Object.fromEntries(g.locItems.map(li => [li.id, li.qty])))
  const allReady = g.locItems.every(li => li.status === 'ready')
  const anyDone = g.locItems.some(li => ['ready', 'short', 'dispatched', 'procuring'].includes(li.status))

  return (
    <div className={`prodrow ${allReady ? 'rowdone' : ''}`}>
      <div className="prodmain">
        <span className="prodname">{g.name}{allReady && ' ✅'}</span>
        <span className="prodtotal">{g.total}{g.unit ? ` ${g.unit}` : ''} 🍳</span>
      </div>
      <div className="prodbreak">
        {g.locItems.map(li => (
          <span key={li.id} className={`brk ${li.status === 'ready' ? 'bok' : li.status === 'short' ? 'bshort' : ''}`}>
            {li.loc}: <b>{li.qty}</b>{li.status === 'short' ? ` (made ${'' }${li.fulfilled_qty ?? ''})` : ''}
          </span>
        ))}
      </div>
      <div className="prod-actions no-print">
        <button className="mini ok" onClick={() => onReady(g)}>✓ All made</button>
        <button className="mini warn" onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Partial…'}</button>
      </div>
      {open && (
        <div className="partialbox">
          <span className="muted small">Made per store (default = ordered):</span>
          <div className="partialgrid">
            {g.locItems.map(li => (
              <label key={li.id} className="pcell">
                <span>{li.loc} <span className="muted">/{li.qty}</span></span>
                <input value={made[li.id]} onChange={e => setMade(m => ({ ...m, [li.id]: e.target.value }))} />
              </label>
            ))}
          </div>
          <button className="mini ok" onClick={() => { onPartial(g, made); setOpen(false) }}>Apply</button>
        </div>
      )}
    </div>
  )
}
