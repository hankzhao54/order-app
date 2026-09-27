import type { CutoffConfig } from './types'

// Everything date-ish is anchored to the business timezone, not the device's.
export const BUSINESS_TZ = 'Europe/Budapest'
const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

export const DEFAULT_CUTOFF: CutoffConfig = { enabled: true, weekday: 1, hour: 8, minute: 0, tz: BUSINESS_TZ }

interface ZonedParts { year: number; month: number; day: number; weekday: number; hour: number; minute: number }

export function zonedParts(now: Date = new Date(), tz = BUSINESS_TZ): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const p = Object.fromEntries(fmt.formatToParts(now).map(x => [x.type, x.value]))
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    weekday: WD[p.weekday] ?? 1, hour: Number(p.hour) % 24, minute: Number(p.minute),
  }
}

/** YYYY-MM-DD for a calendar date (no timezone math). */
export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z')
  return Math.round((b - a) / 86400000)
}

/** Today's date in the business timezone. */
export function todayISO(now: Date = new Date(), tz = BUSINESS_TZ): string {
  const p = zonedParts(now, tz)
  return isoDate(p.year, p.month, p.day)
}

/** Monday of the week containing `date` (YYYY-MM-DD). */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // 0 = Monday
  return addDays(date, -wd)
}

export function thisMonday(now: Date = new Date(), tz = BUSINESS_TZ): string {
  return mondayOf(todayISO(now, tz))
}

function minuteOfWeek(weekday: number, hour: number, minute: number) {
  return (weekday - 1) * 1440 + hour * 60 + minute
}

/** Has this week's ordering window closed? */
export function isCutoffPassed(cfg: CutoffConfig | null | undefined, now: Date = new Date()): boolean {
  if (!cfg || cfg.enabled === false) return false
  const p = zonedParts(now, cfg.tz || BUSINESS_TZ)
  return minuteOfWeek(p.weekday, p.hour, p.minute) >= minuteOfWeek(cfg.weekday, cfg.hour, cfg.minute)
}

/** Minutes left until this week's cutoff (0 when passed or disabled). */
export function minutesToCutoff(cfg: CutoffConfig | null | undefined, now: Date = new Date()): number {
  if (!cfg || cfg.enabled === false) return 0
  const p = zonedParts(now, cfg.tz || BUSINESS_TZ)
  return Math.max(0, minuteOfWeek(cfg.weekday, cfg.hour, cfg.minute) - minuteOfWeek(p.weekday, p.hour, p.minute))
}

/**
 * Monday (YYYY-MM-DD) of the production week a weekly order placed now belongs to.
 * At/after this week's cutoff it rolls to next week.
 */
export function productionWeek(cfg: CutoffConfig | null | undefined, now: Date = new Date()): string {
  const tz = cfg?.tz || BUSINESS_TZ
  const monday = thisMonday(now, tz)
  return isCutoffPassed(cfg, now) ? addDays(monday, 7) : monday
}

/** Start of the current week / month (business tz) as an ISO timestamp for range queries. */
export function rangeStartISO(kind: 'week' | 'month' | 'all', now: Date = new Date()): string | null {
  if (kind === 'all') return null
  const today = todayISO(now)
  const day = kind === 'week' ? mondayOf(today) : today.slice(0, 8) + '01'
  return zonedMidnightISO(day)
}

/** The instant of local midnight in the business tz for YYYY-MM-DD, as UTC ISO. */
export function zonedMidnightISO(date: string, tz = BUSINESS_TZ): string {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  // offset of tz at that instant
  const p = zonedParts(new Date(guess), tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  const offset = asUtc - guess
  return new Date(guess - offset).toISOString()
}
