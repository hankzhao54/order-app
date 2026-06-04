import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useRealtimeReload } from '../../lib/useRealtimeReload'

function startOfWeek(d){const x=new Date(d);const day=(x.getDay()+6)%7;x.setHours(0,0,0,0);x.setDate(x.getDate()-day);return x}

export default function Dashboard() {
  const [data, setData] = useState(null)

  async function load() {
    const weekStart = startOfWeek(new Date()).toISOString()
    const [{ data: orders }, { data: locs }, { data: tasks }] = await Promise.all([
      supabase.from('orders')
        .select('id,location_id,status,created_at,completed_at,location:locations(name_en),items:order_items(id,item_name_snapshot,dispatch_status,quantity,unit_snapshot)')
        .in('status', ['submitted', 'in_progress', 'completed'])
        .order('created_at', { ascending: true }),
      supabase.from('locations').select('id,name_en,is_central').eq('is_active', true),
      supabase.from('procurement_tasks').select('id,status,item_name')
    ])
    setData({ orders: orders || [], locs: locs || [], tasks: tasks || [], weekStart })
  }
  useEffect(() => { load() }, [])
  useRealtimeReload(['orders', 'order_items', 'procurement_tasks'], load)

  if (!data) return <div className="center muted">Loading…</div>
  const { orders, locs, tasks } = data

  const allItems = orders.flatMap(o => o.items)
  const pending = allItems.filter(i => i.dispatch_status === 'pending' || i.dispatch_status === 'procuring').length
  const readyToDispatch = allItems.filter(i => ['ready', 'short'].includes(i.dispatch_status)).length
  const shortItems = allItems.filter(i => i.dispatch_status === 'unavailable')
  const toBuy = tasks.filter(t => t.status === 'pending').length

  // average completion time (created -> completed) for orders completed this week
  const completedWithTime = orders.filter(o => o.completed_at && o.created_at)
  let avgLabel = '—'
  if (completedWithTime.length) {
    const ms = completedWithTime.reduce((sum, o) => sum + (new Date(o.completed_at) - new Date(o.created_at)), 0) / completedWithTime.length
    const hours = ms / 36e5
    avgLabel = hours < 1 ? `${Math.round(hours * 60)} min` : hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`
  }

  // stores that haven't ordered this week (non-central)
  const orderedLocIds = new Set(orders.map(o => o.location_id))
  const notOrdered = locs.filter(l => !l.is_central && !orderedLocIds.has(l.id))

  // per store
  const perStore = locs.filter(l => !l.is_central).map(l => {
    const os = orders.filter(o => o.location_id === l.id)
    const items = os.flatMap(o => o.items)
    const done = items.filter(i => ['dispatched', 'unavailable', 'ready', 'short', 'procuring'].includes(i.dispatch_status)).length
    return { name: l.name_en, orders: os.length, total: items.length, done }
  })

  const Stat = ({ n, label, tone }) => (
    <div className={`statcard ${tone || ''}`}><div className="statn">{n}</div><div className="statl">{label}</div></div>
  )

  return (
    <div className="dashboard">
      <h2 className="dash-title">This week at a glance</h2>
      <div className="statgrid">
        <Stat n={orders.length} label="Open orders" />
        <Stat n={pending} label="Items to handle" tone={pending ? 'warn' : ''} />
        <Stat n={readyToDispatch} label="Ready to dispatch" tone={readyToDispatch ? 'ok' : ''} />
        <Stat n={toBuy} label="On buy list" tone={toBuy ? 'buy' : ''} />
        <Stat n={shortItems.length} label="Unavailable" tone={shortItems.length ? 'bad' : ''} />
        <Stat n={avgLabel} label="Avg completion time" />
      </div>

      {(notOrdered.length > 0 || shortItems.length > 0) && (
        <div className="attention">
          <div className="att-h">⚠️ Needs attention</div>
          {notOrdered.length > 0 && (
            <div className="att-block">
              <b>Stores not ordered yet ({notOrdered.length}):</b>{' '}
              {notOrdered.map(l => <span key={l.id} className="chip">{l.name_en}</span>)}
            </div>
          )}
          {shortItems.length > 0 && (
            <div className="att-block">
              <b>Unavailable items ({shortItems.length}):</b>{' '}
              {shortItems.slice(0, 12).map(i => <span key={i.id} className="chip bad">{i.item_name_snapshot}</span>)}
              {shortItems.length > 12 && <span className="muted small"> +{shortItems.length - 12} more</span>}
            </div>
          )}
        </div>
      )}

      <div className="dash-stores card">
        <div className="prodsec-h">By store</div>
        {perStore.length === 0 && <p className="muted small">No active stores.</p>}
        {perStore.map((s, i) => (
          <div className="storerow" key={i}>
            <span className="storename">{s.name}</span>
            <span className="muted small">{s.orders} order(s)</span>
            <div className="progbar"><div className="progfill" style={{ width: s.total ? `${Math.round(s.done / s.total * 100)}%` : '0%' }} /></div>
            <span className="muted small">{s.done}/{s.total}</span>
          </div>
        ))}
      </div>

      <div className="dash-links">
        <Link className="dlink" to="/kitchen">🍳 Kitchen</Link>
        <Link className="dlink" to="/dispatch">📦 Dispatch</Link>
        <Link className="dlink" to="/procurement">🛒 Procurement</Link>
        <Link className="dlink" to="/admin/catalog">📋 Catalog</Link>
        <Link className="dlink" to="/history">🗓 History</Link>
      </div>
    </div>
  )
}
