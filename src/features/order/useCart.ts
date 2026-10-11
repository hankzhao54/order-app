import { useCallback, useEffect, useState } from 'react'
import type { OrderType } from '@/lib/types'

export interface AdhocLine { key: string; name: string; qty: number; unit: string }
export interface CartState {
  lines: Record<string, number> // catalog id -> qty
  adhoc: AdhocLine[]
  type: OrderType
  eventName: string
  eventDate: string
}

const EMPTY: CartState = { lines: {}, adhoc: [], type: 'weekly', eventName: '', eventDate: '' }

function load(key: string): CartState {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...EMPTY, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return EMPTY
}

/** Cart per location, kept in localStorage so a half-built order survives a reload. */
export function useCart(locationId: string) {
  const key = `order.cart.v2.${locationId || 'none'}`
  const [cart, setCart] = useState<CartState>(() => load(key))
  useEffect(() => { setCart(load(key)) }, [key])
  useEffect(() => {
    try {
      const empty = !Object.keys(cart.lines).length && !cart.adhoc.length
      if (empty && cart.type === 'weekly') localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(cart))
    } catch { /* ignore */ }
  }, [key, cart])

  const setQty = useCallback((id: string, qty: number) => setCart(c => {
    const lines = { ...c.lines }
    if (qty > 0) lines[id] = qty
    else delete lines[id]
    return { ...c, lines }
  }), [])
  const add = useCallback((id: string, qty = 1) => setCart(c => ({ ...c, lines: { ...c.lines, [id]: c.lines[id] ? c.lines[id] : qty } })), [])
  const replaceLines = useCallback((lines: Record<string, number>) => setCart(c => ({ ...c, lines })), [])
  const setType = useCallback((type: OrderType) => setCart(c => ({ ...c, type })), [])
  const setEvent = useCallback((patch: Partial<Pick<CartState, 'eventName' | 'eventDate'>>) => setCart(c => ({ ...c, ...patch })), [])
  const addAdhoc = useCallback(() => setCart(c => ({ ...c, adhoc: [...c.adhoc, { key: Math.random().toString(36).slice(2), name: '', qty: 1, unit: '' }] })), [])
  const patchAdhoc = useCallback((k: string, patch: Partial<AdhocLine>) => setCart(c => ({ ...c, adhoc: c.adhoc.map(a => a.key === k ? { ...a, ...patch } : a) })), [])
  const removeAdhoc = useCallback((k: string) => setCart(c => ({ ...c, adhoc: c.adhoc.filter(a => a.key !== k) })), [])
  const clear = useCallback(() => setCart(c => ({ ...EMPTY, type: c.type })), [])

  const count = Object.keys(cart.lines).length + cart.adhoc.filter(a => a.name.trim()).length
  return { cart, count, setQty, add, replaceLines, setType, setEvent, addAdhoc, patchAdhoc, removeAdhoc, clear }
}
export type Cart = ReturnType<typeof useCart>
