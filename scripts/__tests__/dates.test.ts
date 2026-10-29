import { afterEach, describe, expect, it } from 'vitest'
import { todayIn } from '../lib/dates.ts'

describe('todayIn', () => {
  const machineTz = process.env.TZ
  afterEach(() => {
    if (machineTz === undefined) delete process.env.TZ
    else process.env.TZ = machineTz
  })

  it('gives the Chicago day, not the UTC day, in the evening in summer time', () => {
    expect(todayIn('America/Chicago', new Date('2026-06-16T03:30:00Z'))).toBe('2026-06-15')
  })

  it('uses the standard-time offset once summer time has ended', () => {
    expect(todayIn('America/Chicago', new Date('2026-11-02T05:30:00Z'))).toBe('2026-11-01')
  })

  it('ignores the machine timezone', () => {
    for (const tz of ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
      process.env.TZ = tz
      expect(todayIn('America/Chicago', new Date('2026-06-16T03:30:00Z'))).toBe('2026-06-15')
    }
  })

  it('writes Latin digits whatever the locale from identity.yaml formats numbers with', () => {
    expect(todayIn('America/Chicago', new Date('2026-06-16T03:30:00Z'), 'ar-EG')).toBe('2026-06-15')
  })

  it('writes a Gregorian year whatever calendar the locale defaults to', () => {
    expect(todayIn('Europe/London', new Date('2026-10-28T12:00:00Z'), 'th-TH')).toBe('2026-10-28')
  })

  it('throws on a locale that is not a language tag', () => {
    expect(() => todayIn('America/Chicago', new Date(), 'not a locale')).toThrow(RangeError)
  })

  it('throws on a name that is not a timezone', () => {
    expect(() => todayIn('Mars/Olympus', new Date())).toThrow(RangeError)
  })
})
