import { describe, expect, it } from 'vitest'
import { can, homeFor, navFor } from './permissions'
import { countLines, orderProgress, storeCanCancel, canTopUp } from './status'
import { aggregateByItem, bucketOf, groupOrders } from './kitchen'
import { contentTotal, expiryInfo, isLow, worstExpiry } from './inventory'
import { toCSV } from './csv'
import { displayUsername, toLoginEmail } from './username'
import { en } from './i18n/en'
import { hu } from './i18n/hu'
import { zh } from './i18n/zh'
import type { OrderWithLines, DispatchStatus } from './types'

const line = (id: string, status: DispatchStatus, extra: Partial<OrderWithLines['items'][number]> = {}) => ({
  id, order_id: 'o', catalog_item_id: 'c-' + id, item_name_snapshot: 'Item ' + id, unit_snapshot: 'kg', quantity: 2,
  fulfillment_type: 'make' as const, dispatch_status: status, fulfilled_qty: null, unavail_reason: null, dispatched_at: null, ...extra,
})
const order = (id: string, loc: string, items: OrderWithLines['items'], extra: Partial<OrderWithLines> = {}): OrderWithLines => ({
  id, location_id: loc, order_type: 'weekly', status: 'submitted', created_at: '2026-09-28T08:00:00Z', submitted_at: null,
  completed_at: null, parent_order_id: null, production_week: '2026-09-28', event_name: null, event_date: null, note: null,
  location: { name_en: loc }, items, ...extra,
})

describe('permissions', () => {
  it('scopes capabilities per role', () => {
    expect(can('restaurant_orderer', 'order')).toBe(true)
    expect(can('restaurant_orderer', 'kitchen')).toBe(false)
    expect(can('bar_staff', 'inventory')).toBe(true)
    expect(can('bar_staff', 'order')).toBe(false)
    expect(can('driver', 'buy.work')).toBe(true)
    expect(can('store_manager', 'catalog.prices')).toBe(false)
    expect(can(null, 'order')).toBe(false)
  })
  it('sends each role to a page it can open', () => {
    const paths: Record<string, string> = { '/admin': 'admin', '/kitchen': 'kitchen', '/dispatch': 'dispatch', '/inventory': 'inventory', '/order': 'order' }
    for (const r of ['admin', 'kitchen_manager', 'driver', 'bar_staff', 'restaurant_orderer', 'store_manager'] as const) {
      const home = homeFor(r)
      expect(can(r, paths[home] as never)).toBe(true)
      expect(navFor(r).some(n => n.to === home)).toBe(true)
    }
  })
  it('never lists the same page twice', () => {
    const tos = navFor('admin').map(n => n.to)
    expect(new Set(tos).size).toBe(tos.length)
  })
})

describe('status', () => {
  it('counts lines and summarises progress', () => {
    const ls = [line('a', 'pending'), line('b', 'ready'), line('c', 'dispatched')]
    expect(countLines(ls)).toMatchObject({ total: 3, pending: 1, ready: 1, dispatched: 1 })
    expect(orderProgress([line('a', 'pending')])).toBe('waiting')
    expect(orderProgress(ls)).toBe('in_kitchen')
    expect(orderProgress([line('a', 'dispatched'), line('b', 'unavailable')])).toBe('on_the_way')
    expect(orderProgress([line('a', 'received'), line('b', 'unavailable')])).toBe('delivered')
  })
  it('lets stores cancel only untouched submitted orders', () => {
    expect(storeCanCancel('submitted', [line('a', 'pending')])).toBe(true)
    expect(storeCanCancel('submitted', [line('a', 'ready')])).toBe(false)
    expect(storeCanCancel('in_progress', [line('a', 'pending')])).toBe(false)
  })
  it('allows top-ups only on open kitchen orders', () => {
    expect(canTopUp('in_progress', 'weekly')).toBe(true)
    expect(canTopUp('completed', 'weekly')).toBe(false)
    expect(canTopUp('submitted', 'procurement')).toBe(false)
  })
})

describe('kitchen grouping', () => {
  const monday = '2026-09-28'
  it('buckets urgent, event, this week and next week', () => {
    expect(bucketOf({ order_type: 'urgent', parent_order_id: null, production_week: null }, monday)).toBe(0)
    expect(bucketOf({ order_type: 'weekly', parent_order_id: 'x', production_week: monday }, monday)).toBe(0)
    expect(bucketOf({ order_type: 'event', parent_order_id: null, production_week: null }, monday)).toBe(1)
    expect(bucketOf({ order_type: 'weekly', parent_order_id: null, production_week: monday }, monday)).toBe(2)
    expect(bucketOf({ order_type: 'weekly', parent_order_id: null, production_week: '2026-10-05' }, monday)).toBe(3)
  })
  it('groups by bucket then store and tallies quantities', () => {
    const groups = groupOrders([
      order('1', 'B', [line('x', 'pending')]),
      order('2', 'A', [line('y', 'pending')]),
      order('3', 'B', [line('z', 'pending', { item_name_snapshot: 'Item x' })]),
      order('4', 'C', [line('u', 'pending')], { order_type: 'urgent' }),
    ], monday)
    expect(groups.map(g => g.key)).toEqual(['0|C', '2|A', '2|B'])
    expect(groups[2].orders).toHaveLength(2)
    expect(groups[2].tally.get('Item x')?.qty).toBe(4)
  })
  it('aggregates by product across stores', () => {
    const agg = aggregateByItem([
      order('1', 'A', [line('a', 'pending', { catalog_item_id: 'p' }), line('b', 'pending', { catalog_item_id: null, item_name_snapshot: 'Custom' })]),
      order('2', 'B', [line('c', 'ready', { catalog_item_id: 'p', quantity: 3 }), line('d', 'pending', { catalog_item_id: 'q', fulfillment_type: 'purchase' })]),
    ])
    expect(agg.make).toHaveLength(1)
    expect(agg.make[0].total).toBe(5)
    expect(agg.make[0].lines.map(l => l.location)).toEqual(['A', 'B'])
    expect(agg.buy).toHaveLength(1)
    expect(agg.adhoc).toHaveLength(1)
  })
})

describe('inventory helpers', () => {
  const today = '2026-09-28'
  it('classifies expiry', () => {
    expect(expiryInfo(null, today).level).toBe('none')
    expect(expiryInfo('2026-09-27', today)).toEqual({ level: 'expired', days: -1 })
    expect(expiryInfo('2026-09-28', today).level).toBe('today')
    expect(expiryInfo('2026-10-03', today)).toEqual({ level: 'soon', days: 5 })
    expect(expiryInfo('2026-11-01', today).level).toBe('ok')
    expect(worstExpiry([{ expires_on: '2026-11-01' }, { expires_on: '2026-09-20' }], today).level).toBe('expired')
    expect(worstExpiry([{ expires_on: '2026-10-05' }, { expires_on: '2026-10-01' }], today).days).toBe(3)
  })
  it('flags low stock with a default threshold of 1', () => {
    expect(isLow(1, null)).toBe(true)
    expect(isLow(2, null)).toBe(false)
    expect(isLow(5, 5)).toBe(true)
  })
  it('formats content totals', () => {
    expect(contentTotal(4, { unit_weight: 500, weight_unit: 'g' })).toBe('2 kg')
    expect(contentTotal(3, { unit_weight: 250, weight_unit: 'g' })).toBe('750 g')
    expect(contentTotal(2, { unit_weight: 12, weight_unit: 'pcs' })).toBe('24 pcs')
    expect(contentTotal(2, { unit_weight: null })).toBeNull()
  })
})

describe('csv & usernames', () => {
  it('escapes CSV cells', () => {
    expect(toCSV([{ label: 'a', value: (r: { v: string }) => r.v }], [{ v: 'x,"y"' }])).toBe('a\r\n"x,""y"""')
  })
  it('maps usernames to login emails and back', () => {
    expect(toLoginEmail(' Anna ')).toBe('anna@restaurant.local')
    expect(toLoginEmail('Boss@Example.com')).toBe('boss@example.com')
    expect(displayUsername('anna@restaurant.local')).toBe('anna')
    expect(displayUsername('boss@example.com')).toBe('boss@example.com')
  })
})

describe('translations', () => {
  const keys = Object.keys(en)
  it.each([['hu', hu], ['zh', zh]])('%s has every key, non-empty, with the same placeholders', (_, dict) => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) || []).sort().join(',')
    for (const k of keys) {
      const v = (dict as Record<string, string>)[k]
      expect(v, k).toBeTruthy()
      expect(vars(v), k).toBe(vars((en as Record<string, string>)[k]))
    }
    expect(Object.keys(dict).length).toBe(keys.length)
  })
})
