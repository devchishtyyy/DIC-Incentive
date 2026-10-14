/**
 * The Production / Output KPI maths — pure, dependency-free, and the ONLY place it lives.
 * The UI, the export and the tests all call these functions; nothing re-implements them.
 *
 *   Daily Score            = min(Output Batch ÷ Daily Target × 20, 20)
 *   Employee-day score     = average of that employee's entry scores on that date
 *   Monthly Production Score = average of employee-day scores over days that have a score
 *
 * Every function returns `null` rather than NaN or Infinity when the inputs cannot be
 * scored, so a zero or blank target can never reach a division.
 */

import { DEFAULT_SETTINGS, type AppSettings } from '../config/policy'
import type { DailyEntry, DayCalendarEntry, Employee, EmployeeDayScore, IsoDate, Point } from './types'

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

/** Half-up rounding that is not thrown off by binary floating point (1.005 → 1.01). */
export function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON * Math.sign(value || 1)) * factor) / factor
}

function isUsableNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

// ---------------------------------------------------------------------------
// Core score
// ---------------------------------------------------------------------------

/**
 * Output Batch ÷ Daily Target, as a fraction (1.1875 for 4.75 against 4).
 * Null when the target is blank, zero or negative — the division never happens.
 */
export function calcPercent(target: number | null | undefined, actual: number | null | undefined): number | null {
  if (!isUsableNumber(target) || target <= 0) return null
  if (!isUsableNumber(actual) || actual < 0) return null
  return actual / target
}

/**
 * Daily Score = min(percent × cap, cap). Capped at 20 marks — never 23.75.
 * Null when the row cannot be scored.
 */
export function calcScore(
  target: number | null | undefined,
  actual: number | null | undefined,
  settings: AppSettings = DEFAULT_SETTINGS,
): number | null {
  const percent = calcPercent(target, actual)
  if (percent === null) return null
  return Math.min(percent * settings.scoreCap, settings.scoreCap)
}

/** The score for one row, honouring a HOD full-marks override. */
export function entryScore(entry: DailyEntry, settings: AppSettings = DEFAULT_SETTINGS): number | null {
  if (isUsableNumber(entry.scoreOverride)) {
    return Math.min(Math.max(entry.scoreOverride, 0), settings.scoreCap)
  }
  return calcScore(entry.target, entry.actualBatches, settings)
}

/** The percentage for one row. Shown even when the score is capped (118.8% → score 20). */
export function entryPercent(entry: DailyEntry): number | null {
  return calcPercent(entry.target, entry.actualBatches)
}

/** A row counts toward the scorecard only when it has a point, a usable target and an actual. */
export function isScorable(entry: DailyEntry, settings: AppSettings = DEFAULT_SETTINGS): boolean {
  return entry.pointId !== null && entryScore(entry, settings) !== null
}

// ---------------------------------------------------------------------------
// Employee-day
// ---------------------------------------------------------------------------

/**
 * Employee-day score, as the Excel scorecard does it with AVERAGEIFS: the plain average
 * of that employee's rows for the date. Null when no row on the date can be scored —
 * a missing day is never a zero.
 *
 * `settings.multiRowWeighting = 'targetWeighted'` switches to weighting each row by its
 * Daily Target (open policy question 1).
 */
export function calcEmployeeDay(
  entries: DailyEntry[],
  settings: AppSettings = DEFAULT_SETTINGS,
): number | null {
  const scored = entries
    .map((entry) => ({ score: entryScore(entry, settings), target: entry.target }))
    .filter((row): row is { score: number; target: number | null } => row.score !== null)

  if (scored.length === 0) return null

  if (settings.multiRowWeighting === 'targetWeighted') {
    const weightTotal = scored.reduce((sum, row) => sum + (isUsableNumber(row.target) ? row.target : 0), 0)
    if (weightTotal > 0) {
      const weighted = scored.reduce(
        (sum, row) => sum + row.score * (isUsableNumber(row.target) ? row.target : 0),
        0,
      )
      return weighted / weightTotal
    }
  }

  return scored.reduce((sum, row) => sum + row.score, 0) / scored.length
}

/** Groups a flat list of entries into employee-day scores. */
export function calcEmployeeDayScores(
  entries: DailyEntry[],
  settings: AppSettings = DEFAULT_SETTINGS,
): EmployeeDayScore[] {
  const buckets = new Map<string, DailyEntry[]>()
  for (const entry of entries) {
    const key = `${entry.empId}|${entry.date}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }

  const out: EmployeeDayScore[] = []
  for (const [key, bucket] of buckets) {
    const [empIdRaw, date] = key.split('|')
    out.push({
      empId: Number(empIdRaw),
      date,
      score: calcEmployeeDay(bucket, settings),
      entryCount: bucket.length,
    })
  }
  return out.sort((a, b) => a.empId - b.empId || a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// Monthly
// ---------------------------------------------------------------------------

/**
 * Monthly Production Score = average of the employee-day scores over days that have a
 * score. Kept unrounded; round only for display.
 *
 * `settings.monthlyDivisor = 'workingDays'` averages over `workingDayCount` instead,
 * treating an unscored working day as zero (open policy question 2).
 */
export function calcMonthly(
  dayScores: Array<number | null>,
  settings: AppSettings = DEFAULT_SETTINGS,
  workingDayCount?: number,
): number | null {
  const scored = dayScores.filter((score): score is number => score !== null && Number.isFinite(score))
  if (scored.length === 0) return null

  const total = scored.reduce((sum, score) => sum + score, 0)

  if (settings.monthlyDivisor === 'workingDays' && isUsableNumber(workingDayCount) && workingDayCount > 0) {
    return total / workingDayCount
  }
  return total / scored.length
}

/** Convenience: entries for one employee over a period → their Production Score out of 20. */
export function calcMonthlyFromEntries(
  entries: DailyEntry[],
  settings: AppSettings = DEFAULT_SETTINGS,
  workingDayCount?: number,
): { score: number | null; daysScored: number } {
  const dayScores = calcEmployeeDayScores(entries, settings)
  const scored = dayScores.filter((day) => day.score !== null)
  return {
    score: calcMonthly(
      dayScores.map((day) => day.score),
      settings,
      workingDayCount,
    ),
    daysScored: scored.length,
  }
}

// ---------------------------------------------------------------------------
// Department
// ---------------------------------------------------------------------------

/**
 * The department's Production Score: the mean of its **measured** employees' period scores.
 *
 * Measured means the employee has a period score at all. Somebody with no production rows
 * contributes nothing here — including them as a zero would drag the average down and then
 * that same depressed average is what gets handed to them, which compounds the error.
 *
 * Null when nobody in the department was measured, never 0 — there is a real difference
 * between "the department averaged zero" and "there is nothing to average".
 */
export function departmentAverage(periodScores: ReadonlyArray<number | null>): number | null {
  const measured = periodScores.filter((score): score is number => isUsableNumber(score))
  if (measured.length === 0) return null
  return measured.reduce((sum, score) => sum + score, 0) / measured.length
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type IssueSeverity = 'error' | 'warning'

export interface ValidationIssue {
  code: string
  severity: IssueSeverity
  message: string
  /** Warnings clear with an explicit confirm click; errors never do. */
  acknowledgeable: boolean
  /** 'save' blocks even a draft; 'submit' lets the row be saved as a draft. */
  blocks: 'save' | 'submit'
}

export const ISSUE = {
  POINT_REQUIRED: 'POINT_REQUIRED',
  EMPLOYEE_REQUIRED: 'EMPLOYEE_REQUIRED',
  TARGET_INVALID: 'TARGET_INVALID',
  ACTUAL_NEGATIVE: 'ACTUAL_NEGATIVE',
  ACTUAL_PRECISION: 'ACTUAL_PRECISION',
  ACTUAL_MISSING: 'ACTUAL_MISSING',
  DUPLICATE_ROW: 'DUPLICATE_ROW',
  OUTLIER_ACTUAL: 'OUTLIER_ACTUAL',
  OUTLIER_TARGET: 'OUTLIER_TARGET',
  UNDER_TARGET_TYPO: 'UNDER_TARGET_TYPO',
  NON_WORKING_DAY: 'NON_WORKING_DAY',
  PENDING_MD_APPROVAL: 'PENDING_MD_APPROVAL',
  OUTSIDE_SERVICE_DATES: 'OUTSIDE_SERVICE_DATES',
} as const

export interface ValidationContext {
  /** Every row for the same date, used to spot duplicates. Includes the row being checked. */
  sameDateEntries: DailyEntry[]
  point: Point | null
  employee: Employee | null
  calendarDay: DayCalendarEntry | null
  settings: AppSettings
}

const MAX_BATCH_DECIMALS = 2

function decimalPlaces(value: number): number {
  if (Number.isInteger(value)) return 0
  const text = String(value)
  if (text.includes('e') || text.includes('E')) return MAX_BATCH_DECIMALS + 1
  return text.split('.')[1]?.length ?? 0
}

/**
 * Every rule from section 6 of the build brief, in one place.
 * Returns issues newest-caller-friendly: errors first, then warnings.
 */
export function validateEntry(entry: DailyEntry, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { settings } = ctx

  // --- Errors: these block Save -------------------------------------------
  if (!entry.pointId) {
    issues.push({
      code: ISSUE.POINT_REQUIRED,
      severity: 'error',
      message: 'Point is required. Pick a point from the list before saving this row.',
      acknowledgeable: false,
      blocks: 'save',
    })
  }

  if (!isUsableNumber(entry.empId)) {
    issues.push({
      code: ISSUE.EMPLOYEE_REQUIRED,
      severity: 'error',
      message: 'Employee is required. Pick the employee by Emp ID.',
      acknowledgeable: false,
      blocks: 'save',
    })
  }

  if (!isUsableNumber(entry.target) || entry.target <= 0) {
    issues.push({
      code: ISSUE.TARGET_INVALID,
      severity: 'error',
      message: 'Daily Target must be greater than zero. A blank or zero target cannot be scored.',
      acknowledgeable: false,
      blocks: 'save',
    })
  }

  if (isUsableNumber(entry.actualBatches)) {
    if (entry.actualBatches < 0) {
      issues.push({
        code: ISSUE.ACTUAL_NEGATIVE,
        severity: 'error',
        message: 'Output Batch cannot be negative.',
        acknowledgeable: false,
        blocks: 'save',
      })
    }
    if (decimalPlaces(entry.actualBatches) > MAX_BATCH_DECIMALS) {
      issues.push({
        code: ISSUE.ACTUAL_PRECISION,
        severity: 'error',
        message: `Output Batch allows at most ${MAX_BATCH_DECIMALS} decimals.`,
        acknowledgeable: false,
        blocks: 'save',
      })
    }
  } else {
    // Not a mistake — just not typed yet. It stops the day being submitted, nothing more.
    issues.push({
      code: ISSUE.ACTUAL_MISSING,
      severity: 'warning',
      message: 'Output Batch is not entered yet.',
      acknowledgeable: false,
      blocks: 'submit',
    })
  }

  // --- Warnings: these block Submit until confirmed ------------------------
  const duplicates = ctx.sameDateEntries.filter(
    (other) =>
      other.entryId !== entry.entryId &&
      other.empId === entry.empId &&
      other.pointId !== null &&
      other.pointId === entry.pointId,
  )
  if (duplicates.length > 0) {
    issues.push({
      code: ISSUE.DUPLICATE_ROW,
      severity: 'warning',
      message: `Possible duplicate — this employee already has a row on this point for this date (${duplicates.length + 1} rows). Merge them or confirm that both are real.`,
      acknowledgeable: true,
      blocks: 'submit',
    })
  }

  if (
    isUsableNumber(entry.target) &&
    entry.target > 0 &&
    isUsableNumber(entry.actualBatches) &&
    entry.actualBatches > entry.target * settings.outlierActualMultiple
  ) {
    issues.push({
      code: ISSUE.OUTLIER_ACTUAL,
      severity: 'warning',
      message: `Output Batch is more than ${settings.outlierActualMultiple}× the Daily Target — likely a typo. The score still caps at ${settings.scoreCap}. Confirm to keep it.`,
      acknowledgeable: true,
      blocks: 'submit',
    })
  }

  /*
   * Output far below target is usually a mistyped *target*, not a catastrophic day: a
   * target entered as 400 instead of 4 puts the row at 1% and scores it 0.2 out of 20.
   * Warn, never block — a genuinely terrible day is somebody's real number and the app
   * has no business refusing it.
   */
  if (
    isUsableNumber(entry.target) &&
    entry.target > 0 &&
    isUsableNumber(entry.actualBatches) &&
    entry.actualBatches > 0 &&
    entry.actualBatches < entry.target * settings.underTargetTypoFraction
  ) {
    issues.push({
      code: ISSUE.UNDER_TARGET_TYPO,
      severity: 'warning',
      message: `Output Batch is under ${Math.round(settings.underTargetTypoFraction * 100)}% of the Daily Target — check the target is not mistyped. Confirm to keep it.`,
      acknowledgeable: true,
      blocks: 'submit',
    })
  }

  if (
    ctx.point &&
    isUsableNumber(entry.target) &&
    entry.target > 0 &&
    entry.target < ctx.point.defaultTarget * settings.outlierTargetFraction
  ) {
    issues.push({
      code: ISSUE.OUTLIER_TARGET,
      severity: 'warning',
      message: `Daily Target is below ${Math.round(settings.outlierTargetFraction * 100)}% of this point's default of ${ctx.point.defaultTarget}. Confirm that this is intended.`,
      acknowledgeable: true,
      blocks: 'submit',
    })
  }

  if (ctx.calendarDay && !ctx.calendarDay.isWorkingDay) {
    issues.push({
      code: ISSUE.NON_WORKING_DAY,
      severity: 'warning',
      message: `${ctx.calendarDay.note || 'This date'} is not a working day. Confirm that production really ran.`,
      acknowledgeable: true,
      blocks: 'submit',
    })
  }

  if (ctx.employee?.incentiveListStatus === 'Pending MD approval') {
    issues.push({
      code: ISSUE.PENDING_MD_APPROVAL,
      severity: 'warning',
      message: 'This employee is still Pending MD approval and is excluded from the monthly roll-up.',
      acknowledgeable: true,
      blocks: 'submit',
    })
  }

  if (ctx.employee) {
    const beforeJoining = entry.date < ctx.employee.joinDate
    const afterLeaving = ctx.employee.leaveDate !== null && entry.date > ctx.employee.leaveDate
    if (beforeJoining || afterLeaving) {
      issues.push({
        code: ISSUE.OUTSIDE_SERVICE_DATES,
        severity: 'warning',
        message: beforeJoining
          ? 'This date is before the employee joined.'
          : 'This date is after the employee left.',
        acknowledgeable: true,
        blocks: 'submit',
      })
    }
  }

  return issues
}

/** Issues still standing once the row's acknowledged warnings are taken out. */
export function openIssues(entry: DailyEntry, issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => !(issue.acknowledgeable && entry.acknowledgedWarnings.includes(issue.code)))
}

export function blocksSave(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.blocks === 'save')
}

export function blocksSubmit(issues: ValidationIssue[]): boolean {
  return issues.length > 0
}

// ---------------------------------------------------------------------------
// Target rules
// ---------------------------------------------------------------------------

/**
 * The Daily Target in force for a point on a date: the most specific rule wins
 * (a dated rule beats the open-ended default). A DailyEntry copies this at creation,
 * so a later rule change never rewrites history.
 */
export function targetForDate<T extends TargetRuleLike>(rules: readonly T[], pointId: string, date: IsoDate): T | null {
  const applicable = rules.filter(
    (rule) =>
      rule.pointId === pointId &&
      rule.effectiveFrom <= date &&
      (rule.effectiveTo === null || rule.effectiveTo >= date),
  )
  if (applicable.length === 0) return null

  // A bounded rule (a specific day or range) is more specific than an open-ended default.
  return applicable.sort((a, b) => {
    const aBounded = a.effectiveTo !== null ? 1 : 0
    const bBounded = b.effectiveTo !== null ? 1 : 0
    if (aBounded !== bBounded) return bBounded - aBounded
    return b.effectiveFrom.localeCompare(a.effectiveFrom)
  })[0]
}

export interface TargetRuleLike {
  pointId: string
  effectiveFrom: IsoDate
  effectiveTo: IsoDate | null
  target: number
}
