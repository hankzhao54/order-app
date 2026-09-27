import { useCallback, useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useFeedback } from '@/ui/feedback'

/**
 * Run a write, show errors as toasts, refresh the affected queries.
 * `busy` holds the id of the running action (or true) so a row can show its own spinner.
 */
export function useAction(invalidate: QueryKey[] = []) {
  const qc = useQueryClient()
  const fb = useFeedback()
  const [busy, setBusy] = useState<string | null>(null)

  const run = useCallback(async <T,>(fn: () => Promise<T>, opts: { id?: string; success?: string; also?: QueryKey[] } = {}): Promise<T | undefined> => {
    setBusy(opts.id ?? '*')
    try {
      const r = await fn()
      if (opts.success) fb.ok(opts.success)
      return r
    } catch (e) {
      fb.error(e)
      return undefined
    } finally {
      setBusy(null)
      for (const k of [...invalidate, ...(opts.also ?? [])]) qc.invalidateQueries({ queryKey: k })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, fb, JSON.stringify(invalidate)])

  return { run, busy, isBusy: (id?: string) => (id ? busy === id : busy !== null) }
}

/** Shared query keys. */
export const QK = {
  locations: ['locations'] as const,
  categories: ['categories'] as const,
  catalog: ['catalog'] as const,
  cutoff: ['cutoff'] as const,
  orders: ['orders'] as const,
  buy: ['buy'] as const,
  stock: ['stock'] as const,
  central: ['central-available'] as const,
  incoming: ['incoming'] as const,
  admin: ['admin'] as const,
}
