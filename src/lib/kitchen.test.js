import { describe, it, expect } from 'vitest'
import { bucketOf, groupKey, buildOrderGroups, aggregateByItem } from './kitchen'

const THIS_MONDAY = '2024-01-08'

describe('bucketOf', () => {
  it('urgent orders are bucket 0', () => {
    expect(bucketOf({ order_type: 'urgent' }, THIS_MONDAY)).toBe(0)
  })

  it('top-ups (parent_order_id set) are bucket 0 regardless of order_type', () => {
    expect(bucketOf({ order_type: 'normal', parent_order_id: 'p1' }, THIS_MONDAY)).toBe(0)
  })

  it('event orders are bucket 1', () => {
    expect(bucketOf({ order_type: 'event' }, THIS_MONDAY)).toBe(1)
  })

  it('no production_week falls into this week (bucket 2)', () => {
    expect(bucketOf({ order_type: 'normal' }, THIS_MONDAY)).toBe(2)
  })

  it('production_week on/before thisMonday is this week (bucket 2, boundary)', () => {
    expect(bucketOf({ order_type: 'normal', production_week: THIS_MONDAY }, THIS_MONDAY)).toBe(2)
    expect(bucketOf({ order_type: 'normal', production_week: '2024-01-01' }, THIS_MONDAY)).toBe(2)
  })

  it('production_week after thisMonday is next week (bucket 3)', () => {
    expect(bucketOf({ order_type: 'normal', production_week: '2024-01-15' }, THIS_MONDAY)).toBe(3)
  })
})

describe('groupKey', () => {
  it('combines bucket and location name', () => {
    expect(groupKey({ order_type: 'urgent', location: { name_en: 'Store A' } }, THIS_MONDAY)).toBe('0|Store A')
  })

  it('falls back to an em-dash when location is missing', () => {
    expect(groupKey({ order_type: 'urgent' }, THIS_MONDAY)).toBe('0|—')
  })
})

describe('buildOrderGroups', () => {
  const orders = [
    { id: 1, status: 'in_progress', order_type: 'normal', location: { name_en: 'Store B' }, created_at: '2024-01-02', items: [{ item_name_snapshot: 'Bread', quantity: 2 }] },
    { id: 2, status: 'in_progress', order_type: 'urgent', location: { name_en: 'Store A' }, created_at: '2024-01-01', items: [{ item_name_snapshot: 'Milk', quantity: 1 }] },
    { id: 3, status: 'in_progress', order_type: 'event', location: { name_en: 'Store A' }, created_at: '2024-01-03', items: [{ item_name_snapshot: 'Cake', quantity: 3 }] },
    { id: 4, status: 'completed', order_type: 'normal', location: { name_en: 'Store A' }, created_at: '2024-01-04', items: [{ item_name_snapshot: 'Bread', quantity: 5 }] },
    { id: 5, status: 'in_progress', order_type: 'normal', production_week: '2024-01-15', location: { name_en: 'Store A' }, created_at: '2024-01-05', items: [{ item_name_snapshot: 'Eggs', quantity: 4 }] },
  ]

  it('excludes completed orders by default and sorts by bucket then location then created_at', () => {
    const { list } = buildOrderGroups(orders, THIS_MONDAY, false)
    expect(list.map(o => o.id)).toEqual([2, 3, 1, 5])
  })

  it('shows only completed orders when showCompleted is true', () => {
    const { list } = buildOrderGroups(orders, THIS_MONDAY, true)
    expect(list.map(o => o.id)).toEqual([4])
  })

  it('builds per-group count and item-quantity totals', () => {
    const { meta } = buildOrderGroups(orders, THIS_MONDAY, false)
    expect(meta['0|Store A']).toEqual({ count: 1, items: { Milk: 1 }, loc: 'Store A' })
    expect(meta['1|Store A']).toEqual({ count: 1, items: { Cake: 3 }, loc: 'Store A' })
    expect(meta['2|Store B']).toEqual({ count: 1, items: { Bread: 2 }, loc: 'Store B' })
    expect(meta['3|Store A']).toEqual({ count: 1, items: { Eggs: 4 }, loc: 'Store A' })
  })

  it('sums quantities for the same item name within a group and bumps count per order', () => {
    const twoOrdersSameGroup = [
      { id: 1, status: 'in_progress', order_type: 'urgent', location: { name_en: 'Store A' }, created_at: '2024-01-01', items: [{ item_name_snapshot: 'Bread', quantity: 2 }] },
      { id: 2, status: 'in_progress', order_type: 'urgent', location: { name_en: 'Store A' }, created_at: '2024-01-02', items: [{ item_name_snapshot: 'Bread', quantity: 3 }] },
    ]
    const { meta } = buildOrderGroups(twoOrdersSameGroup, THIS_MONDAY, false)
    expect(meta['0|Store A']).toEqual({ count: 2, items: { Bread: 5 }, loc: 'Store A' })
  })

  it('breaks ties within the same bucket by location name, then by created_at', () => {
    const sameBucket = [
      { id: 1, status: 'in_progress', order_type: 'urgent', location: { name_en: 'Zeta' }, created_at: '2024-01-01', items: [] },
      { id: 2, status: 'in_progress', order_type: 'urgent', location: { name_en: 'Alpha' }, created_at: '2024-01-03', items: [] },
      { id: 3, status: 'in_progress', order_type: 'urgent', location: { name_en: 'Alpha' }, created_at: '2024-01-02', items: [] },
    ]
    const { list } = buildOrderGroups(sameBucket, THIS_MONDAY, false)
    expect(list.map(o => o.id)).toEqual([3, 2, 1])
  })

  it('returns empty list/meta when there is nothing to show', () => {
    const { list, meta } = buildOrderGroups([], THIS_MONDAY, false)
    expect(list).toEqual([])
    expect(meta).toEqual({})
  })
})

describe('aggregateByItem', () => {
  const orders = [
    {
      location: { name_en: 'Store A' },
      items: [
        { id: 'i1', catalog_item_id: 'c1', unit_snapshot: 'kg', item_name_snapshot: 'Flour', quantity: 2, fulfillment_type: 'make', dispatch_status: 'pending' },
        { id: 'i2', catalog_item_id: 'c2', unit_snapshot: 'pcs', item_name_snapshot: 'Cups', quantity: 5, fulfillment_type: 'purchase', dispatch_status: 'ready' },
        { id: 'i3', catalog_item_id: null, item_name_snapshot: 'Custom Sign', quantity: 1, fulfillment_type: null, dispatch_status: 'pending' },
      ],
    },
    {
      location: { name_en: 'Store B' },
      items: [
        { id: 'i4', catalog_item_id: 'c1', unit_snapshot: 'kg', item_name_snapshot: 'Flour', quantity: 3, fulfillment_type: 'make', dispatch_status: 'pending' },
        { id: 'i5', catalog_item_id: 'c3', unit_snapshot: '', item_name_snapshot: 'Mystery', quantity: 1, fulfillment_type: null, dispatch_status: 'pending' },
      ],
    },
  ]

  it('sums quantities for the same catalog item + unit across stores', () => {
    const { make } = aggregateByItem(orders)
    expect(make).toHaveLength(1)
    expect(make[0]).toMatchObject({ name: 'Flour', unit: 'kg', type: 'make', total: 5, itemIds: ['i1', 'i4'] })
    expect(make[0].byLoc).toEqual(new Map([['Store A', 2], ['Store B', 3]]))
    expect(make[0].locItems).toEqual([
      { id: 'i1', loc: 'Store A', qty: 2, status: 'pending' },
      { id: 'i4', loc: 'Store B', qty: 3, status: 'pending' },
    ])
  })

  it('buckets purchase-type items into buy', () => {
    const { buy } = aggregateByItem(orders)
    expect(buy).toHaveLength(1)
    expect(buy[0]).toMatchObject({ name: 'Cups', unit: 'pcs', type: 'purchase', total: 5 })
  })

  it('buckets items with no fulfillment_type into unsorted', () => {
    const { unsorted } = aggregateByItem(orders)
    expect(unsorted).toHaveLength(1)
    expect(unsorted[0]).toMatchObject({ name: 'Mystery', total: 1 })
  })

  it('routes items without a catalog_item_id to adhoc, tagged with their location', () => {
    const { adhoc } = aggregateByItem(orders)
    expect(adhoc).toHaveLength(1)
    expect(adhoc[0]).toMatchObject({ id: 'i3', item_name_snapshot: 'Custom Sign', loc: 'Store A' })
  })

  it('treats missing/non-numeric quantity as 0 instead of NaN', () => {
    const withMissingQty = [{
      location: { name_en: 'Store A' },
      items: [{ id: 'i1', catalog_item_id: 'c1', unit_snapshot: 'kg', item_name_snapshot: 'Flour', quantity: undefined, fulfillment_type: 'make', dispatch_status: 'pending' }],
    }]
    const { make } = aggregateByItem(withMissingQty)
    expect(make[0].total).toBe(0)
    expect(Number.isNaN(make[0].total)).toBe(false)
  })

  it('returns empty buckets for no orders', () => {
    expect(aggregateByItem([])).toEqual({ make: [], buy: [], unsorted: [], adhoc: [] })
  })
})
