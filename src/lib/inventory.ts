import { daysBetween, todayISO } from './dates'

export type ExpiryLevel = 'none' | 'ok' | 'soon' | 'today' | 'expired'

export function expiryInfo(expiresOn: string | null | undefined, today: string = todayISO()): { level: ExpiryLevel; days: number | null } {
  if (!expiresOn) return { level: 'none', days: null }
  const days = daysBetween(today, expiresOn)
  if (days < 0) return { level: 'expired', days }
  if (days === 0) return { level: 'today', days }
  if (days <= 7) return { level: 'soon', days }
  return { level: 'ok', days }
}

const RANK: Record<ExpiryLevel, number> = { none: 0, ok: 1, soon: 2, today: 3, expired: 4 }

/** The worst expiry state among a product's batches. */
export function worstExpiry(batches: { expires_on: string | null }[], today: string = todayISO()) {
  let worst: { level: ExpiryLevel; days: number | null } = { level: 'none', days: null }
  for (const b of batches) {
    const e = expiryInfo(b.expires_on, today)
    if (RANK[e.level] > RANK[worst.level] || (e.level === worst.level && e.days != null && worst.days != null && e.days < worst.days)) worst = e
  }
  return worst
}

/** Low stock: at or below the reorder level (default 1 when none is set). */
export function isLow(qty: number | string, reorder: number | string | null | undefined): boolean {
  const q = Number(qty)
  const t = reorder == null || reorder === '' ? 1 : Number(reorder)
  return q <= t
}

/** "12 × 500 g = 6 kg" style content total for items with a per-unit weight. */
export function contentTotal(qty: number | string, spec: { unit_weight?: number | null; weight_unit?: string | null }): string | null {
  const w = Number(spec.unit_weight)
  const q = Number(qty)
  if (!w || !q) return null
  if (spec.weight_unit === 'pcs') {
    const total = w * q
    return `${Number.isInteger(total) ? total : total.toFixed(1)} pcs`
  }
  const grams = w * q * (spec.weight_unit === 'kg' ? 1000 : 1)
  return grams >= 1000 ? `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 2)} kg` : `${Math.round(grams)} g`
}
