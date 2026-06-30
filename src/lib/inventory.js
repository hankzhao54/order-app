// Pure helpers for the Inventory page: expiry/low-stock classification and
// weight formatting. Kept free of React/Supabase so they're testable.

const DAY = 86400000

export function expiryState(expires_on) {
  if (!expires_on) return { cls: '', label: '' }
  const days = Math.floor((new Date(expires_on + 'T00:00:00') - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')) / DAY)
  if (days < 0) return { cls: 'expired', label: `expired ${-days}d ago` }
  if (days === 0) return { cls: 'expsoon', label: 'today' }
  if (days <= 7) return { cls: 'expsoon', label: `${days}d left` }
  return { cls: '', label: `${days}d left` }
}

// earliest-expiring batch state for a row
export function rowExpiry(batches) {
  let worst = { cls: '', label: '' }
  for (const b of batches || []) {
    const s = expiryState(b.expires_on)
    if (s.cls === 'expired') return s
    if (s.cls === 'expsoon') worst = s
  }
  return worst
}

export function isLow(qty, reorder) {
  const q = Number(qty)
  const t = reorder == null || reorder === '' ? 1 : Number(reorder)
  return q <= t
}

export function fmtTotal(qty, i) {
  const w = Number(i.unit_weight)
  if (!w || !Number(qty)) return null
  // pcs: count pieces instead of weight
  if (i.weight_unit === 'pcs') {
    const total = w * Number(qty)
    return `${total % 1 === 0 ? total : total.toFixed(1)} pcs`
  }
  const grams = w * Number(qty) * (i.weight_unit === 'kg' ? 1000 : 1)
  return grams >= 1000 ? `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 2)} kg` : `${Math.round(grams)} g`
}
