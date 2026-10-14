/**
 * The department average, and the under-target warning.
 *
 * The department average matters more than it looks: from M2 it is also the score handed to
 * employees whose output is not measured, so an error here is paid twice — once to everyone
 * in the average, and again to everyone taking it as their own score.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../config/policy'
import { departmentAverage, ISSUE, validateEntry, type ValidationContext } from './calc'
import type { DailyEntry } from './types'

describe('the department average', () => {
  it('is the mean of the measured employees', () => {
    expect(departmentAverage([20, 10])).toBe(15)
  })

  it('ignores the unmeasured rather than counting them as zero', () => {
    // The difference that matters: with nulls as zeros this would be 7.5, not 15.
    expect(departmentAverage([20, 10, null, null])).toBe(15)
  })

  it('is null when nobody was measured — not zero', () => {
    expect(departmentAverage([null, null])).toBeNull()
    expect(departmentAverage([])).toBeNull()
  })

  it('counts a real zero, because that is a measurement', () => {
    expect(departmentAverage([20, 0])).toBe(10)
  })

  it('never returns NaN or Infinity, whatever it is handed', () => {
    for (const input of [[Number.NaN], [Number.POSITIVE_INFINITY], [Number.NaN, null], [Number.NEGATIVE_INFINITY, 10]]) {
      const result = departmentAverage(input)
      expect(result === null || Number.isFinite(result), JSON.stringify(input)).toBe(true)
    }
  })

  it('leaves a single measured employee as their own average', () => {
    expect(departmentAverage([13.75, null])).toBe(13.75)
  })

  it('stays unrounded, so rounding happens once at the edge', () => {
    expect(departmentAverage([20, 19, 19])).toBeCloseTo(19.333333333, 9)
  })
})

// ---------------------------------------------------------------------------

describe('output far below target', () => {
  const entry = (target: number, actual: number | null): DailyEntry => ({
    entryId: 'E-1',
    periodId: '2026-09',
    date: '2026-09-17',
    empId: 1295,
    pointId: 'P-01',
    target,
    actualBatches: actual,
    scoreOverride: null,
    overrideReason: null,
    acknowledgedWarnings: [],
    status: 'Draft',
    enteredBy: 'U-EXEC',
    enteredAt: '2026-09-17T09:00:00.000Z',
    updatedBy: null,
    updatedAt: null,
  })

  const ctx: ValidationContext = {
    sameDateEntries: [],
    point: null,
    employee: null,
    calendarDay: null,
    settings: DEFAULT_SETTINGS,
  }

  const codes = (target: number, actual: number | null) =>
    validateEntry(entry(target, actual), { ...ctx, sameDateEntries: [entry(target, actual)] }).map((issue) => issue.code)

  it('warns when output is under a tenth of target — usually the target was mistyped', () => {
    // A target typed as 400 instead of 4.
    expect(codes(400, 4)).toContain(ISSUE.UNDER_TARGET_TYPO)
  })

  it('does not warn on a merely bad day', () => {
    expect(codes(10, 5)).not.toContain(ISSUE.UNDER_TARGET_TYPO)
    expect(codes(10, 1)).not.toContain(ISSUE.UNDER_TARGET_TYPO)
  })

  it('warns, never blocks — a terrible day is still somebody’s real number', () => {
    const issues = validateEntry(entry(400, 4), { ...ctx, sameDateEntries: [entry(400, 4)] })
    const typo = issues.find((issue) => issue.code === ISSUE.UNDER_TARGET_TYPO)!
    expect(typo.severity).toBe('warning')
    expect(typo.blocks).toBe('submit')
    expect(typo.acknowledgeable).toBe(true)
  })

  it('says nothing about a genuine zero, which is a real result and not a typo', () => {
    expect(codes(10, 0)).not.toContain(ISSUE.UNDER_TARGET_TYPO)
  })

  it('says nothing when output has not been entered yet', () => {
    expect(codes(10, null)).not.toContain(ISSUE.UNDER_TARGET_TYPO)
    expect(codes(10, null)).toContain(ISSUE.ACTUAL_MISSING)
  })

  it('moves with the setting', () => {
    const loose = { ...ctx, settings: { ...DEFAULT_SETTINGS, underTargetTypoFraction: 0.6 } }
    const row = entry(10, 5)
    expect(validateEntry(row, { ...loose, sameDateEntries: [row] }).map((i) => i.code)).toContain(ISSUE.UNDER_TARGET_TYPO)
  })
})
