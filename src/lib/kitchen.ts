import type { Fulfillment, OrderWithLines } from './types'

export type Bucket = 0 | 1 | 2 | 3 // urgent, event, this week, next week

export function bucketOf(o: Pick<OrderWithLines, 'order_type' | 'parent_order_id' | 'production_week'>, monday: string): Bucket {
  if (o.order_type === 'urgent' || o.parent_order_id) return 0
  if (o.order_type === 'event') return 1
  const pw = o.production_week
  if (!pw || pw <= monday) return 2
  return 3
}

export interface StoreGroup {
  key: string
  bucket: Bucket
  location: string
  orders: OrderWithLines[]
  /** item name -> total qty across the group's orders */
  tally: Map<string, { qty: number; unit: string }>
}

/** Sort orders into production buckets, then by store, then oldest first. */
export function groupOrders(orders: OrderWithLines[], monday: string): StoreGroup[] {
  const sorted = orders.slice().sort((a, b) =>
    bucketOf(a, monday) - bucketOf(b, monday) ||
    (a.location?.name_en || '').localeCompare(b.location?.name_en || '') ||
    a.created_at.localeCompare(b.created_at))
  const groups: StoreGroup[] = []
  const byKey = new Map<string, StoreGroup>()
  for (const o of sorted) {
    const bucket = bucketOf(o, monday)
    const location = o.location?.name_en || '—'
    const key = `${bucket}|${location}`
    let g = byKey.get(key)
    if (!g) {
      g = { key, bucket, location, orders: [], tally: new Map() }
      byKey.set(key, g)
      groups.push(g)
    }
    g.orders.push(o)
    for (const it of o.items) {
      const t = g.tally.get(it.item_name_snapshot) || { qty: 0, unit: it.unit_snapshot || '' }
      t.qty += Number(it.quantity) || 0
      g.tally.set(it.item_name_snapshot, t)
    }
  }
  return groups
}

export interface ItemAggregate {
  key: string
  catalogItemId: string
  name: string
  unit: string
  type: Fulfillment | null
  total: number
  lines: { id: string; orderId: string; location: string; qty: number; status: OrderWithLines['items'][number]['dispatch_status']; fulfilled: number | null }[]
}

/** Per-product totals across all stores for the "By item" production view. */
export function aggregateByItem(orders: OrderWithLines[]) {
  const groups = new Map<string, ItemAggregate>()
  const adhoc: (OrderWithLines['items'][number] & { location: string })[] = []
  for (const o of orders) {
    const location = o.location?.name_en || '—'
    for (const it of o.items) {
      if (!it.catalog_item_id) { adhoc.push({ ...it, location }); continue }
      const key = it.catalog_item_id + '|' + (it.unit_snapshot || '')
      let g = groups.get(key)
      if (!g) {
        g = { key, catalogItemId: it.catalog_item_id, name: it.item_name_snapshot, unit: it.unit_snapshot || '', type: it.fulfillment_type, total: 0, lines: [] }
        groups.set(key, g)
      }
      const q = Number(it.quantity) || 0
      g.total += q
      g.lines.push({ id: it.id, orderId: o.id, location, qty: q, status: it.dispatch_status, fulfilled: it.fulfilled_qty })
      if (!g.type && it.fulfillment_type) g.type = it.fulfillment_type
    }
  }
  const all = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
  return {
    make: all.filter(g => g.type === 'make'),
    buy: all.filter(g => g.type === 'purchase'),
    unsorted: all.filter(g => !g.type),
    adhoc,
  }
}
