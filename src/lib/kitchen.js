// Pure helpers for the Kitchen page: production-bucket sorting/grouping and
// the by-item aggregation. Kept free of React/Supabase so they're testable
// and so the page can wrap them in useMemo.

export function startOfWeek(d) {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - day)
  return x
}

export function inThisWeek(iso) {
  const d = new Date(iso)
  const s = startOfWeek(new Date())
  const e = new Date(s); e.setDate(e.getDate() + 7)
  return d >= s && d < e
}

export const BUCKET_LABELS = { 0: '🔥 Urgent — handle now', 1: '🎉 Event orders', 2: "📅 This week's production", 3: '📅 Next week' }

export function bucketOf(o, thisMonday) {
  if (o.order_type === 'urgent' || o.parent_order_id) return 0
  if (o.order_type === 'event') return 1
  const pw = o.production_week
  if (!pw || pw <= thisMonday) return 2
  return 3
}

export function groupKey(o, thisMonday) {
  return bucketOf(o, thisMonday) + '|' + (o.location?.name_en || '—')
}

// Sort orders into production buckets/store-groups and compute the
// per-group summary (order count + item tallies) used for the collapsed view.
export function buildOrderGroups(orders, thisMonday, showCompleted) {
  const list = orders.filter(o => showCompleted ? o.status === 'completed' : o.status !== 'completed')
    .slice().sort((a, b) =>
      bucketOf(a, thisMonday) - bucketOf(b, thisMonday) ||
      (a.location?.name_en || '').localeCompare(b.location?.name_en || '') ||
      new Date(a.created_at) - new Date(b.created_at))
  const meta = {}
  for (const o of list) {
    const kk = groupKey(o, thisMonday)
    if (!meta[kk]) meta[kk] = { count: 0, items: {}, loc: o.location?.name_en || '—' }
    meta[kk].count++
    for (const it of o.items) meta[kk].items[it.item_name_snapshot] = (meta[kk].items[it.item_name_snapshot] || 0) + Number(it.quantity)
  }
  return { list, meta }
}

// Aggregate order items across stores into per-product totals for the
// "By item" production view (make / buy / unsorted / ad-hoc).
export function aggregateByItem(orders) {
  const groups = new Map()
  const adhoc = []
  for (const o of orders) {
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
  return {
    make: all.filter(g => g.type === 'make'),
    buy: all.filter(g => g.type === 'purchase'),
    unsorted: all.filter(g => !g.type),
    adhoc
  }
}
