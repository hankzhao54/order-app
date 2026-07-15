import { describe, it, expect, vi } from 'vitest'

// orderLifecycle.js talks to supabase for the actual writes. We only want to
// exercise the state-machine validation and the compare-and-swap behavior
// here, so the client is mocked with a chain that tracks which ids the
// guarded update targeted and "updates" all of them — except the sentinel
// id 'stale', which simulates a row another client already moved (the
// .eq(status, expected) filter matches zero rows for it).
vi.mock('./supabase', () => {
  function makeChain() {
    const state = { ids: [] }
    const chain = {
      update: vi.fn(() => chain),
      eq: vi.fn((col, val) => { if (col === 'id') state.ids = [val]; return chain }),
      in: vi.fn((col, vals) => { if (col === 'id') state.ids = vals; return chain }),
      select: vi.fn(() => Promise.resolve({
        data: state.ids.filter(id => id !== 'stale').map(id => ({ id })),
        error: null,
      })),
    }
    return chain
  }
  return { supabase: { from: vi.fn(() => makeChain()) } }
})

import {
  LifecycleError,
  ORDER_STATUSES,
  ITEM_DISPATCH_STATUSES,
  PROCUREMENT_STATUSES,
  canTransitionOrder,
  canTransitionItem,
  canTransitionProcurement,
  canAmendOrder,
  isOrderCompleted,
  isItemPending,
  isItemHandled,
  isItemReadyToDispatch,
  isItemWeekCloseTerminal,
  transitionOrder,
  transitionOrdersBulk,
  transitionItem,
  transitionItemsBulk,
  transitionItemsUpsert,
  transitionProcurementTask,
} from './orderLifecycle'

const ORDER_LEGAL = {
  draft: ['submitted'],
  submitted: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled', 'archived'],
  completed: ['in_progress', 'archived'],
  cancelled: ['submitted', 'in_progress'],
  archived: [],
}

const ITEM_LEGAL = {
  pending: ['ready', 'short', 'unavailable', 'procuring'],
  ready: ['pending', 'dispatched', 'procuring'],
  short: ['pending', 'dispatched'],
  unavailable: ['pending', 'procuring'],           // reopen a "can't buy" line
  procuring: ['pending', 'ready', 'unavailable'],  // buyer marks it unavailable
  dispatched: ['received'],
  received: [],
}

const PROCUREMENT_LEGAL = {
  pending: ['bought', 'unavailable'],
  bought: ['pending'],
  unavailable: ['pending'],
}

describe('orders.status state machine', () => {
  // Exhaustively cross every status against every other status. This covers
  // every legal jump, every illegal jump, and self-transitions (none of the
  // tables list a status transitioning to itself, so every self-pair must
  // come back false).
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      const expected = ORDER_LEGAL[from].includes(to)
      it(`${from} → ${to} is ${expected ? 'legal' : 'illegal'}`, () => {
        expect(canTransitionOrder(from, to)).toBe(expected)
      })
    }
  }

  it('rejects an unknown "from" status', () => {
    expect(canTransitionOrder('bogus', 'submitted')).toBe(false)
  })

  it('rejects an empty-string "from" status', () => {
    expect(canTransitionOrder('', 'submitted')).toBe(false)
  })

  it('rejects an empty-string "to" status', () => {
    expect(canTransitionOrder('submitted', '')).toBe(false)
  })
})

describe('order_items.dispatch_status state machine', () => {
  for (const from of ITEM_DISPATCH_STATUSES) {
    for (const to of ITEM_DISPATCH_STATUSES) {
      const expected = ITEM_LEGAL[from].includes(to)
      it(`${from} → ${to} is ${expected ? 'legal' : 'illegal'}`, () => {
        expect(canTransitionItem(from, to)).toBe(expected)
      })
    }
  }

  it('allows the procuring → ready undo path (ProcurementPage.reopen)', () => {
    expect(canTransitionItem('procuring', 'ready')).toBe(true)
  })

  it('allows the buy-list unavailable cascade (procuring → unavailable → procuring)', () => {
    expect(canTransitionItem('procuring', 'unavailable')).toBe(true)
    expect(canTransitionItem('unavailable', 'procuring')).toBe(true)
  })

  it('does not allow undoing dispatched/received back to pending', () => {
    expect(canTransitionItem('dispatched', 'pending')).toBe(false)
    expect(canTransitionItem('received', 'pending')).toBe(false)
  })

  it('rejects an unknown "from" status', () => {
    expect(canTransitionItem('bogus', 'pending')).toBe(false)
  })
})

describe('procurement_tasks.status state machine', () => {
  for (const from of PROCUREMENT_STATUSES) {
    for (const to of PROCUREMENT_STATUSES) {
      const expected = PROCUREMENT_LEGAL[from].includes(to)
      it(`${from} → ${to} is ${expected ? 'legal' : 'illegal'}`, () => {
        expect(canTransitionProcurement(from, to)).toBe(expected)
      })
    }
  }

  it('rejects an unknown "from" status', () => {
    expect(canTransitionProcurement('bogus', 'pending')).toBe(false)
  })
})

describe('LifecycleError', () => {
  it('carries entity/from/to context and a readable message', () => {
    const err = new LifecycleError('Illegal order transition: archived → draft', {
      entity: 'order', from: 'archived', to: 'draft',
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('LifecycleError')
    expect(err.entity).toBe('order')
    expect(err.from).toBe('archived')
    expect(err.to).toBe('draft')
    expect(err.message).toBe('Illegal order transition: archived → draft')
  })
})

describe('transitionOrder / transitionOrdersBulk', () => {
  it('resolves for a legal transition', async () => {
    await expect(transitionOrder({ id: 'o1', status: 'submitted' }, 'in_progress')).resolves.toEqual({ error: null })
  })

  it('throws LifecycleError for an illegal transition', async () => {
    await expect(transitionOrder({ id: 'o1', status: 'archived' }, 'draft')).rejects.toBeInstanceOf(LifecycleError)
  })

  it('throws for a self-transition', async () => {
    await expect(transitionOrder({ id: 'o1', status: 'submitted' }, 'submitted')).rejects.toBeInstanceOf(LifecycleError)
  })

  it('still validates the transition when id is empty', async () => {
    await expect(transitionOrder({ id: '', status: 'archived' }, 'draft')).rejects.toBeInstanceOf(LifecycleError)
  })

  it('bulk: no-ops on an empty array without validating anything', async () => {
    await expect(transitionOrdersBulk([], 'archived')).resolves.toEqual({ error: null })
  })

  it('bulk: resolves when every row has a legal transition', async () => {
    const orders = [{ id: '1', status: 'submitted' }, { id: '2', status: 'submitted' }]
    await expect(transitionOrdersBulk(orders, 'in_progress')).resolves.toEqual({ error: null })
  })

  it('bulk: throws if any single row is illegal, even if the rest are legal (all-or-nothing)', async () => {
    const orders = [{ id: '1', status: 'submitted' }, { id: '2', status: 'archived' }]
    await expect(transitionOrdersBulk(orders, 'in_progress')).rejects.toBeInstanceOf(LifecycleError)
  })
})

describe('transitionItem / transitionItemsBulk / transitionItemsUpsert', () => {
  it('resolves for a legal transition and derives status="done"', async () => {
    await expect(transitionItem({ id: 'i1', dispatch_status: 'pending' }, 'ready')).resolves.toEqual({ error: null })
  })

  it('throws LifecycleError for an illegal transition', async () => {
    await expect(transitionItem({ id: 'i1', dispatch_status: 'received' }, 'pending')).rejects.toBeInstanceOf(LifecycleError)
  })

  it('throws for a self-transition', async () => {
    await expect(transitionItem({ id: 'i1', dispatch_status: 'ready' }, 'ready')).rejects.toBeInstanceOf(LifecycleError)
  })

  it('bulk: no-ops on an empty array', async () => {
    await expect(transitionItemsBulk([], 'ready')).resolves.toEqual({ error: null })
  })

  it('bulk: throws if any row is illegal (all-or-nothing)', async () => {
    const items = [{ id: '1', dispatch_status: 'pending' }, { id: '2', dispatch_status: 'received' }]
    await expect(transitionItemsBulk(items, 'ready')).rejects.toBeInstanceOf(LifecycleError)
  })

  it('upsert: no-ops on an empty array', async () => {
    await expect(transitionItemsUpsert([])).resolves.toEqual({ error: null })
  })

  it('upsert: resolves when every row is independently legal, even with mixed targets', async () => {
    const rows = [
      { id: '1', fromDispatchStatus: 'pending', toDispatchStatus: 'ready', fields: { fulfilled_qty: 2 } },
      { id: '2', fromDispatchStatus: 'pending', toDispatchStatus: 'short', fields: { fulfilled_qty: 1 } },
    ]
    await expect(transitionItemsUpsert(rows)).resolves.toEqual({ error: null })
  })

  it('upsert: throws if any row is illegal (all-or-nothing)', async () => {
    const rows = [
      { id: '1', fromDispatchStatus: 'pending', toDispatchStatus: 'ready', fields: {} },
      { id: '2', fromDispatchStatus: 'received', toDispatchStatus: 'pending', fields: {} },
    ]
    await expect(transitionItemsUpsert(rows)).rejects.toBeInstanceOf(LifecycleError)
  })
})

describe('optimistic concurrency (compare-and-swap)', () => {
  // The sentinel id 'stale' simulates another client having already moved
  // the row: the guarded update matches zero rows.
  it('transitionOrder surfaces a stale-state error instead of overwriting', async () => {
    const { error } = await transitionOrder({ id: 'stale', status: 'submitted' }, 'in_progress')
    expect(error).toBeInstanceOf(LifecycleError)
    expect(error.message).toMatch(/reload/i)
  })

  it('transitionItem surfaces a stale-state error', async () => {
    const { error } = await transitionItem({ id: 'stale', dispatch_status: 'pending' }, 'ready')
    expect(error).toBeInstanceOf(LifecycleError)
  })

  it('transitionItemsBulk fails as a whole when one row is stale', async () => {
    const items = [{ id: '1', dispatch_status: 'pending' }, { id: 'stale', dispatch_status: 'pending' }]
    const { error } = await transitionItemsBulk(items, 'ready')
    expect(error).toBeInstanceOf(LifecycleError)
  })

  it('transitionProcurementTask surfaces a stale-state error', async () => {
    const { error } = await transitionProcurementTask({ id: 'stale', status: 'pending' }, 'bought')
    expect(error).toBeInstanceOf(LifecycleError)
  })

  it('two clients moving the same row: first wins, second gets the stale error', async () => {
    // client A moved i1 pending → ready on the server; client B still has the
    // cached 'pending' row. B's guarded update matches nothing.
    const ok = await transitionItem({ id: 'i1', dispatch_status: 'pending' }, 'ready')
    expect(ok.error).toBeNull()
    const b = await transitionItem({ id: 'stale', dispatch_status: 'pending' }, 'ready')
    expect(b.error).toBeInstanceOf(LifecycleError)
  })
})

describe('transitionProcurementTask', () => {
  it('resolves for a legal transition', async () => {
    await expect(transitionProcurementTask({ id: 't1', status: 'pending' }, 'bought')).resolves.toEqual({ error: null })
  })

  it('throws LifecycleError for an illegal transition', async () => {
    await expect(transitionProcurementTask({ id: 't1', status: 'bought' }, 'unavailable')).rejects.toBeInstanceOf(LifecycleError)
  })

  it('throws for a self-transition', async () => {
    await expect(transitionProcurementTask({ id: 't1', status: 'pending' }, 'pending')).rejects.toBeInstanceOf(LifecycleError)
  })
})

describe('derived predicates', () => {
  it('canAmendOrder', () => {
    expect(canAmendOrder('in_progress')).toBe(true)
    expect(canAmendOrder('submitted')).toBe(true)
    expect(canAmendOrder('completed')).toBe(false)
    expect(canAmendOrder('cancelled')).toBe(false)
    expect(canAmendOrder('archived')).toBe(false)
  })

  it('isOrderCompleted', () => {
    expect(isOrderCompleted('completed')).toBe(true)
    expect(isOrderCompleted('in_progress')).toBe(false)
  })

  it('isItemPending / isItemHandled', () => {
    expect(isItemPending('pending')).toBe(true)
    expect(isItemHandled('pending')).toBe(false)
    for (const s of ['ready', 'short', 'unavailable', 'procuring', 'dispatched', 'received']) {
      expect(isItemPending(s)).toBe(false)
      expect(isItemHandled(s)).toBe(true)
    }
  })

  it('isItemReadyToDispatch', () => {
    expect(isItemReadyToDispatch('ready')).toBe(true)
    expect(isItemReadyToDispatch('short')).toBe(true)
    expect(isItemReadyToDispatch('pending')).toBe(false)
    expect(isItemReadyToDispatch('dispatched')).toBe(false)
  })

  it('isItemWeekCloseTerminal', () => {
    expect(isItemWeekCloseTerminal('dispatched')).toBe(true)
    expect(isItemWeekCloseTerminal('received')).toBe(true)
    expect(isItemWeekCloseTerminal('unavailable')).toBe(true)
    expect(isItemWeekCloseTerminal('ready')).toBe(false)
    expect(isItemWeekCloseTerminal('pending')).toBe(false)
  })
})
