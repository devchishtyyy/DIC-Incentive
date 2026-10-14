/**
 * The incentive period is the 16th to the 15th, not a calendar month.
 *
 * Pinned here because the mistake is invisible: a period that quietly became a calendar
 * month still produces plausible scores, but it spans the wrong days and the 26-working-day
 * attendance divisor stops matching the period it divides. Everything below is about the
 * boundary, because that is the only place the two models differ.
 */

import { describe, expect, it } from 'vitest'
import { buildBaseState, buildDemoState } from '../data/seed'
import { periodWorkingDays, scorecard } from '../store/selectors'
import { applyWrite } from '../store/writes'
import { dateRange, isSunday } from './dates'
import {
  buildPeriod,
  clampStartDay,
  makePeriodId,
  MAX_START_DAY,
  parsePeriodId,
  periodBounds,
  periodIdFor,
  periodLabel,
  periodsEndingAt,
  restatePeriods,
  shiftPeriodId,
} from './periods'

const admin = { actorUserId: 'U-ADM', now: '2026-10-14T09:00:00.000Z' }

describe('period bounds', () => {
  it('runs the 16th to the 15th of the next month', () => {
    expect(periodBounds(2026, 9, 16)).toEqual({ startDate: '2026-09-16', endDate: '2026-10-15' })
  })

  it('crosses the new year', () => {
    expect(periodBounds(2026, 12, 16)).toEqual({ startDate: '2026-12-16', endDate: '2027-01-15' })
  })

  it('handles February without losing a day', () => {
    expect(periodBounds(2026, 1, 16)).toEqual({ startDate: '2026-01-16', endDate: '2026-02-15' })
    expect(periodBounds(2026, 2, 16)).toEqual({ startDate: '2026-02-16', endDate: '2026-03-15' })
  })

  it('handles a leap February', () => {
    expect(periodBounds(2028, 2, 16)).toEqual({ startDate: '2028-02-16', endDate: '2028-03-15' })
  })

  it('becomes a calendar month when the start day is 1', () => {
    expect(periodBounds(2026, 9, 1)).toEqual({ startDate: '2026-09-01', endDate: '2026-09-30' })
    expect(periodBounds(2026, 2, 1)).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' })
  })

  it('follows the 17th, which DIC has used', () => {
    expect(periodBounds(2026, 8, 17)).toEqual({ startDate: '2026-08-17', endDate: '2026-09-16' })
  })

  it('never leaves a gap or an overlap between consecutive periods', () => {
    for (const startDay of [1, 16, 17, 28]) {
      for (let month = 1; month <= 12; month += 1) {
        const current = periodBounds(2026, month, startDay)
        const next = periodBounds(month === 12 ? 2027 : 2026, month === 12 ? 1 : month + 1, startDay)
        expect(dateRange(current.endDate, next.startDate), `${startDay}/${month}`).toHaveLength(2)
      }
    }
  })
})

describe('the start day setting', () => {
  it('refuses a day February cannot honour', () => {
    expect(clampStartDay(31)).toBe(MAX_START_DAY)
    expect(clampStartDay(29)).toBe(MAX_START_DAY)
    expect(clampStartDay(0)).toBe(1)
    expect(clampStartDay(-5)).toBe(1)
  })

  it('falls back to the 16th rather than producing nonsense', () => {
    expect(clampStartDay(Number.NaN)).toBe(16)
  })

  it('takes a whole day only', () => {
    expect(clampStartDay(16.9)).toBe(16)
  })
})

describe('which period a date falls in', () => {
  it('puts the 15th in the period that began last month', () => {
    expect(periodIdFor('2026-10-15', 16)).toBe('2026-09')
  })

  it('puts the 16th in the period that begins today', () => {
    expect(periodIdFor('2026-10-16', 16)).toBe('2026-10')
  })

  it('steps back across a new year', () => {
    expect(periodIdFor('2027-01-15', 16)).toBe('2026-12')
    expect(periodIdFor('2027-01-16', 16)).toBe('2027-01')
  })

  it('agrees with the bounds it came from, every day of a year', () => {
    for (const startDay of [1, 16, 17]) {
      for (const date of dateRange('2026-01-01', '2026-12-31')) {
        const parsed = parsePeriodId(periodIdFor(date, startDay))!
        const bounds = periodBounds(parsed.year, parsed.month, startDay)
        expect(date >= bounds.startDate && date <= bounds.endDate, `${startDay} ${date}`).toBe(true)
      }
    }
  })
})

describe('period ids', () => {
  it('round-trips', () => {
    expect(parsePeriodId(makePeriodId(2026, 9))).toEqual({ year: 2026, month: 9 })
  })

  it('refuses something that is not a period id', () => {
    expect(parsePeriodId('2026-13')).toBeNull()
    expect(parsePeriodId('2026-09-16')).toBeNull()
    expect(parsePeriodId('nonsense')).toBeNull()
  })

  it('steps across year ends in both directions', () => {
    expect(shiftPeriodId('2026-12', 1)).toBe('2027-01')
    expect(shiftPeriodId('2026-01', -1)).toBe('2025-12')
    expect(shiftPeriodId('2026-06', -18)).toBe('2024-12')
  })
})

describe('labels', () => {
  it('names both months when they share a year', () => {
    expect(periodLabel('2026-09-16', '2026-10-15')).toBe('16 Sep – 15 Oct 2026')
  })

  it('names both years when the period crosses one', () => {
    expect(periodLabel('2026-12-16', '2027-01-15')).toBe('16 Dec 2026 – 15 Jan 2027')
  })
})

describe('generating a run of periods', () => {
  const periods = periodsEndingAt('2026-09', 4, 16)

  it('returns them oldest first', () => {
    expect(periods.map((p) => p.periodId)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09'])
  })

  it('starts every one of them on the 16th', () => {
    expect(periods.every((p) => p.startDate.endsWith('-16'))).toBe(true)
    expect(periods.every((p) => p.endDate.endsWith('-15'))).toBe(true)
  })

  it('leaves each one ending the day before the next begins', () => {
    for (let i = 1; i < periods.length; i += 1) {
      expect(dateRange(periods[i - 1].endDate, periods[i].startDate)).toHaveLength(2)
    }
  })
})

describe('restating periods when the setting changes', () => {
  const original = periodsEndingAt('2026-09', 2, 17)
  const moved = restatePeriods(original, 16)

  it('moves the dates', () => {
    expect(moved[0].startDate).toBe('2026-08-16')
    expect(original[0].startDate).toBe('2026-08-17')
  })

  it('keeps the ids, so entries and approvals still point at the right period', () => {
    expect(moved.map((p) => p.periodId)).toEqual(original.map((p) => p.periodId))
  })

  it('keeps each status, so a Locked period is not quietly reopened', () => {
    const locked = restatePeriods([{ ...original[0], status: 'Locked' }], 16)
    expect(locked[0].status).toBe('Locked')
  })
})

describe('where the 26 comes from — and where it stops matching', () => {
  /**
   * The 26 is a *fixed* divisor, not a count of the period's working days. These two
   * agree in most months and come apart in February, and that difference is the whole
   * reason the brief fixes the denominator (section 8, decision 1) instead of computing it.
   *
   * Pinned so that nobody later "fixes" attendance to divide by the real working-day
   * count: in a 28-day period that would raise everybody's attendance marks.
   */
  function monSatDays(year: number, month: number): number {
    const { startDate, endDate } = periodBounds(year, month, 16)
    return dateRange(startDate, endDate).filter((date) => !isSunday(date)).length
  }

  it('gives 26 or 27 Mon–Sat days in a normal month', () => {
    for (const month of [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(monSatDays(2026, month), `month ${month}`).toBeGreaterThanOrEqual(26)
      expect(monSatDays(2026, month), `month ${month}`).toBeLessThanOrEqual(27)
    }
  })

  it('gives fewer across February, because 16 Feb to 15 Mar is only 28 days', () => {
    expect(monSatDays(2026, 2)).toBe(24)
  })

  it('still only ever gives a leap February 24 or 25', () => {
    expect(monSatDays(2028, 2)).toBeGreaterThanOrEqual(24)
    expect(monSatDays(2028, 2)).toBeLessThanOrEqual(25)
  })
})

describe('buildPeriod', () => {
  it('builds a whole period from its id', () => {
    expect(buildPeriod('2026-09', 16)).toEqual({
      periodId: '2026-09',
      label: '16 Sep – 15 Oct 2026',
      startDate: '2026-09-16',
      endDate: '2026-10-15',
      status: 'Open',
    })
  })

  it('returns null for an id that is not one', () => {
    expect(buildPeriod('2026-99', 16)).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('changing the start day moves the periods with it', () => {
  const base = buildBaseState()

  it('restates every period', () => {
    const result = applyWrite(base, { kind: 'settings.update', patch: { periodStartDay: 17 } }, admin)
    expect(result.state.periods.every((p) => p.startDate.endsWith('-17'))).toBe(true)
    expect(result.state.periods.every((p) => p.endDate.endsWith('-16'))).toBe(true)
  })

  it('keeps the ids, so entries and approvals still find their period', () => {
    const result = applyWrite(base, { kind: 'settings.update', patch: { periodStartDay: 17 } }, admin)
    expect(result.state.periods.map((p) => p.periodId)).toEqual(base.periods.map((p) => p.periodId))
  })

  it('keeps a Locked period locked', () => {
    const result = applyWrite(base, { kind: 'settings.update', patch: { periodStartDay: 17 } }, admin)
    expect(result.state.periods.map((p) => p.status)).toEqual(base.periods.map((p) => p.status))
  })

  it('audits the setting and every period it moved', () => {
    const result = applyWrite(base, { kind: 'settings.update', patch: { periodStartDay: 17 } }, admin)
    expect(result.logs.filter((log) => log.entity === 'Settings')).toHaveLength(1)
    expect(result.logs.filter((log) => log.entity === 'MonthPeriod')).toHaveLength(base.periods.length)
  })

  it('leaves the periods alone when another setting changes', () => {
    const result = applyWrite(base, { kind: 'settings.update', patch: { bandLow: 11 } }, admin)
    expect(result.state.periods).toBe(base.periods)
  })

  it('ships with every period starting on the 16th', () => {
    expect(base.settings.periodStartDay).toBe(16)
    expect(base.periods.every((p) => p.startDate.endsWith('-16'))).toBe(true)
  })
})

describe('scoring across a month boundary', () => {
  const demo = buildDemoState()
  const period = demo.periods.find((p) => p.periodId === '2026-08')!

  it('covers both months, not one', () => {
    const dates = periodWorkingDays(demo, period)
    expect(period.startDate).toBe('2026-08-16')
    expect(period.endDate).toBe('2026-09-15')
    expect(dates.some((d) => d.startsWith('2026-08'))).toBe(true)
    expect(dates.some((d) => d.startsWith('2026-09'))).toBe(true)
  })

  it('scores the days on both sides of the boundary', () => {
    const { dates, rows } = scorecard(demo, '2026-08')
    const august = dates.filter((d) => d.startsWith('2026-08'))
    const september = dates.filter((d) => d.startsWith('2026-09'))
    expect(august.length).toBeGreaterThan(0)
    expect(september.length).toBeGreaterThan(0)

    const scoredInAugust = rows.some((row) => august.some((d) => row.byDate.get(d) !== undefined))
    const scoredInSeptember = rows.some((row) => september.some((d) => row.byDate.get(d) !== undefined))
    expect(scoredInAugust).toBe(true)
    expect(scoredInSeptember).toBe(true)
  })

  it('never produces a NaN total across the boundary', () => {
    const { rows } = scorecard(demo, '2026-08')
    expect(rows.every((row) => row.total === null || Number.isFinite(row.total))).toBe(true)
  })

  it('takes no entry from outside the period', () => {
    const { dates } = scorecard(demo, '2026-08')
    expect(dates.every((d) => d >= period.startDate && d <= period.endDate)).toBe(true)
  })
})
