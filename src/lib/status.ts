import type { DispatchStatus, OrderLine, OrderStatus, OrderType } from './types'

// Display-side knowledge of the order-line lifecycle. The authoritative
// transition rules live in the database (migrations 004 + 007).

export const isPending = (s: DispatchStatus) => s === 'pending'
export const isHandled = (s: DispatchStatus) => s !== 'pending'
export const isReadyToDispatch = (s: DispatchStatus) => s === 'ready' || s === 'short'
export const isOutTheDoor = (s: DispatchStatus) => s === 'dispatched' || s === 'received'

/** Lines the kitchen can still undo (back to pending). */
export const isResettable = (s: DispatchStatus) =>
  s === 'ready' || s === 'short' || s === 'unavailable' || s === 'procuring'

/** Safe to archive at week close. */
export const isWeekCloseTerminal = (s: DispatchStatus) =>
  s === 'dispatched' || s === 'received' || s === 'unavailable'

export const isOpenOrder = (s: OrderStatus) => s === 'submitted' || s === 'in_progress'

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'bad' | 'buy' | 'accent'

export const LINE_TONE: Record<DispatchStatus, Tone> = {
  pending: 'neutral', ready: 'ok', short: 'warn', unavailable: 'bad',
  procuring: 'buy', dispatched: 'info', received: 'accent',
}

export const ORDER_TONE: Record<OrderStatus, Tone> = {
  draft: 'neutral', submitted: 'info', in_progress: 'warn', completed: 'ok', cancelled: 'bad', archived: 'neutral',
}

export const TYPE_TONE: Record<OrderType, Tone> = {
  weekly: 'neutral', urgent: 'bad', event: 'accent', procurement: 'buy',
}

export interface LineCounts { total: number; pending: number; ready: number; short: number; unavailable: number; procuring: number; dispatched: number; received: number }

export function countLines(lines: Pick<OrderLine, 'dispatch_status'>[]): LineCounts {
  const c: LineCounts = { total: lines.length, pending: 0, ready: 0, short: 0, unavailable: 0, procuring: 0, dispatched: 0, received: 0 }
  for (const l of lines) c[l.dispatch_status]++
  return c
}

/** Store-facing progress summary for an order. */
export function orderProgress(lines: Pick<OrderLine, 'dispatch_status'>[]): 'waiting' | 'in_kitchen' | 'on_the_way' | 'delivered' | 'empty' {
  if (!lines.length) return 'empty'
  const c = countLines(lines)
  if (c.received + c.unavailable === c.total && c.received > 0) return 'delivered'
  if (c.dispatched > 0 && c.pending === 0) return 'on_the_way'
  if (c.pending === c.total) return 'waiting'
  return 'in_kitchen'
}

/** Store may cancel its own order only while the kitchen hasn't touched it. */
export function storeCanCancel(status: OrderStatus, lines: Pick<OrderLine, 'dispatch_status'>[]): boolean {
  return status === 'submitted' && lines.every(l => l.dispatch_status === 'pending')
}

/** Top-ups can be attached to open non-procurement orders. */
export function canTopUp(status: OrderStatus, type: OrderType): boolean {
  return type !== 'procurement' && (status === 'submitted' || status === 'in_progress')
}
