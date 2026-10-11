import { QueryClient, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useId, useRef } from 'react'
import { supabase } from './supabase'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => count < 2 && !(err as { code?: string })?.code?.startsWith?.('PGRST'),
    },
  },
})

export type RealtimeTable =
  | 'orders' | 'order_items' | 'procurement_tasks' | 'stock_batches' | 'stock_returns' | 'location_stock'

/**
 * Invalidate the given query keys whenever one of the tables changes on the
 * server (any client). Changes are debounced; while `paused` (e.g. the user
 * is mid-edit) they are held and applied when the pause ends.
 */
export function useLiveQueries(tables: RealtimeTable[], keys: QueryKey[], paused = false) {
  const qc = useQueryClient()
  const id = useId()
  const keysRef = useRef(keys)
  keysRef.current = keys
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flush = () => {
    pending.current = false
    for (const k of keysRef.current) qc.invalidateQueries({ queryKey: k })
  }

  useEffect(() => {
    if (!paused && pending.current) flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  const tableKey = tables.join(',')
  useEffect(() => {
    const channel = supabase.channel(`live-${tableKey}-${id}`)
    for (const table of tableKey.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'ordering', table }, () => {
        pending.current = true
        if (pausedRef.current) return
        clearTimeout(timer.current)
        timer.current = setTimeout(flush, 350)
      })
    }
    channel.subscribe()
    return () => { clearTimeout(timer.current); supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey, id])
}
