import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchList, insertRow } from '../lib/db'
import { useAuth } from '../lib/AuthProvider'
import { useRealtimeReload } from '../lib/useRealtimeReload'
import { transitionProcurementTask, transitionItem } from '../lib/orderLifecycle'

const SELECT = `id,item_name,quantity,unit,status,note,unavail_reason,
  target_location_id,target:locations(name_en),catalog_item_id,source_order_item_id,created_at,bought_at`

export default function ProcurementPage() {
  const { user, role } = useAuth()
  const isDriver = role === 'driver'
  const canAdd = ['restaurant_orderer', 'kitchen_manager', 'admin'].includes(role)

  const [tasks, setTasks] = useState([])     // pending tasks only
  const [done, setDone] = useState([])       // bought/unavailable, lazy-loaded
  const [locations, setLocations] = useState([])
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDone, setShowDone] = useState(false)
  const [editingNone, setEditingNone] = useState(null)  // task id awaiting reason

  // add form
  const [form, setForm] = useState({ item_name: '', catalog_item_id: '', quantity: 1, unit: '', target_location_id: '' })
  const [pick, setPick] = useState('')

  async function load() {
    setLoading(true)
    const [t, l, c] = await Promise.all([
      fetchList('procurement_tasks', { select: SELECT, build: q => q.eq('status', 'pending').order('created_at', { ascending: false }) }),
      fetchList('locations', { select: 'id,name_en,is_central', build: q => q.eq('is_active', true).order('name_en') }),
      fetchList('catalog_items', { select: 'id,name_en,name_hu,order_unit', build: q => q.eq('is_active', true).order('name_en') })
    ])
    setTasks(t); setLocations(l); setCatalog(c)
    setLoading(false)
  }
  async function loadDone() {
    const d = await fetchList('procurement_tasks', {
      select: SELECT,
      build: q => q.neq('status', 'pending').order('created_at', { ascending: false }).limit(50)
    })
    setDone(d)
  }
  useEffect(() => { load() }, [])
  useRealtimeReload(['procurement_tasks'], () => { load(); if (showDone) loadDone() }, editingNone !== null)

  function patch(id, fields) { setTasks(ts => ts.map(t => t.id === id ? { ...t, ...fields } : t)) }

  async function markBought(t) {
    const { error } = await transitionProcurementTask(t, 'bought', { bought_by: user.id })
    if (error) { alert(error.message); return }
    // if this task came from an order line, send that line back to the dispatch desk as "ready".
    // The order_item itself isn't loaded here — every task with a
    // source_order_item_id was put there by sendToProcurement/sendAllToBuyer,
    // which only ever move an item to 'procuring', so that's the assumed from-state.
    if (t.source_order_item_id) {
      await transitionItem({ id: t.source_order_item_id, dispatch_status: 'procuring' }, 'ready', { fulfilled_qty: t.quantity, handled_by: user.id })
    }
    setTasks(ts => ts.filter(x => x.id !== t.id))
    if (showDone) loadDone()
  }
  async function markUnavailable(t, reason) {
    const { error } = await transitionProcurementTask(t, 'unavailable', { unavail_reason: reason, bought_by: user.id })
    if (error) { alert(error.message); return }
    setTasks(ts => ts.filter(x => x.id !== t.id)); setEditingNone(null)
    if (showDone) loadDone()
  }
  async function reopen(t) {
    const { error } = await transitionProcurementTask(t, 'pending', { unavail_reason: null })
    if (error) { alert(error.message); return }
    setDone(ds => ds.filter(x => x.id !== t.id))
    load()
  }
  async function removeTask(t) {
    if (!confirm(`Remove "${t.item_name}" from the buy list?`)) return
    await supabase.from('procurement_tasks').delete().eq('id', t.id)
    setTasks(ts => ts.filter(x => x.id !== t.id))
  }

  function onPickCatalog(id) {
    setPick(id)
    const c = catalog.find(x => x.id === id)
    if (c) setForm(f => ({ ...f, catalog_item_id: id, item_name: c.name_en, unit: c.order_unit || '' }))
    else setForm(f => ({ ...f, catalog_item_id: '' }))
  }
  async function addTask() {
    if (!form.item_name.trim()) return
    const row = {
      item_name: form.item_name.trim(),
      catalog_item_id: form.catalog_item_id || null,
      quantity: Number(form.quantity) || 1,
      unit: form.unit || null,
      target_location_id: form.target_location_id || null,
      created_by: user.id
    }
    const { data, error } = await insertRow('procurement_tasks', row, { select: SELECT })
    if (error) { alert(error.message); return }
    setTasks(ts => [data, ...ts])
    setForm({ item_name: '', catalog_item_id: '', quantity: 1, unit: '', target_location_id: '' }); setPick('')
  }

  const pending = tasks

  // group pending by target location
  const grouped = useMemo(() => {
    const m = new Map()
    for (const t of pending) {
      const k = t.target?.name_en || 'Unassigned'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(t)
    }
    return m
  }, [pending])

  if (loading) return <div className="center muted">Loading…</div>

  return (
    <div className="procurement">
      {canAdd && (
        <div className="addtask">
          <h3>Add to buy list</h3>
          <div className="addtask-row">
            <select value={pick} onChange={e => onPickCatalog(e.target.value)}>
              <option value="">— pick from catalog —</option>
              {catalog.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
            </select>
            <span className="muted small">or type:</span>
            <input placeholder="Item name" value={form.item_name}
              onChange={e => setForm(f => ({ ...f, item_name: e.target.value, catalog_item_id: '' }))} />
            <input className="qty" placeholder="qty" value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            <input className="unit" placeholder="unit" value={form.unit}
              onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
            <select value={form.target_location_id} onChange={e => setForm(f => ({ ...f, target_location_id: e.target.value }))}>
              <option value="">Deliver to…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name_en}{l.is_central ? ' (kitchen)' : ''}</option>)}
            </select>
            <button className="primary" onClick={addTask}>Add</button>
          </div>
        </div>
      )}

      <div className="toolbar">
        <span className="muted">{pending.length} to buy</span>
        <label className="inline"><input type="checkbox" checked={showDone} onChange={e => { const v = e.target.checked; setShowDone(v); if (v) loadDone() }} /> show done</label>
      </div>

      {grouped.size === 0 && <div className="center muted">Nothing to buy right now.</div>}
      {[...grouped.entries()].map(([loc, list]) => (
        <div className="buycard" key={loc}>
          <div className="dcoltitle">📍 {loc} <span className="muted">({list.length})</span></div>
          {list.map(t => (
            <div key={t.id} className="buyrow">
              <div className="dinfo">
                <span className="dname">{t.item_name}</span>
                <span className="dqty muted">{t.quantity}{t.unit ? ` ${t.unit}` : ''}{t.note ? ` · ${t.note}` : ''}</span>
              </div>
              <div className="dactions">
                {isDriver || ['kitchen_manager', 'admin'].includes(role) ? (
                  editingNone === t.id ? (
                    <div className="inline-edit wrap">
                      {['Out of stock', 'Too expensive', 'Not found'].map(r =>
                        <button key={r} className="mini bad" onClick={() => markUnavailable(t, r)}>{r}</button>)}
                      <button className="mini" onClick={() => setEditingNone(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <button className="mini ok" onClick={() => markBought(t)}>✓ Bought</button>
                      <button className="mini bad" onClick={() => setEditingNone(t.id)}>✕ Can't</button>
                    </>
                  )
                ) : <span className="statuschip wait">⏳ waiting</span>}
                {(role === 'admin' || canAdd) &&
                  <button className="iconbtn" title="Remove" onClick={() => removeTask(t)}>🗑</button>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {showDone && (
        <div className="buycard donezone">
          <div className="dcoltitle">Done / unavailable <span className="muted">({done.length})</span></div>
          {done.length === 0 && <p className="muted small pad">—</p>}
          {done.map(t => (
            <div key={t.id} className={`buyrow ${t.status === 'unavailable' ? 'ds-unavailable' : 'ds-ready'}`}>
              <div className="dinfo">
                <span className="dname">{t.item_name}</span>
                <span className="dqty muted">
                  {t.quantity}{t.unit ? ` ${t.unit}` : ''} → {t.target?.name_en || '—'}
                  {t.status === 'unavailable' && ` · ✕ ${t.unavail_reason || ''}`}
                </span>
              </div>
              <div className="dactions">
                <span className={`statuschip ${t.status === 'unavailable' ? 'bad' : ''}`}>
                  {t.status === 'bought' ? '✓ bought' : 'needs arranging'}
                </span>
                <button className="iconbtn" title="Reopen" onClick={() => reopen(t)}>↩</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
