// Centralized order/item/procurement state machine.
//
// Before this module, every page (Kitchen/Dispatch/Procurement/Ordering)
// wrote orders.status, order_items.dispatch_status and procurement_tasks.status
// directly, each re-deriving by hand which from->to jumps were legal. This
// collects that into one set of transition tables + wrapper functions so a
// bad jump throws instead of silently writing inconsistent state.
//
// Scope: this only governs the *_status columns themselves (plus the
// order_items.status field, which is purely derived from dispatch_status —
// see ITEM_DONE_DISPATCH_STATUSES below). Side effects that happen alongside
// a transition (stock RPCs, procurement_tasks rows, etc.) stay in the
// calling page, same as before.
import { supabase } from './supabase'

// All writes here are optimistic-concurrency safe: the UPDATE carries the
// expected from-state (.eq(status, from)) and we check a row was actually
// updated. If another client already moved the row, the write matches zero
// rows and we surface a stale-state error instead of silently overwriting.
// The database additionally rejects illegal jumps via triggers
// (supabase/migrations/004_state_machine_guards.sql) — this module is the
// convenience layer, the DB is the enforcement layer.
function staleError(entity, from, to) {
  return new LifecycleError(
    `Someone else already changed this ${entity} (expected ${from}) — reload and retry`,
    { entity, from, to }
  )
}

export class LifecycleError extends Error {
  constructor(message, { entity, from, to } = {}) {
    super(message)
    this.name = 'LifecycleError'
    this.entity = entity
    this.from = from
    this.to = to
  }
}

// ---------------------------------------------------------------------
// orders.status
// ---------------------------------------------------------------------
export const ORDER_STATUSES = ['draft', 'submitted', 'in_progress', 'completed', 'cancelled', 'archived']
export const INITIAL_ORDER_STATUS = 'submitted'

// Orders in these statuses are excluded from "merge into an open weekly
// order" matching (orderData.findMergeTarget) — they're done, one way or another.
export const ORDER_STATUSES_EXCLUDED_FROM_MERGE = ['completed', 'cancelled']

const ORDER_TRANSITIONS = {
  draft: ['submitted'],                       // not used by current app flow; DB column default only
  submitted: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled', 'archived'],
  completed: ['in_progress', 'archived'],      // reopen, or swept up in week-close archive
  // restore — KitchenPage.restoreOrder() picks 'submitted' or 'in_progress'
  // based on whether any item was already touched before the cancel, instead
  // of always resetting to 'submitted' regardless of prior progress.
  cancelled: ['submitted', 'in_progress'],
  archived: [],
}

export function canTransitionOrder(from, to) {
  return (ORDER_TRANSITIONS[from] || []).includes(to)
}

function assertOrderTransition(from, to) {
  if (!canTransitionOrder(from, to)) {
    throw new LifecycleError(`Illegal order transition: ${from} → ${to}`, { entity: 'order', from, to })
  }
}

// in_progress/submitted orders are the ones a restaurant can still add a
// top-up to from OrderingPage's history view.
export function canAmendOrder(status) {
  return status === 'in_progress' || status === 'submitted'
}

export function isOrderCompleted(status) {
  return status === 'completed'
}

// Move one order to `toStatus`. Validates against the current in-memory
// `order.status` before writing — same as every call site already had
// `order` in hand, this avoids an extra round trip.
export async function transitionOrder(order, toStatus, extra = {}) {
  assertOrderTransition(order.status, toStatus)
  const { data, error } = await supabase.from('orders')
    .update({ status: toStatus, ...extra })
    .eq('id', order.id).eq('status', order.status)   // compare-and-swap
    .select('id')
  if (error) return { error }
  if (!data?.length) return { error: staleError('order', order.status, toStatus) }
  return { error: null }
}

// Bulk version (KitchenPage finishWeek, DispatchPage closeWeek). Validates
// every row before issuing the single batched update.
export async function transitionOrdersBulk(orders, toStatus, extra = {}) {
  for (const o of orders) assertOrderTransition(o.status, toStatus)
  if (!orders.length) return { error: null }
  // rows may start from different (all-legal) statuses — one guarded update
  // per from-status group, and verify every row was actually moved
  const byFrom = new Map()
  for (const o of orders) {
    if (!byFrom.has(o.status)) byFrom.set(o.status, [])
    byFrom.get(o.status).push(o.id)
  }
  for (const [from, ids] of byFrom) {
    const { data, error } = await supabase.from('orders')
      .update({ status: toStatus, ...extra })
      .in('id', ids).eq('status', from)
      .select('id')
    if (error) return { error }
    if ((data?.length || 0) !== ids.length) return { error: staleError('order', from, toStatus) }
  }
  return { error: null }
}

// ---------------------------------------------------------------------
// order_items.dispatch_status (+ the derived order_items.status column)
// ---------------------------------------------------------------------
export const ITEM_DISPATCH_STATUSES = ['pending', 'ready', 'short', 'unavailable', 'procuring', 'dispatched', 'received']

// order_items.status is a coarse pending/done flag that a DB trigger reacts
// to. Every call site has always set it in lockstep with dispatch_status —
// 'pending' iff dispatch_status is 'pending', 'done' otherwise. Deriving it
// here means callers can't forget to set one and not the other.
const ITEM_DONE_DISPATCH_STATUSES = new Set(['ready', 'short', 'unavailable', 'procuring', 'dispatched', 'received'])
function itemStatusFor(dispatchStatus) {
  return ITEM_DONE_DISPATCH_STATUSES.has(dispatchStatus) ? 'done' : 'pending'
}

const ITEM_DISPATCH_TRANSITIONS = {
  pending: ['ready', 'short', 'unavailable', 'procuring'],
  // 'procuring' here is the undo path for ProcurementPage.reopen() sending a
  // bought-then-reopened task's line back to the buyer queue.
  ready: ['pending', 'dispatched', 'procuring'],
  short: ['pending', 'dispatched'],
  // unavailable -> procuring: a "can't buy" line whose buy-list entry is reopened
  unavailable: ['pending', 'procuring'],
  // procuring -> unavailable: the buyer marked the linked buy-list entry unavailable
  procuring: ['pending', 'ready', 'unavailable'],
  // once an item has left the kitchen (dispatched) or been confirmed at the
  // destination (received), Kitchen's "tap to redo" no longer offers pending
  // as a target — undoing either doesn't reverse the stock already consumed
  // or recall a delivery already out the door.
  dispatched: ['received'],
  received: [],
}

export function canTransitionItem(from, to) {
  return (ITEM_DISPATCH_TRANSITIONS[from] || []).includes(to)
}

function assertItemTransition(from, to) {
  if (!canTransitionItem(from, to)) {
    throw new LifecycleError(`Illegal item transition: ${from} → ${to}`, { entity: 'item', from, to })
  }
}

export function isItemPending(dispatchStatus) {
  return dispatchStatus === 'pending'
}
export function isItemHandled(dispatchStatus) {
  return dispatchStatus !== 'pending'
}

// 'ready' or 'short' — fulfilled (fully or partially) and waiting to go out.
export const ITEM_READY_TO_DISPATCH_STATUSES = ['ready', 'short']
export function isItemReadyToDispatch(dispatchStatus) {
  return ITEM_READY_TO_DISPATCH_STATUSES.includes(dispatchStatus)
}

// "Safe to archive at week close" — DispatchPage's old local TERMINAL.
export const WEEK_CLOSE_TERMINAL_DISPATCH_STATUSES = ['dispatched', 'received', 'unavailable']
export function isItemWeekCloseTerminal(dispatchStatus) {
  return WEEK_CLOSE_TERMINAL_DISPATCH_STATUSES.includes(dispatchStatus)
}

// Move one order_item to `toDispatchStatus`. `extra` carries the
// transition-specific fields each page already passed (fulfilled_qty,
// unavail_reason, handled_by, ...) — status/dispatch_status are derived/set
// here so callers don't repeat them.
export async function transitionItem(item, toDispatchStatus, extra = {}) {
  assertItemTransition(item.dispatch_status, toDispatchStatus)
  const fields = { dispatch_status: toDispatchStatus, status: itemStatusFor(toDispatchStatus), ...extra }
  const { data, error } = await supabase.from('order_items')
    .update(fields)
    .eq('id', item.id).eq('dispatch_status', item.dispatch_status)   // compare-and-swap
    .select('id')
  if (error) return { error }
  if (!data?.length) return { error: staleError('item', item.dispatch_status, toDispatchStatus) }
  return { error: null }
}

// Bulk version where every row in `items` moves to the same toDispatchStatus
// with the same extra fields (KitchenPage ByItem markGroupReady,
// DispatchPage dispatchAllReady, sendAllToBuyer).
export async function transitionItemsBulk(items, toDispatchStatus, extra = {}) {
  for (const it of items) assertItemTransition(it.dispatch_status, toDispatchStatus)
  if (!items.length) return { error: null }
  const fields = { dispatch_status: toDispatchStatus, status: itemStatusFor(toDispatchStatus), ...extra }
  const byFrom = new Map()
  for (const it of items) {
    if (!byFrom.has(it.dispatch_status)) byFrom.set(it.dispatch_status, [])
    byFrom.get(it.dispatch_status).push(it.id)
  }
  for (const [from, ids] of byFrom) {
    const { data, error } = await supabase.from('order_items')
      .update(fields)
      .in('id', ids).eq('dispatch_status', from)   // compare-and-swap
      .select('id')
    if (error) return { error }
    if ((data?.length || 0) !== ids.length) return { error: staleError('item', from, toDispatchStatus) }
  }
  return { error: null }
}

// Per-row targets/fields with compare-and-swap semantics. Each row:
// { id, fromDispatchStatus, toDispatchStatus, fields }. Runs the guarded
// updates concurrently and fails if any row was changed by someone else.
// (Kitchen production paths now use the ordering.kitchen_set_produced RPC
// instead — this stays for any remaining mixed-target callers.)
export async function transitionItemsUpsert(rows) {
  for (const r of rows) assertItemTransition(r.fromDispatchStatus, r.toDispatchStatus)
  if (!rows.length) return { error: null }
  const results = await Promise.all(rows.map(r =>
    supabase.from('order_items')
      .update({ dispatch_status: r.toDispatchStatus, status: itemStatusFor(r.toDispatchStatus), ...r.fields })
      .eq('id', r.id).eq('dispatch_status', r.fromDispatchStatus)
      .select('id')
  ))
  for (let i = 0; i < results.length; i++) {
    if (results[i].error) return { error: results[i].error }
    if (!results[i].data?.length) return { error: staleError('item', rows[i].fromDispatchStatus, rows[i].toDispatchStatus) }
  }
  return { error: null }
}

// ---------------------------------------------------------------------
// procurement_tasks.status
// ---------------------------------------------------------------------
export const PROCUREMENT_STATUSES = ['pending', 'bought', 'unavailable']

const PROCUREMENT_TRANSITIONS = {
  pending: ['bought', 'unavailable'],
  bought: ['pending'],
  unavailable: ['pending'],
}

export function canTransitionProcurement(from, to) {
  return (PROCUREMENT_TRANSITIONS[from] || []).includes(to)
}

function assertProcurementTransition(from, to) {
  if (!canTransitionProcurement(from, to)) {
    throw new LifecycleError(`Illegal procurement task transition: ${from} → ${to}`, { entity: 'procurement_task', from, to })
  }
}

export async function transitionProcurementTask(task, toStatus, extra = {}) {
  assertProcurementTransition(task.status, toStatus)
  const { data, error } = await supabase.from('procurement_tasks')
    .update({ status: toStatus, ...extra })
    .eq('id', task.id).eq('status', task.status)   // compare-and-swap
    .select('id')
  if (error) return { error }
  if (!data?.length) return { error: staleError('procurement_task', task.status, toStatus) }
  return { error: null }
}
