import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { expiryState, rowExpiry, isLow, fmtTotal } from './inventory'

// "today" is read via `new Date()` inside expiryState, so pin the clock to a
// fixed UTC instant — toISOString() is always UTC, which keeps the "today"
// string deterministic regardless of the machine's local timezone.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('expiryState', () => {
  it('returns blank state when there is no expiry date', () => {
    expect(expiryState(null)).toEqual({ cls: '', label: '' })
    expect(expiryState(undefined)).toEqual({ cls: '', label: '' })
    expect(expiryState('')).toEqual({ cls: '', label: '' })
  })

  it('flags a date one day before today as expired (boundary)', () => {
    expect(expiryState('2024-06-14')).toEqual({ cls: 'expired', label: 'expired 1d ago' })
  })

  it('flags a date several days in the past as expired', () => {
    expect(expiryState('2024-06-10')).toEqual({ cls: 'expired', label: 'expired 5d ago' })
  })

  it('labels today as "today" (boundary, not yet expired)', () => {
    expect(expiryState('2024-06-15')).toEqual({ cls: 'expsoon', label: 'today' })
  })

  it('flags tomorrow as expiring soon', () => {
    expect(expiryState('2024-06-16')).toEqual({ cls: 'expsoon', label: '1d left' })
  })

  it('flags exactly 7 days out as expiring soon (inclusive boundary)', () => {
    expect(expiryState('2024-06-22')).toEqual({ cls: 'expsoon', label: '7d left' })
  })

  it('treats 8 days out as normal (just past the boundary)', () => {
    expect(expiryState('2024-06-23')).toEqual({ cls: '', label: '8d left' })
  })
})

describe('rowExpiry', () => {
  it('returns blank for no batches', () => {
    expect(rowExpiry([])).toEqual({ cls: '', label: '' })
    expect(rowExpiry(undefined)).toEqual({ cls: '', label: '' })
  })

  it('returns blank (not the raw days-left label) when nothing is close to expiring', () => {
    expect(rowExpiry([{ expires_on: '2024-08-01' }])).toEqual({ cls: '', label: '' })
  })

  it('surfaces the soon-to-expire batch when no batch is already expired', () => {
    const batches = [{ expires_on: '2024-08-01' }, { expires_on: '2024-06-17' }]
    expect(rowExpiry(batches)).toEqual({ cls: 'expsoon', label: '2d left' })
  })

  it('short-circuits to expired as soon as any batch is expired, ignoring later ones', () => {
    const batches = [{ expires_on: '2024-06-17' }, { expires_on: '2024-06-01' }, { expires_on: '2024-08-01' }]
    expect(rowExpiry(batches)).toEqual({ cls: 'expired', label: 'expired 14d ago' })
  })
})

describe('isLow', () => {
  it('is low when qty is exactly the reorder threshold (inclusive boundary)', () => {
    expect(isLow(5, 5)).toBe(true)
  })

  it('is not low when qty is just above the threshold', () => {
    expect(isLow(6, 5)).toBe(false)
  })

  it('is low when qty is just below the threshold', () => {
    expect(isLow(4, 5)).toBe(true)
  })

  it('defaults the threshold to 1 when reorder is null/undefined/empty string', () => {
    expect(isLow(1, null)).toBe(true)
    expect(isLow(1, undefined)).toBe(true)
    expect(isLow(1, '')).toBe(true)
    expect(isLow(2, null)).toBe(false)
  })

  it('coerces string quantities/thresholds to numbers', () => {
    expect(isLow('5', '5')).toBe(true)
    expect(isLow('6', '5')).toBe(false)
  })
})

describe('fmtTotal', () => {
  it('returns null when unit_weight is missing/zero', () => {
    expect(fmtTotal(3, { unit_weight: 0, weight_unit: 'kg' })).toBeNull()
    expect(fmtTotal(3, { unit_weight: null, weight_unit: 'kg' })).toBeNull()
  })

  it('returns null when qty is missing/zero', () => {
    expect(fmtTotal(0, { unit_weight: 2, weight_unit: 'kg' })).toBeNull()
    expect(fmtTotal(undefined, { unit_weight: 2, weight_unit: 'kg' })).toBeNull()
  })

  it('formats pcs as a whole count when the total is integral', () => {
    expect(fmtTotal(3, { unit_weight: 2, weight_unit: 'pcs' })).toBe('6 pcs')
  })

  it('formats pcs with one decimal when the total is fractional', () => {
    expect(fmtTotal(1, { unit_weight: 1.5, weight_unit: 'pcs' })).toBe('1.5 pcs')
  })

  it('formats kg-denominated items under 1000g as grams, rounded', () => {
    expect(fmtTotal(1, { unit_weight: 0.3, weight_unit: 'kg' })).toBe('300 g')
    expect(fmtTotal(2, { unit_weight: 0.333, weight_unit: 'kg' })).toBe('666 g')
  })

  it('formats kg-denominated items at exactly 1000g as a whole kg (boundary)', () => {
    expect(fmtTotal(2, { unit_weight: 0.5, weight_unit: 'kg' })).toBe('1 kg')
  })

  it('formats kg-denominated items over 1000g with 2 decimals when not a round number', () => {
    expect(fmtTotal(1, { unit_weight: 1.234, weight_unit: 'kg' })).toBe('1.23 kg')
  })

  it('treats a non-kg weight_unit (e.g. grams) as already being in grams', () => {
    expect(fmtTotal(1, { unit_weight: 500, weight_unit: 'g' })).toBe('500 g')
    expect(fmtTotal(2, { unit_weight: 600, weight_unit: 'g' })).toBe('1.20 kg')
  })
})
