import { supabase } from './supabase'

// Get current time parts in a given IANA timezone
function nowInTz(tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]))
  const wdMap = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { weekday: wdMap[parts.weekday], hour: Number(parts.hour), minute: Number(parts.minute) }
}

// Has this week's ordering window closed?
// Window closes at the configured weekday+time. Before that moment in the week → open.
// Simple rule: closed if now is AT/AFTER the cutoff weekday&time within the current week.
export function isCutoffPassed(cfg) {
  if (!cfg || cfg.enabled === false) return false
  const tz = cfg.tz || 'Europe/Budapest'
  const n = nowInTz(tz)
  const cutMin = (cfg.weekday ?? 1) * 1440 + (cfg.hour ?? 8) * 60 + (cfg.minute ?? 0)
  const nowMin = n.weekday * 1440 + n.hour * 60 + n.minute
  return nowMin >= cutMin
}

// Hours remaining until cutoff (if not passed). Rough, for display.
export function hoursToCutoff(cfg) {
  if (!cfg) return null
  const tz = cfg.tz || 'Europe/Budapest'
  const n = nowInTz(tz)
  const cutMin = (cfg.weekday ?? 1) * 1440 + (cfg.hour ?? 8) * 60 + (cfg.minute ?? 0)
  const nowMin = n.weekday * 1440 + n.hour * 60 + n.minute
  const diff = cutMin - nowMin
  return diff > 0 ? Math.round(diff / 60) : 0
}

export async function loadCutoff() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'order_cutoff').maybeSingle()
  return data?.value || { weekday: 1, hour: 8, minute: 0, tz: 'Europe/Budapest', enabled: true }
}

const WD = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' }
export function cutoffLabel(cfg) {
  if (!cfg || cfg.enabled === false) return 'No cutoff set'
  return `${WD[cfg.weekday] || 'Monday'} ${String(cfg.hour ?? 8).padStart(2, '0')}:${String(cfg.minute ?? 0).padStart(2, '0')}`
}

export function thisMonday(tz = 'Europe/Budapest') {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]))
  const wdMap = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const wd = wdMap[parts.weekday]
  const base = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00`)
  const monday = new Date(base); monday.setDate(base.getDate() - (wd - 1))
  return monday.toISOString().slice(0, 10)
}

// Monday (YYYY-MM-DD) of the production week a weekly order placed *now* belongs to.
// If now is at/after this week's cutoff, it rolls to next week's Monday.
export function productionWeek(cfg) {
  const tz = cfg?.tz || 'Europe/Budapest'
  // today's date parts in tz
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]))
  const wdMap = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const wd = wdMap[parts.weekday]
  // this week's Monday (local date)
  const base = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00`)
  const monday = new Date(base); monday.setDate(base.getDate() - (wd - 1))
  // if cutoff passed, roll to next Monday
  if (isCutoffPassed(cfg)) monday.setDate(monday.getDate() + 7)
  return monday.toISOString().slice(0, 10)
}
