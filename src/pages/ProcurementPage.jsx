import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchList, insertRow } from '../lib/db'
import { useAuth } from '../lib/AuthProvider'
import { useRealtimeReload } from '../lib/useRealtimeReload'
// All task status changes go through ordering.set_procurement_task_status /
// ordering.delete_procurement_task (supabase/migrations/006_order_rpcs.sql):
// the task update, the order-line cascade (bought -> ready, unavailable ->
// unavailable, reopen -> procuring) and the parent procurement-order
// recompute happen in ONE database transaction. A crash mid-way can no
// longer leave a line stuck in 'procuring' or an order wrongly completed.

const SELECT = `id,item_name,quantity,unit,status,note,unavail_reason,
  target_location_id,target:locations(name_en),catalog_item_id,source_order_item_id,created_by,created_at,bought_at`

const CANT_REASONS = ['Out of stock', 'Too expensive', 'Not found']

export default function ProcurementPage() {
  const { user, role, locationId } = useAuth()
  const isBuyer = ['driver', 'kitchen_manager', 'admin'].includes(role)   // can mark bought
  const isStore = ['restaurant_orderer', 'store_manager'].includes(role)  // requests for own store
  const canAdd = isStore || ['kitchen_manager', 'admin'].includes(role)

  const [tasks, setTasks] = useState([])     // pending tasks only
  const [done, setDone] = useState([])       // bought/unavailable, lazy-loaded
  const [locations, setLocations] = useState([])
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDone, setShowDone] = useState(false)
  const [editingNone, setEditingNone] = useState(null)  // task id awaiting reason
  const [busy, setBusy] = useState(false)

  // add form — stores always request for their own store
  const emptyForm = { item_name: '', catalog_item_id: '', quantity: 1, unit: '', note: '', target_location_id: isStore ? (locationId || '') : '' }
  const [form, setForm] = useState(emptyForm)
  const [pick, setPick] = useState('')

  // stores only see their own store's list; buyers see everything
  const scoped = q => (isStore && locationId) ? q.eq('target_location_id', locationId) : q

  async function load() {
    setLoading(true)
    const [t, l, c] = await Promise.all([
      fetchList('procurement_tasks', { select: SELECT, build: q => scoped(q.eq('status', 'pending')).order('created_at', { ascending: false }) }),
      fetchList('locations', { select: 'id,name_en,is_central', build: q => q.eq('is_active', true).order('name_en') }),
      fetchList('catalog_items', { select: 'id,name_en,name_hu,order_unit', build: q => q.eq('is_active', true).order('name_en') })
    ])
    setTasks(t); setLocations(l); setCatalog(c)
    setLoading(false)
  }
  async function loadDone() {
    const d = await fetchList('procurement_tasks', {
      select: SELECT,
      build: q => scoped(q.neq('status', 'pending')).order('created_at', { ascending: false }).limit(50)
    })
    setDone(d)
  }
  useEffect(() => { load(); loadDone() }, [])
  useRealtimeReload(['procurement_tasks'], () => { load(); loadDone() }, editingNone !== null)

  async function setTaskStatus(t, to, reason = null) {
    const { error } = await supabase.rpc('set_procurement_task_status', {
      p_task: t.id, p_to: to, p_reason: reason
    })
    if (error) { alert(error.message); load(); loadDone(); return false }
    return true
  }
  async function markBought(t) {
    if (!await setTaskStatus(t, 'bought')) return
    setTasks(ts => ts.filter(x => x.id !== t.id))
    loadDone()
  }
  async function markAllBought(list) {
    if (!confirm(`Mark all ${list.length} item(s) as bought?`)) return
    setBusy(true)
    try {
      for (const t of list) {
        if (!await setTaskStatus(t, 'bought')) break
      }
    } finally {
      setBusy(false)
      load(); loadDone()
    }
  }
  async function markUnavailable(t, reason) {
    if (!await setTaskStatus(t, 'unavailable', reason)) return
    setTasks(ts => ts.filter(x => x.id !== t.id)); setEditingNone(null)
    loadDone()
  }
  async function reopen(t) {
    if (!await setTaskStatus(t, 'pending')) return
    setDone(ds => ds.filter(x => x.id !== t.id))
    load()
  }
  async function removeTask(t) {
    if (!confirm(`Remove "${t.item_name}" from the buy list?`)) return
    const { error } = await supabase.rpc('delete_procurement_task', { p_task: t.id })
    if (error) { alert(error.message); load(); return }
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
    const target = isStore ? (locationId || null) : (form.target_location_id || null)
    const row = {
      item_name: form.item_name.trim(),
      catalog_item_id: form.catalog_item_id || null,
      quantity: Number(form.quantity) || 1,
      unit: form.unit || null,
      note: form.note.trim() || null,
      target_location_id: target,
      created_by: user.id
    }
    const { data, error } = await insertRow('procurement_tasks', row, { select: SELECT })
    if (error) { alert(error.message); return }
    setTasks(ts => [data, ...ts])
    setForm(emptyForm); setPick('')
  }

  // group pending by target location
  const grouped = useMemo(() => {
    const m = new Map()
    for (const t of tasks) {
      const k = t.target?.name_en || 'Unassigned'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(t)
    }
    return m
  }, [tasks])

  // done/unavailable counts per store, so the driver sees progress ("3 of 7")
  const doneByLoc = useMemo(() => {
    const m = new Map()
    for (const t of done) {
      const k = t.target?.name_en || 'Unassigned'
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }, [done])

  if (loading) return <div className="center muted">Loading…</div>

  return (
    <div className="procurement">
      {canAdd && (
        <div className="addtask">
          <h3>Add to buy list {isStore && <span className="muted small">— delivered to your store</span>}</h3>
          <div className="addtask-row">
            <select value={pick} onChange={e => onPickCatalog(e.target.value)}>
              <option value="">— pick from catalog —</option>
              {catalog.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
            </select>
            <span className="muted small">or anything else:</span>
            <input placeholder="Type any item (doesn't have to be in the catalog)" value={form.item_name}
              onChange={e => setForm(f => ({ ...f, item_name: e.target.value, catalog_item_id: '' }))} />
            <input className="qty" placeholder="qty" value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            <input className="unit" placeholder="unit" value={form.unit}
              onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
          </div>
          <div className="addtask-row">
            <input placeholder="Note for the driver — brand, size, where to find it… (optional)" value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            {!isStore && (
              <select value={form.target_location_id} onChange={e => setForm(f => ({ ...f, target_location_id: e.target.value }))}>
                <option value="">Deliver to…</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name_en}{l.is_central ? ' (kitchen)' : ''}</option>)}
              </select>
            )}
            <button className="primary" onClick={addTask} disabled={!form.item_name.trim()}>Add</button>
          </div>
        </div>
      )}

      <div className="toolbar">
        <span className="muted">{tasks.length} to buy{isStore ? ' for your store' : ''}</span>
        <label className="inline"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> show done</label>
      </div>

      {grouped.size === 0 && (
        <div className="center muted">
          {isStore ? 'Nothing pending for your store. Add anything you need above — the driver will buy and deliver it.' : 'Nothing to buy right now. 🎉'}
        </div>
      )}
      {[...grouped.entries()].map(([loc, list]) => (
        <div className="buycard" key={loc}>
          <div className="dcoltitle buyhead">
            <span>📍 {loc} <span className="tag st-in_progress">{list.length} left</span>
              {doneByLoc.get(loc) > 0 && <span className="muted small"> · {doneByLoc.get(loc)} done</span>}</span>
            {isBuyer && list.length > 1 &&
              <button className="mini ok" disabled={busy} onClick={() => markAllBought(list)}>✓ All bought ({list.length})</button>}
          </div>
          {list.map(t => (
            <div key={t.id} className="buyrow">
              <div className="dinfo">
                <span className="dname">{t.item_name}</span>
                <span className="dqty muted">
                  {t.quantity}{t.unit ? ` ${t.unit}` : ''}
                  {t.note ? ` · 📝 ${t.note}` : ''}
                </span>
              </div>
              <div className="dactions">
                {isBuyer ? (
                  editingNone === t.id ? (
                    <div className="inline-edit wrap">
                      {CANT_REASONS.map(r =>
                        <button key={r} className="mini bad" onClick={() => markUnavailable(t, r)}>{r}</button>)}
                      <button className="mini" onClick={() => setEditingNone(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <button className="mini ok" disabled={busy} onClick={() => markBought(t)}>✓ Bought</button>
                      <button className="mini bad" disabled={busy} onClick={() => setEditingNone(t.id)}>✕ Can't</button>
                    </>
                  )
                ) : <span className="statuschip wait">⏳ waiting for driver</span>}
                {(role === 'admin' || t.created_by === user.id) &&
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
                {(isBuyer || t.created_by === user.id) &&
                  <button className="iconbtn" title="Reopen" onClick={() => reopen(t)}>↩</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
