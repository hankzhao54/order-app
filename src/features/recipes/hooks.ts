import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { PrepEntry } from '@/lib/recipes'

export const RK = {
  list: ['recipes', 'list'] as const,
  one: (id: string) => ['recipes', 'one', id] as const,
  versions: (id: string) => ['recipes', 'versions', id] as const,
  cats: ['recipes', 'categories'] as const,
  favs: (uid: string | null) => ['recipes', 'favs', uid] as const,
  products: (id: string) => ['recipes', 'products', id] as const,
}

export const useRecipes = () => useQuery({ queryKey: RK.list, queryFn: api.listRecipes, staleTime: 60_000 })
export const useRecipeCategories = () => useQuery({ queryKey: RK.cats, queryFn: api.listRecipeCategories, staleTime: 5 * 60_000 })

export function useRecipeFavorites() {
  const { userId } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: RK.favs(userId), enabled: !!userId, queryFn: () => api.listRecipeFavorites(userId!) })
  const set = new Set(q.data ?? [])
  const toggle = useCallback(async (id: string) => {
    if (!userId) return
    const on = !(q.data ?? []).includes(id)
    qc.setQueryData<string[]>(RK.favs(userId), old => (on ? [...(old ?? []), id] : (old ?? []).filter(x => x !== id)))
    try { await api.setRecipeFavorite(userId, id, on) } catch { qc.invalidateQueries({ queryKey: RK.favs(userId) }) }
  }, [userId, q.data, qc])
  return { favs: set, toggle }
}

function useStored<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ } }, [key, v])
  return [v, setV] as const
}

/** Today's prep list: recipe ids with a batch multiplier, kept on this device. */
export function usePrepList() {
  const [list, setList] = useStored<PrepEntry[]>('recipes.prep.v1', [])
  const has = (id: string) => list.some(p => p.id === id)
  const toggle = (id: string, mult = 1) => setList(l => (l.some(p => p.id === id) ? l.filter(p => p.id !== id) : [...l, { id, mult }]))
  const setMult = (id: string, mult: number) => setList(l => l.map(p => (p.id === id ? { ...p, mult: Math.max(0.25, mult) } : p)))
  const clear = () => setList([])
  return { list, has, toggle, setMult, clear }
}

/** Recently opened recipes on this device, newest first. */
export function useRecent() {
  const [ids, setIds] = useStored<string[]>('recipes.recent.v1', [])
  const push = useCallback((id: string) => setIds(a => [id, ...a.filter(x => x !== id)].slice(0, 8)), [setIds])
  return { ids, push }
}
