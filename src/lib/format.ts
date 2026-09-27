import { BUSINESS_TZ } from './dates'

let currentLocale = 'en-GB'
export function setFormatLocale(lang: string) {
  currentLocale = lang === 'hu' ? 'hu-HU' : lang === 'zh' ? 'zh-CN' : 'en-GB'
}

export function num(n: number | string | null | undefined): string {
  if (n == null || n === '') return ''
  const v = Number(n)
  if (!Number.isFinite(v)) return String(n)
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)
}

export function qtyUnit(q: number | string | null | undefined, unit?: string | null): string {
  const s = num(q)
  return unit ? `${s} ${unit}` : s
}

export function huf(n: number): string {
  return new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' Ft'
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00Z') : new Date(d)
  return new Intl.DateTimeFormat(currentLocale, { timeZone: BUSINESS_TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

export function fmtShortDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00Z') : new Date(d)
  return new Intl.DateTimeFormat(currentLocale, { timeZone: BUSINESS_TZ, day: 'numeric', month: 'short' }).format(date)
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat(currentLocale, {
    timeZone: BUSINESS_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(d))
}

export function fmtDuration(ms: number): string {
  const h = ms / 36e5
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${h.toFixed(1)} h`
  return `${(h / 24).toFixed(1)} d`
}

export function matches(haystack: Array<string | null | undefined>, needle: string): boolean {
  const n = needle.trim().toLowerCase()
  if (!n) return true
  return haystack.some(h => (h || '').toLowerCase().includes(n))
}
