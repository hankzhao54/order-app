import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, isCutoffPassed, minutesToCutoff, mondayOf, productionWeek, todayISO, zonedMidnightISO } from './dates'
import type { CutoffConfig } from './types'

const cfg: CutoffConfig = { enabled: true, weekday: 1, hour: 8, minute: 0, tz: 'Europe/Budapest' }
// 2026-09-28 is a Monday. Budapest is UTC+2 in September.
const at = (iso: string) => new Date(iso)

describe('dates', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('finds the Monday of a week', () => {
    expect(mondayOf('2026-09-28')).toBe('2026-09-28')
    expect(mondayOf('2026-10-04')).toBe('2026-09-28') // Sunday
    expect(mondayOf('2026-10-01')).toBe('2026-09-28')
  })
  it('uses the business timezone for "today"', () => {
    // 23:30 UTC on Sunday is already Monday 01:30 in Budapest
    expect(todayISO(at('2026-09-27T23:30:00Z'))).toBe('2026-09-28')
  })
  it('counts days between dates', () => {
    expect(daysBetween('2026-09-28', '2026-10-05')).toBe(7)
    expect(daysBetween('2026-09-28', '2026-09-27')).toBe(-1)
  })
  it('knows when the weekly cutoff has passed', () => {
    expect(isCutoffPassed(cfg, at('2026-09-28T05:59:00Z'))).toBe(false) // Mon 07:59 local
    expect(isCutoffPassed(cfg, at('2026-09-28T06:00:00Z'))).toBe(true) // Mon 08:00 local
    expect(isCutoffPassed({ ...cfg, enabled: false }, at('2026-10-02T12:00:00Z'))).toBe(false)
  })
  it('rolls the production week after the cutoff', () => {
    expect(productionWeek(cfg, at('2026-09-28T05:00:00Z'))).toBe('2026-09-28')
    expect(productionWeek(cfg, at('2026-09-29T10:00:00Z'))).toBe('2026-10-05')
    expect(productionWeek({ ...cfg, weekday: 4, hour: 12 }, at('2026-09-30T10:00:00Z'))).toBe('2026-09-28')
  })
  it('reports minutes left to cutoff', () => {
    expect(minutesToCutoff(cfg, at('2026-09-28T05:00:00Z'))).toBe(60)
    expect(minutesToCutoff(cfg, at('2026-09-28T07:00:00Z'))).toBe(0)
  })
  it('converts local midnight to UTC', () => {
    expect(zonedMidnightISO('2026-09-28')).toBe('2026-09-27T22:00:00.000Z') // CEST
    expect(zonedMidnightISO('2026-12-01')).toBe('2026-11-30T23:00:00.000Z') // CET
  })
})
