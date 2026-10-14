import { describe, expect, it } from 'vitest'
import {
  blocksSave,
  calcEmployeeDay,
  calcMonthly,
  calcPercent,
  calcScore,
  entryScore,
  ISSUE,
  round,
  targetForDate,
  validateEntry,
  type ValidationContext,
} from './calc'
import { DEFAULT_SETTINGS } from '../config/policy'
import type { DailyEntry, Point } from './types'

function entry(partial: Partial<DailyEntry>): DailyEntry {
  return {
    entryId: 'E1',
    periodId: '2026-08',
    date: '2026-08-17',
    empId: 1001,
    pointId: 'PT-DISPERSION',
    target: 4,
    actualBatches: 4,
    scoreOverride: null,
    overrideReason: null,
    acknowledgedWarnings: [],
    status: 'Draft',
    enteredBy: 'U-OE1',
    enteredAt: '2026-08-17T06:00:00.000Z',
    updatedBy: null,
    updatedAt: null,
    ...partial,
  }
}

const point: Point = {
  pointId: 'PT-DISPERSION',
  name: 'Dispersion',
  defaultTarget: 4,
  defaultTargetSet: true,
  active: true,
}

function ctx(partial: Partial<ValidationContext> = {}): ValidationContext {
  return {
    sameDateEntries: [],
    point,
    employee: null,
    calendarDay: { date: '2026-08-17', isWorkingDay: true, note: '' },
    settings: DEFAULT_SETTINGS,
    ...partial,
  }
}

// ---------------------------------------------------------------------------
// Acceptance tests 1–6 from section 9 of the build brief
// ---------------------------------------------------------------------------

describe('acceptance test 1 — target 4, actual 4.75', () => {
  it('shows 118.8% and caps the score at 20.00, never 23.75', () => {
    expect(round(calcPercent(4, 4.75)! * 100, 1)).toBe(118.8)
    expect(round(calcScore(4, 4.75)!, 2)).toBe(20)
  })
})

describe('acceptance test 2 — target 3, actual 2.5', () => {
  it('shows 83.3% and scores 16.67', () => {
    expect(round(calcPercent(3, 2.5)! * 100, 1)).toBe(83.3)
    expect(round(calcScore(3, 2.5)!, 2)).toBe(16.67)
  })
})

describe('acceptance test 3 — target 5, actual 3', () => {
  it('shows 60.0% and scores 12.00', () => {
    expect(round(calcPercent(5, 3)! * 100, 1)).toBe(60)
    expect(round(calcScore(5, 3)!, 2)).toBe(12)
  })
})

describe('acceptance test 4 — target 0 or blank', () => {
  it('never produces NaN or Infinity', () => {
    for (const target of [0, null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(calcPercent(target, 5)).toBeNull()
      expect(calcScore(target, 5)).toBeNull()
    }
  })

  it('blocks Save with a message', () => {
    const issues = validateEntry(entry({ target: 0 }), ctx())
    expect(blocksSave(issues)).toBe(true)
    expect(issues.find((i) => i.code === ISSUE.TARGET_INVALID)?.message).toMatch(/greater than zero/)
  })
})

describe('acceptance test 5 — one employee, two points in a day', () => {
  it('averages 20 and 10 to a day score of 15.00', () => {
    const rows = [
      entry({ entryId: 'A', pointId: 'PT-A', target: 4, actualBatches: 4 }), // 20
      entry({ entryId: 'B', pointId: 'PT-B', target: 4, actualBatches: 2 }), // 10
    ]
    expect(round(calcEmployeeDay(rows)!, 2)).toBe(15)
  })
})

describe('acceptance test 6 — day scores 20, 20 and 10', () => {
  it('gives a Monthly Production Score of 16.67', () => {
    expect(round(calcMonthly([20, 20, 10])!, 2)).toBe(16.67)
  })
})

// ---------------------------------------------------------------------------
// Scoring rules
// ---------------------------------------------------------------------------

describe('calcScore', () => {
  it('caps at the policy maximum of 20 however far output runs ahead', () => {
    expect(calcScore(1, 19)).toBe(20)
    expect(calcScore(4, 100)).toBe(20)
  })

  it('scales linearly below target', () => {
    expect(calcScore(10, 5)).toBe(10)
    expect(calcScore(10, 0)).toBe(0)
  })

  it('rejects a negative output batch', () => {
    expect(calcScore(4, -1)).toBeNull()
  })

  it('handles the fractional batches the Excel contains', () => {
    expect(round(calcScore(3, 2.33)!, 2)).toBe(15.53)
    expect(round(calcScore(3, 3.34)!, 2)).toBe(20)
  })
})

describe('entryScore', () => {
  it('uses a HOD full-marks override in place of the computed score', () => {
    const row = entry({ target: 10, actualBatches: 2, scoreOverride: 20, overrideReason: 'Extraordinary performance' })
    expect(entryScore(row)).toBe(20)
  })

  it('still caps an override at 20', () => {
    expect(entryScore(entry({ scoreOverride: 50 }))).toBe(20)
  })
})

describe('calcEmployeeDay', () => {
  it('returns null when nothing on the day can be scored — a missing day is not a zero', () => {
    expect(calcEmployeeDay([])).toBeNull()
    expect(calcEmployeeDay([entry({ actualBatches: null })])).toBeNull()
  })

  it('ignores unscorable rows and averages the rest', () => {
    const rows = [entry({ entryId: 'A', target: 4, actualBatches: 4 }), entry({ entryId: 'B', actualBatches: null })]
    expect(calcEmployeeDay(rows)).toBe(20)
  })

  it('can weight by target when the assumption is switched', () => {
    const rows = [
      entry({ entryId: 'A', pointId: 'PT-A', target: 10, actualBatches: 10 }), // 20, weight 10
      entry({ entryId: 'B', pointId: 'PT-B', target: 2, actualBatches: 1 }), //  10, weight 2
    ]
    expect(round(calcEmployeeDay(rows, DEFAULT_SETTINGS)!, 2)).toBe(15)
    expect(
      round(calcEmployeeDay(rows, { ...DEFAULT_SETTINGS, multiRowWeighting: 'targetWeighted' })!, 2),
    ).toBe(18.33)
  })
})

describe('calcMonthly', () => {
  it('averages over days scored, not over the 26 working days', () => {
    expect(calcMonthly([20, 20, null, null])).toBe(20)
  })

  it('can average over working days when the assumption is switched', () => {
    const over26 = calcMonthly([20, 20, null], { ...DEFAULT_SETTINGS, monthlyDivisor: 'workingDays' }, 26)
    expect(round(over26!, 2)).toBe(1.54)
  })

  it('returns null for an employee with no scored day', () => {
    expect(calcMonthly([null, null])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Validation (section 6 edge cases from the real Excel)
// ---------------------------------------------------------------------------

describe('validateEntry', () => {
  it('blocks Save on a blank point', () => {
    const issues = validateEntry(entry({ pointId: null }), ctx())
    expect(issues.some((i) => i.code === ISSUE.POINT_REQUIRED && i.blocks === 'save')).toBe(true)
  })

  it('acceptance test 14 — warns on a duplicate employee, point and day', () => {
    const a = entry({ entryId: 'A' })
    const b = entry({ entryId: 'B' })
    const issues = validateEntry(a, ctx({ sameDateEntries: [a, b] }))
    const duplicate = issues.find((i) => i.code === ISSUE.DUPLICATE_ROW)
    expect(duplicate?.blocks).toBe('submit')
    expect(duplicate?.acknowledgeable).toBe(true)
  })

  it('does not call two different points on the same day a duplicate', () => {
    const a = entry({ entryId: 'A', pointId: 'PT-A' })
    const b = entry({ entryId: 'B', pointId: 'PT-B' })
    const issues = validateEntry(a, ctx({ sameDateEntries: [a, b] }))
    expect(issues.some((i) => i.code === ISSUE.DUPLICATE_ROW)).toBe(false)
  })

  it('warns on the target-1 actual-19 outlier but still allows a confirmed save', () => {
    const issues = validateEntry(entry({ target: 1, actualBatches: 19 }), ctx())
    const outlier = issues.find((i) => i.code === ISSUE.OUTLIER_ACTUAL)
    expect(outlier?.severity).toBe('warning')
    expect(blocksSave(issues)).toBe(false)
  })

  it('warns when the day target falls well below the point default', () => {
    const issues = validateEntry(entry({ target: 0.5, actualBatches: 0.5 }), ctx())
    expect(issues.some((i) => i.code === ISSUE.OUTLIER_TARGET)).toBe(true)
  })

  it('rejects more than two decimals on the output batch', () => {
    const issues = validateEntry(entry({ actualBatches: 2.333 }), ctx())
    expect(issues.some((i) => i.code === ISSUE.ACTUAL_PRECISION && i.blocks === 'save')).toBe(true)
  })

  it('allows the fractional batches the Excel really contains', () => {
    for (const actual of [2.33, 2.66, 3.34, 1.33]) {
      const issues = validateEntry(entry({ actualBatches: actual }), ctx())
      expect(blocksSave(issues)).toBe(false)
    }
  })

  it('lets a row without an actual be saved as a draft but not submitted', () => {
    const issues = validateEntry(entry({ actualBatches: null }), ctx())
    const missing = issues.find((i) => i.code === ISSUE.ACTUAL_MISSING)
    expect(missing?.blocks).toBe('submit')
    expect(blocksSave(issues)).toBe(false)
  })

  it('asks for a confirm on a non-working day', () => {
    const issues = validateEntry(
      entry({ date: '2026-08-23' }),
      ctx({ calendarDay: { date: '2026-08-23', isWorkingDay: false, note: 'Sunday' } }),
    )
    expect(issues.some((i) => i.code === ISSUE.NON_WORKING_DAY)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Target rules
// ---------------------------------------------------------------------------

describe('targetForDate', () => {
  const rules = [
    { pointId: 'PT-A', effectiveFrom: '2026-01-01', effectiveTo: null, target: 4 },
    { pointId: 'PT-A', effectiveFrom: '2026-08-25', effectiveTo: '2026-08-25', target: 2 },
  ]

  it('uses the open-ended default on an ordinary day', () => {
    expect(targetForDate(rules, 'PT-A', '2026-08-24')?.target).toBe(4)
  })

  it('prefers a dated rule — the stock-taking day the HOD changed', () => {
    expect(targetForDate(rules, 'PT-A', '2026-08-25')?.target).toBe(2)
  })

  it('returns null for a point with no rule', () => {
    expect(targetForDate(rules, 'PT-Z', '2026-08-24')).toBeNull()
  })
})
