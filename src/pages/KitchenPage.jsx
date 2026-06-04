import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRealtimeReload } from '../lib/useRealtimeReload'

const SELECT = `id, order_type, status, created_at, parent_order_id,
  location:locations(name_en),
  items:order_items(id, catalog_item_id, item_name_snapshot, unit_snapshot, quantity, fulfillment_type,
                    dispatch_status, fulfilled_qty, unavail_reason)`

const REASONS = ['Out of stock', "Can't make in time", 'Temporarily unavailable']

export default function KitchenPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // { itemId, mode: 'short'|'none'|'qty', qty }
  const [showCancelled, setShowCancelled] = useState(false)
  const [cancelled, setCancelled] = useState([])
  const [view, setView] = useState('orders')      // orders | items
  const [range, setRange] = useState('open')       // open | week
  const [showCompleted, setShowCompleted] = useState(false)
  const [locations, setLocations] = useState([])
  const [procureFor, setProcureFor] = useState(null)  // { item, order } awaiting target store

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('orders').select(SELECT)
      .in('status', ['submitted', 'in_progress', 'completed'])
      .order('created_at', { ascending: true })
    setOrders(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])
  useEffect(() => { supabase.from('locations').select('id,name_en,is_central').eq('is_active', true).order('name_en').then(({ data }) => setLocations(data || [])) }, [])
  // auto-refresh on changes; pause while an inline editor is open
  useRealtimeReload(['orders', 'order_items'], load, editing !== null || procureFor !== null)

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
    patchOrderLocal(orderId, { status: 'completed' })
  }
  function patchOrderLocal(orderId, fields) {
    setOrders(os => os.map(o => o.id === orderId ? { ...o, ...fields } : o))
  }
  async function reopenOrder(orderId) {
    await supabase.from('orders').update({ status: 'in_progress', completed_at: null }).eq('id', orderId)
    patchOrderLocal(orderId, { status: 'in_progress' })
  }

  async function finishWeek() {
    const open = orders.filter(o => o.status !== 'completed')
    const blocked = open.filter(o => o.items.some(i => i.dispatch_status === 'pending'))
    if (blocked.length) {
      const names = [...new Set(blocked.map(o => o.location?.name_en))].join(', ')
      alert(`Can't finish: ${blocked.length} order(s) still have unhandled items (${names}). Handle every item first.`)
      return
    }
    if (!open.length) { alert('Nothing to finish — no open orders.'); return }
    if (!confirm(`Finish kitchen for the week? This marks ${open.length} handled order(s) as complete. (Dispatch still sends them out; weekly archive stays on the Dispatch page.)`)) return
    const ids = open.map(o => o.id)
    const now = new Date().toISOString()
    await supabase.from('orders').update({ status: 'completed', completed_at: now }).in('id', ids)
    setOrders(os => os.map(o => ids.includes(o.id) ? { ...o, status: 'completed' } : o))
  }

  async function sendToProcurement(item, order, targetLocId) {
    const { error } = await supabase.from('procurement_tasks').insert({
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
    await supabase.from('order_items').update({ dispatch_status: 'procuring', status: 'done' }).eq('id', item.id)
    patchItemLocal(item.id, { dispatch_status: 'procuring' })
    setProcureFor(null)
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
      <div className="toolbar kitchen-toolbar">
        <div className="seg">
          <button className={view === 'orders' ? 'on' : ''} onClick={() => setView('orders')}>By order</button>
          <button className={view === 'items' ? 'on' : ''} onClick={() => setView('items')}>By item (production)</button>
        </div>
        {view === 'items' && (
          <div className="seg">
            <button className={range === 'open' ? 'on' : ''} onClick={() => setRange('open')}>All open</button>
            <button className={range === 'week' ? 'on' : ''} onClick={() => setRange('week')}>This week</button>
          </div>
        )}
        {view === 'orders' && (
          <div className="seg">
            <button className={!showCompleted ? 'on' : ''} onClick={() => setShowCompleted(false)}>Open</button>
            <button className={showCompleted ? 'on' : ''} onClick={() => setShowCompleted(true)}>Completed</button>
          </div>
        )}
        <span className="muted">{orders.filter(o => o.status !== 'completed').length} open order(s)</span>
        {view === 'orders' && !showCompleted &&
          <button className="primary" onClick={finishWeek}>🍳 Finish kitchen week</button>}
        <button className="ghost" onClick={toggleCancelled}>
          {showCancelled ? 'Hide cancelled' : 'View cancelled'}
        </button>
      </div>

      {view === 'items' && <ByItem orders={orders.filter(o => o.status !== 'completed')} range={range} onChanged={load} />}

      {view === 'orders' && !showCompleted && orders.filter(o => o.status !== 'completed').length === 0 && <div className="center muted">No open orders. 🎉</div>}
      {view === 'orders' && showCompleted && orders.filter(o => o.status === 'completed').length === 0 && <div className="center muted">No completed orders yet this week.</div>}
      {view === 'orders' && orders.filter(o => showCompleted ? o.status === 'completed' : o.status !== 'completed').map(o => {
        const isDone = o.status === 'completed'
        const handled = o.items.filter(i => i.dispatch_status !== 'pending').length
        const allHandled = o.items.length > 0 && handled === o.items.length
        const n = s => o.items.filter(i => i.dispatch_status === s).length
        const pend = n('pending'), rdy = n('ready'), sh = n('short'), un = n('unavailable'), dis = n('dispatched')
        const proc = n('procuring')
        return (
          <div key={o.id} className={`ticket${isDone ? ' ticket-done' : ''}`}>
            <div className="tickethead">
              <div>
                <b>{o.location?.name_en}</b>
                <span className={`tag ${o.order_type}`}>{o.order_type}</span>
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

// ---------- By-item production aggregation ----------
function startOfWeek(d){const x=new Date(d);const day=(x.getDay()+6)%7;x.setHours(0,0,0,0);x.setDate(x.getDate()-day);return x}
function inThisWeek(iso){const d=new Date(iso);const s=startOfWeek(new Date());const e=new Date(s);e.setDate(e.getDate()+7);return d>=s&&d<e}

function ByItem({ orders, range, onChanged }) {
  const scope = range === 'week' ? orders.filter(o => inThisWeek(o.created_at)) : orders

  // aggregate
  const groups = new Map()   // key -> {name, unit, type, total, byLoc:Map, itemIds:[], locItems:[]}
  const adhoc = []
  for (const o of scope) {
    const loc = o.location?.name_en || '—'
    for (const it of o.items) {
      if (!it.catalog_item_id) { adhoc.push({ ...it, loc }); continue }
      const key = it.catalog_item_id + '|' + (it.unit_snapshot || '')
      if (!groups.has(key)) groups.set(key, { name: it.item_name_snapshot, unit: it.unit_snapshot || '', type: it.fulfillment_type, total: 0, byLoc: new Map(), itemIds: [], locItems: [] })
      const g = groups.get(key)
      g.total += Number(it.quantity) || 0
      g.byLoc.set(loc, (g.byLoc.get(loc) || 0) + (Number(it.quantity) || 0))
      g.itemIds.push(it.id)
      g.locItems.push({ id: it.id, loc, qty: Number(it.quantity) || 0, status: it.dispatch_status })
      if (!g.type && it.fulfillment_type) g.type = it.fulfillment_type
    }
  }
  const all = [...groups.values()]
  const make = all.filter(g => g.type === 'make')
  const buy = all.filter(g => g.type === 'purchase')
  const unsorted = all.filter(g => !g.type)

  async function sendAllToBuyer() {
    if (!buy.length) return
    if (!confirm(`Send ${buy.length} purchase item(s) to the buyer's list?`)) return
    const uid = (await supabase.auth.getUser()).data.user?.id
    for (const g of buy) {
      await supabase.from('procurement_tasks').insert({
        item_name: g.name, quantity: g.total, unit: g.unit || null,
        target_location_id: null, created_by: uid, note: 'from weekly production aggregate'
      })
      await supabase.from('order_items').update({ dispatch_status: 'procuring', status: 'done' }).in('id', g.itemIds)
    }
    onChanged()
  }

  // mark every store's line for this product as fully ready
  async function markGroupReady(g) {
    await supabase.from('order_items').update({ dispatch_status: 'ready', status: 'done' }).in('id', g.itemIds)
    // ready means fulfilled = ordered qty; set per row to be exact
    for (const li of g.locItems)
      await supabase.from('order_items').update({ fulfilled_qty: li.qty }).eq('id', li.id)
    onChanged()
  }
  // apply per-store actual quantities: full -> ready, less -> short
  async function applyPartial(g, made) {   // made: { itemId: qty }
    for (const li of g.locItems) {
      const got = Number(made[li.id])
      if (isNaN(got)) continue
      if (got >= li.qty) await supabase.from('order_items').update({ dispatch_status: 'ready', status: 'done', fulfilled_qty: li.qty }).eq('id', li.id)
      else await supabase.from('order_items').update({ dispatch_status: 'short', status: 'done', fulfilled_qty: got }).eq('id', li.id)
    }
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
