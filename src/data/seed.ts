/**
 * The whole demo dataset, generated in code from a fixed seed so every load — and every
 * tester's machine — shows exactly the same numbers.
 *
 * The shape copies the real Aug–Sep 2026 Excel: ~780 rows, 35 employees, 26 working days,
 * with the messy patterns from section 6 of the build brief deliberately planted so a
 * tester can see each one without editing code.
 */

import { DEFAULT_SETTINGS } from '../config/policy'
import { round, targetForDate } from '../domain/calc'
import { dateRange, isSunday } from '../domain/dates'
import type {
  ApprovalStep,
  AppState,
  DirectoryEntry,
  Point,
  AuditLogEntry,
  DailyEntry,
  DayCalendarEntry,
  Employee,
  IsoDate,
  MonthOverride,
  MonthPeriod,
  PeriodStatus,
  TargetRule,
} from '../domain/types'
import { periodsEndingAt } from '../domain/periods'
import { POINT_ALIASES, POINTS, USERS } from './masters'
import { assignedPointIds, PLANT_ROSTER, SAP_EMP_ID_OFFSET } from './plantMasters'
import { DEMO_EMPLOYEES } from './demoRoster'
import { createRng } from './rng'
import { INITIAL_SYNC_STATE } from '../domain/syncSchedule'

export const SCHEMA_VERSION = 4
const SEED = 20260817

/** The four demo periods — one in each workflow state (seeded scenario 10). */
/**
 * Four periods, one in each workflow state, generated from the start-day setting rather
 * than written out by hand — so changing the setting moves every period together.
 *
 * The Aug period used to start on the 17th, which was open question 4 showing up as data.
 * The period rule is now settled at the 16th and these are generated from it.
 */
const PERIOD_STATUSES: PeriodStatus[] = ['Locked', 'HOD Signed', 'Submitted', 'Open']

export const PERIODS: MonthPeriod[] = periodsEndingAt('2026-09', 4, DEFAULT_SETTINGS.periodStartDay).map(
  (period, index) => ({ ...period, status: PERIOD_STATUSES[index] }),
)

/** The period the Excel actually covers, and the one the demo narrative centres on. */
export const MAIN_PERIOD_ID = '2026-08'
export const OPEN_PERIOD_ID = '2026-09'

/**
 * "Today" in the app. The open period runs up to and including today, so Daily Entry
 * opens on a live sheet the tester can type into straight away.
 */
const TODAY: IsoDate = '2026-10-01'

/** The period Daily Entry and the scorecard open on — the one that is still Open. */
export const DEFAULT_PERIOD_ID = OPEN_PERIOD_ID

/** Declared holidays on top of Sundays. Both are real Pakistani public holidays in 2026. */
const DECLARED_HOLIDAYS: Record<IsoDate, string> = {
  '2026-08-14': 'Independence Day',
  '2026-09-06': 'Defence Day (falls on a Sunday)',
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function buildCalendar(): DayCalendarEntry[] {
  return dateRange('2026-06-16', '2026-10-15').map((date) => {
    const holiday = DECLARED_HOLIDAYS[date]
    const sunday = isSunday(date)
    return {
      date,
      isWorkingDay: !sunday && !holiday,
      note: holiday ?? (sunday ? 'Sunday' : ''),
    }
  })
}

// ---------------------------------------------------------------------------
// Target rules
// ---------------------------------------------------------------------------

/**
 * One open-ended default per point, plus the dated changes a HOD made during the demo
 * periods. A DailyEntry copies the target in force at creation, so these never rewrite
 * history (seeded scenario 8).
 */
function buildTargetRules(points: Point[] = POINTS): TargetRule[] {
  const rules: TargetRule[] = points.map((point, index) => ({
    ruleId: `TR-DEF-${String(index + 1).padStart(3, '0')}`,
    pointId: point.pointId,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    target: point.defaultTarget,
    reason: 'Default',
    changedBy: 'U-ADM',
    changedAt: '2026-01-01T04:00:00.000Z',
  }))

  const dated: Array<Omit<TargetRule, 'ruleId'>> = [
    // Scenario 8 — stock-taking day across the wet end.
    { pointId: 'PT-DISPERSION', effectiveFrom: '2026-08-25', effectiveTo: '2026-08-25', target: 2, reason: 'Stock-taking day', changedBy: 'U-HOD', changedAt: '2026-08-24T10:15:00.000Z' },
    { pointId: 'PT-GRINDING', effectiveFrom: '2026-08-25', effectiveTo: '2026-08-25', target: 2, reason: 'Stock-taking day', changedBy: 'U-HOD', changedAt: '2026-08-24T10:16:00.000Z' },
    { pointId: 'PT-FILTRATION', effectiveFrom: '2026-08-25', effectiveTo: '2026-08-25', target: 3, reason: 'Stock-taking day', changedBy: 'U-HOD', changedAt: '2026-08-24T10:17:00.000Z' },
    // Machine downtime on the dispenser.
    { pointId: 'PT-P48', effectiveFrom: '2026-09-03', effectiveTo: '2026-09-03', target: 5, reason: 'Machine downtime', changedBy: 'U-HOD', changedAt: '2026-09-03T05:40:00.000Z' },
    // Order inflow lifts the UV line for three days in the open period.
    { pointId: 'PT-UV-FILLING', effectiveFrom: '2026-09-22', effectiveTo: '2026-09-24', target: 8, reason: 'Order inflow', changedBy: 'U-HOD', changedAt: '2026-09-21T11:05:00.000Z' },
  ]

  dated.forEach((rule, index) => {
    rules.push({ ruleId: `TR-CHG-${String(index + 1).padStart(3, '0')}`, ...rule })
  })

  return rules
}

// ---------------------------------------------------------------------------
// Performance profiles
// ---------------------------------------------------------------------------

/** Seeded scenario 1 — scores 20 every single day. */
const PERFECT_SCORER = 4101
/** Seeded scenario 2 — under target throughout, with a notably bad week. Averages ~15. */
const UNDER_TARGET = 4102
const UNDER_TARGET_BAD_WEEK = { from: '2026-08-24', to: '2026-08-29' }

const ATTENDANCE_RATE = 0.78

/**
 * How much of today's line has been written up so far. The rest is left for the tester to
 * add with the bulk "Add rows" dialog, which is the slowest part of the real job.
 */
const TODAY_POSTED_RATE = 0.72
const ATTENDANCE_OVERRIDES: Record<number, number> = {
  [PERFECT_SCORER]: 1,
  [UNDER_TARGET]: 0.96,
}

function performanceFactor(empId: number, date: IsoDate, rng: ReturnType<typeof createRng>): number {
  if (empId === PERFECT_SCORER) return rng.float(1.0, 1.3)

  if (empId === UNDER_TARGET) {
    return date >= UNDER_TARGET_BAD_WEEK.from && date <= UNDER_TARGET_BAD_WEEK.to
      ? rng.float(0.52, 0.6)
      : rng.float(0.76, 0.86)
  }

  const roll = rng.next()
  if (roll < 0.02) return rng.float(0.3, 0.5) // a few rows at 50% or less
  if (roll < 0.12) return rng.float(0.5, 0.9) // ~12% below target, scoring 10 to 18
  return rng.float(0.9, 1.4) // most days land between 90% and 140%
}

/** Batches carry up to 2 decimals, and often land on a round number, as in the real sheet. */
function batchesFor(target: number, factor: number): number {
  const raw = round(target * factor, 2)
  const nearest = Math.round(raw)
  return Math.abs(raw - nearest) < 0.08 && nearest > 0 ? nearest : Math.max(raw, 0)
}

// ---------------------------------------------------------------------------
// Entry generation
// ---------------------------------------------------------------------------

function isEligible(employee: Employee, date: IsoDate): boolean {
  if (!employee.active) return false
  if (employee.incentiveListStatus !== 'Approved') return false
  if (date < employee.joinDate) return false
  if (employee.leaveDate !== null && date > employee.leaveDate) return false
  return true
}

function entryStatusFor(periodId: string, date: IsoDate): DailyEntry['status'] {
  if (periodId === '2026-06') return 'Locked'
  if (periodId === OPEN_PERIOD_ID) return date <= '2026-09-26' ? 'Submitted' : 'Draft'
  return 'Submitted'
}

/**
 * Generates a period's worth of production rows for a roster. The planted scenarios from
 * section 8 of the build brief only make sense for the demo roster — they name specific
 * Emp IDs — so `withScenarios` is off when generating history for real imported staff.
 */
function buildEntries(
  calendar: DayCalendarEntry[],
  rules: TargetRule[],
  roster: Employee[],
  withScenarios: boolean,
  points: Point[] = POINTS,
): DailyEntry[] {
  const rng = createRng(SEED)
  const entries: DailyEntry[] = []
  let sequence = 0

  const workingDays = new Map(calendar.map((day) => [day.date, day.isWorkingDay]))
  // An employee works the Points they are assigned to; everyone else falls back to the
  // whole list so a roster with no assignment still produces something.
  const pointsFor = (employee: Employee): Point[] => {
    const own = points.filter((point) => employee.pointIds.includes(point.pointId))
    return own.length > 0 ? own : points
  }
  const primaryPoint = new Map<number, string>()
  roster.forEach((employee) => {
    const own = pointsFor(employee)
    if (own.length > 0) primaryPoint.set(employee.empId, own[0].pointId)
  })

  const makeEntry = (
    periodId: string,
    date: IsoDate,
    empId: number,
    pointId: string | null,
    target: number | null,
    actualBatches: number | null,
  ): DailyEntry => {
    sequence += 1
    const enteredBy = rng.chance(0.6) ? 'U-OE1' : 'U-OE2'
    return {
      entryId: `EN-${String(sequence).padStart(5, '0')}`,
      periodId,
      date,
      empId,
      pointId,
      target,
      actualBatches,
      scoreOverride: null,
      overrideReason: null,
      acknowledgedWarnings: [],
      status: entryStatusFor(periodId, date),
      enteredBy,
      enteredAt: `${date}T12:30:00.000Z`,
      updatedBy: null,
      updatedAt: null,
    }
  }

  const targetFor = (pointId: string, date: IsoDate): number => {
    const rule = targetForDate(rules, pointId, date)
    return rule?.target ?? points.find((p) => p.pointId === pointId)?.defaultTarget ?? 1
  }

  for (const period of PERIODS) {
    for (const date of dateRange(period.startDate, period.endDate)) {
      if (date > TODAY) break
      if (!workingDays.get(date)) continue

      // Today is the sheet in progress: most of the line is on it, some of the output is
      // typed, and the rest is still to be added and filled in by the Office Executive.
      const isToday = date === TODAY

      for (const employee of roster) {
        if (!isEligible(employee, date)) continue
        if (!primaryPoint.has(employee.empId)) continue // no points in their area

        const attendance = ATTENDANCE_OVERRIDES[employee.empId] ?? ATTENDANCE_RATE
        // On an ordinary day a missing row means absent. Today it just means "not posted yet".
        if (!rng.chance(isToday ? TODAY_POSTED_RATE : attendance)) continue

        const ownPoints = pointsFor(employee)
        const usePrimary = rng.chance(0.8)
        const pointId = usePrimary ? primaryPoint.get(employee.empId)! : rng.pick(ownPoints).pointId
        const target = targetFor(pointId, date)

        if (isToday) {
          const typedAlready = rng.chance(0.55)
          entries.push(
            makeEntry(period.periodId, date, employee.empId, pointId, target, typedAlready ? batchesFor(target, performanceFactor(employee.empId, date, rng)) : null),
          )
          continue
        }

        entries.push(
          makeEntry(period.periodId, date, employee.empId, pointId, target, batchesFor(target, performanceFactor(employee.empId, date, rng))),
        )

        // About 15% of employees work a second point in the same day.
        if (rng.chance(0.15)) {
          const second = rng.pick(ownPoints.filter((p) => p.pointId !== pointId))
          if (second) {
            const secondTarget = targetFor(second.pointId, date)
            entries.push(
              makeEntry(
                period.periodId,
                date,
                employee.empId,
                second.pointId,
                secondTarget,
                batchesFor(secondTarget, performanceFactor(employee.empId, date, rng)),
              ),
            )
          }
        }
      }
    }
  }

  return withScenarios ? applyScenarios(entries, sequence) : entries
}

// ---------------------------------------------------------------------------
// Planted scenarios (section 8 of the build brief)
// ---------------------------------------------------------------------------

function applyScenarios(generated: DailyEntry[], startSequence: number): DailyEntry[] {
  let sequence = startSequence
  const nextId = () => `EN-${String((sequence += 1)).padStart(5, '0')}`

  const plant = (partial: Partial<DailyEntry> & Pick<DailyEntry, 'periodId' | 'date' | 'empId'>): DailyEntry => ({
    entryId: nextId(),
    pointId: null,
    target: null,
    actualBatches: null,
    scoreOverride: null,
    overrideReason: null,
    acknowledgedWarnings: [],
    status: entryStatusFor(partial.periodId, partial.date),
    enteredBy: 'U-OE1',
    enteredAt: `${partial.date}T12:45:00.000Z`,
    updatedBy: null,
    updatedAt: null,
    ...partial,
  })

  let entries = generated

  // Scenario 9 — a block of people with no entries on a working day, so the dashboard
  // to-do and the month-end checklist both have something to flag.
  // Chosen clear of the employees the other scenarios plant rows for.
  const skippedOn29Sep = new Set(DEMO_EMPLOYEES.slice(20, 32).map((employee) => employee.empId))
  entries = entries.filter((entry) => !(entry.date === '2026-09-29' && skippedOn29Sep.has(entry.empId)))

  // Scenario 3 — output above target proves the cap: 4.75 against 4 is 118.8%, score 20.00.
  // Planted twice: once in the submitted Aug period, once live in the open period.
  const removeRowsFor = (empId: number, date: IsoDate) => {
    entries = entries.filter((entry) => !(entry.empId === empId && entry.date === date))
  }

  removeRowsFor(4103, '2026-08-19')
  entries.push(plant({ periodId: MAIN_PERIOD_ID, date: '2026-08-19', empId: 4103, pointId: 'PT-DISPERSION', target: 4, actualBatches: 4.75 }))

  removeRowsFor(4103, '2026-09-30')
  entries.push(plant({ periodId: OPEN_PERIOD_ID, date: '2026-09-30', empId: 4103, pointId: 'PT-DISPERSION', target: 4, actualBatches: 4.75 }))

  // Scenario 7 — one employee on two points in a day, scoring 20 and 10, so the day averages 15.00.
  removeRowsFor(4104, '2026-08-20')
  entries.push(plant({ periodId: MAIN_PERIOD_ID, date: '2026-08-20', empId: 4104, pointId: 'PT-FILTRATION', target: 4, actualBatches: 4 }))
  entries.push(plant({ periodId: MAIN_PERIOD_ID, date: '2026-08-20', empId: 4104, pointId: 'PT-PICCOLO', target: 4, actualBatches: 2 }))

  // Scenario 4 — the same employee, point and day entered twice. Warns, and blocks submit
  // until the Office Executive merges the rows or confirms that both are real.
  removeRowsFor(4105, '2026-09-28')
  entries.push(plant({ periodId: OPEN_PERIOD_ID, date: '2026-09-28', empId: 4105, pointId: 'PT-WEIGHING', target: 12, actualBatches: 11 }))
  entries.push(plant({ periodId: OPEN_PERIOD_ID, date: '2026-09-28', empId: 4105, pointId: 'PT-WEIGHING', target: 12, actualBatches: 11 }))

  // Scenario 5 — the outlier: target 1, output 19 (1,900%). Score still caps at 20.
  removeRowsFor(4106, '2026-09-29')
  entries.push(plant({ periodId: OPEN_PERIOD_ID, date: '2026-09-29', empId: 4106, pointId: 'PT-VARNISH-PLANT', target: 1, actualBatches: 19 }))

  // Scenario 6 — a blank point. Save is blocked until a point is chosen.
  removeRowsFor(4107, '2026-09-30')
  entries.push(plant({ periodId: OPEN_PERIOD_ID, date: '2026-09-30', empId: 4107, pointId: null, target: null, actualBatches: 3 }))

  // A HOD full-marks override on a single day (policy section 10).
  const overrideRow = entries.find((entry) => entry.empId === 4117 && entry.date === '2026-08-27')
  if (overrideRow) {
    overrideRow.scoreOverride = 20
    overrideRow.overrideReason = 'Extraordinary performance — recovered a failed batch within the same shift'
    overrideRow.updatedBy = 'U-HOD'
    overrideRow.updatedAt = '2026-08-27T14:10:00.000Z'
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.empId - b.empId || a.entryId.localeCompare(b.entryId))
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

/**
 * Seeded scenario 11 — the Aug period was submitted, returned by the HOD with a comment,
 * and resubmitted. It is still unsigned, so the HOD has a live action to test.
 */
function buildApprovals(): ApprovalStep[] {
  const steps: Array<Omit<ApprovalStep, 'stepId'>> = [
    // 2026-06 — fully approved and locked.
    { periodId: '2026-06', step: 'Submit', actorUserId: 'U-OE1', decision: 'Submitted', comment: 'All 26 working days entered.', timestamp: '2026-07-16T06:20:00.000Z' },
    { periodId: '2026-06', step: 'HOD', actorUserId: 'U-HOD', decision: 'Signed', comment: 'Checked against the batch register.', timestamp: '2026-07-17T05:10:00.000Z' },
    { periodId: '2026-06', step: 'Ops', actorUserId: 'U-OPS', decision: 'Approved', comment: 'Total marking reviewed. Released to Finance.', timestamp: '2026-07-18T06:00:00.000Z' },

    // 2026-07 — signed, waiting for the Operations Manager.
    { periodId: '2026-07', step: 'Submit', actorUserId: 'U-OE2', decision: 'Submitted', comment: '', timestamp: '2026-08-16T06:05:00.000Z' },
    { periodId: '2026-07', step: 'HOD', actorUserId: 'U-HOD', decision: 'Signed', comment: '', timestamp: '2026-08-17T04:55:00.000Z' },

    // 2026-08 — submitted, returned with a comment, resubmitted, still unsigned.
    { periodId: MAIN_PERIOD_ID, step: 'Submit', actorUserId: 'U-OE1', decision: 'Submitted', comment: '', timestamp: '2026-09-16T06:10:00.000Z' },
    { periodId: MAIN_PERIOD_ID, step: 'HOD', actorUserId: 'U-HOD', decision: 'Returned', comment: 'Dispersion rows for 28 Aug look short against the batch register. Please check before I sign.', timestamp: '2026-09-17T05:25:00.000Z' },
    { periodId: MAIN_PERIOD_ID, step: 'Submit', actorUserId: 'U-OE1', decision: 'Submitted', comment: 'Dispersion rows for 28 Aug corrected from the batch register.', timestamp: '2026-09-18T07:40:00.000Z' },
  ]

  return steps.map((step, index) => ({ stepId: `AP-${String(index + 1).padStart(3, '0')}`, ...step }))
}

/** A HOD full-marks override for a whole month, still waiting for MD review. */
function buildMonthOverrides(): MonthOverride[] {
  return [
    {
      overrideId: 'MO-001',
      periodId: MAIN_PERIOD_ID,
      empId: 4113,
      score: 20,
      reason: 'Extraordinary performance — ran the line single-handed through the 28–30 Aug breakdown.',
      grantedBy: 'U-HOD',
      grantedAt: '2026-09-15T11:00:00.000Z',
      mdReviewed: false,
    },
  ]
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function buildAuditLog(
  entries: DailyEntry[],
  rules: TargetRule[],
  approvals: ApprovalStep[],
  overrides: MonthOverride[],
  points: Point[] = POINTS,
): AuditLogEntry[] {
  const rng = createRng(SEED + 7)
  const log: AuditLogEntry[] = []
  let sequence = 0
  const add = (partial: Omit<AuditLogEntry, 'logId'>) => {
    sequence += 1
    log.push({ logId: `LOG-${String(sequence).padStart(5, '0')}`, ...partial })
  }

  // Every target change the HOD made.
  for (const rule of rules.filter((r) => r.reason !== 'Default')) {
    const point = points.find((p) => p.pointId === rule.pointId)
    add({
      timestamp: rule.changedAt,
      userId: rule.changedBy,
      entity: 'TargetRule',
      entityId: rule.ruleId,
      field: `Daily Target — ${point?.name ?? rule.pointId} (${rule.effectiveFrom}${rule.effectiveTo && rule.effectiveTo !== rule.effectiveFrom ? ` to ${rule.effectiveTo}` : ''})`,
      oldValue: String(point?.defaultTarget ?? ''),
      newValue: String(rule.target),
      reason: rule.reason,
    })
  }

  // Every approval action.
  for (const step of approvals) {
    add({
      timestamp: step.timestamp,
      userId: step.actorUserId,
      entity: 'MonthPeriod',
      entityId: step.periodId,
      field: `${step.step} step`,
      oldValue: '',
      newValue: step.decision,
      reason: step.comment,
    })
  }

  // The full-marks overrides.
  for (const override of overrides) {
    add({
      timestamp: override.grantedAt,
      userId: override.grantedBy,
      entity: 'MonthOverride',
      entityId: override.overrideId,
      field: `Full marks override — Emp ${override.empId}, period ${override.periodId}`,
      oldValue: '',
      newValue: String(override.score),
      reason: override.reason,
    })
  }

  const dayOverride = entries.find((entry) => entry.scoreOverride !== null)
  if (dayOverride) {
    add({
      timestamp: dayOverride.updatedAt ?? dayOverride.enteredAt,
      userId: dayOverride.updatedBy ?? 'U-HOD',
      entity: 'DailyEntry',
      entityId: dayOverride.entryId,
      field: 'Score override',
      oldValue: '',
      newValue: String(dayOverride.scoreOverride),
      reason: dayOverride.overrideReason ?? '',
    })
  }

  // The employee waiting for MD approval.
  const pending = DEMO_EMPLOYEES.find((e) => e.incentiveListStatus === 'Pending MD approval')
  if (pending) {
    add({
      timestamp: pending.requestedAt!,
      userId: pending.requestedBy!,
      entity: 'Employee',
      entityId: String(pending.empId),
      field: 'Incentive list',
      oldValue: '',
      newValue: 'Pending MD approval',
      reason: 'New joiner — requested addition to the incentive list.',
    })
  }

  // A realistic scatter of corrections to actual batches, so the Audit Log screen has body.
  const correctable = entries.filter((entry) => entry.periodId === MAIN_PERIOD_ID && entry.actualBatches !== null)
  for (let i = 0; i < 24 && correctable.length > 0; i += 1) {
    const entry = correctable[rng.int(0, correctable.length - 1)]
    const employee = DEMO_EMPLOYEES.find((e) => e.empId === entry.empId)
    const oldValue = round((entry.actualBatches ?? 0) * rng.float(0.7, 0.95), 2)
    add({
      timestamp: `${entry.date}T${String(rng.int(13, 16)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}:00.000Z`,
      userId: rng.chance(0.75) ? 'U-OE1' : 'U-HOD',
      entity: 'DailyEntry',
      entityId: entry.entryId,
      field: `Output Batch — Emp ${entry.empId} ${employee?.name ?? ''}`,
      oldValue: String(oldValue),
      newValue: String(entry.actualBatches),
      reason: rng.pick([
        'Corrected against the batch register',
        'Typing error',
        'Shift handover correction',
        'Confirmed with the line supervisor',
      ]),
    })
  }

  return log.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

// ---------------------------------------------------------------------------

/**
 * The 42 people DIC named for the incentive list.
 *
 * They arrive Pending MD approval, because policy section 10 applies however someone gets
 * on the list — a supplied list is not an approval. DIC supplied Emp IDs only, so the name,
 * pay grade and joining date are blank until a SAP sync fills them in by Emp ID. Blank, not
 * invented: see `awaitingSapDetail`.
 */
function rosterEntries(): DirectoryEntry[] {
  return PLANT_ROSTER.map((empId) => ({
    empId,
    sapUserId: SAP_EMP_ID_OFFSET + empId,
    name: '',
    grade: '',
    site: 'Kasur' as const,
    joinDate: '',
    pointIds: assignedPointIds(empId),
    syncedAt: '',
  }))
}

/**
 * The state the app ships with: master data, the calendar, the four periods, the login
 * accounts, and the 42 people DIC supplied — on the list but waiting for MD approval.
 * Production history is entered, never invented.
 */
export function buildBaseState(): AppState {
  const roster = rosterEntries()

  return {
    schemaVersion: SCHEMA_VERSION,
    users: USERS.map((user) => ({ ...user })),
    points: POINTS.map((point) => ({ ...point })),
    directory: roster,
    employees: roster.map((entry) => ({
      empId: entry.empId,
      sapUserId: entry.sapUserId,
      name: entry.name,
      grade: entry.grade,
      site: entry.site,
      // The job title does not reliably say who supervises, so everyone starts an Operator.
      role: 'Operator' as const,
      status: 'Active' as const,
      pointIds: entry.pointIds,
      joinDate: entry.joinDate,
      leaveDate: null,
      incentiveListStatus: 'Pending MD approval' as const,
      active: true,
    })),
    calendar: buildCalendar(),
    periods: PERIODS.map((period) => ({ ...period })),
    targetRules: buildTargetRules(),
    entries: [],
    approvals: [],
    monthOverrides: [],
    auditLog: [],
    settings: { ...DEFAULT_SETTINGS },
    pointAliases: { ...POINT_ALIASES },
    rosterSync: { ...INITIAL_SYNC_STATE, schedule: { ...INITIAL_SYNC_STATE.schedule } },
    sapMapping: null,
  }
}

/**
 * The full demo: the invented roster, ~780 entries, the approval history and every seeded
 * scenario from section 8 of the build brief. Loaded on demand from Settings, never by
 * default, so real staff and demo staff never mix by accident.
 */
/**
 * Plausible Daily Targets for the demo only.
 *
 * The real Points ship with a placeholder of 1 because the actual targets were not
 * supplied — inventing them would put wrong numbers on a real scorecard. The demo is
 * invented throughout, so there it is fine, and without them every demo score would be a
 * capped 20.
 */
function demoPoints(): Point[] {
  const rng = createRng(SEED + 31)
  return POINTS.map((point) => ({ ...point, defaultTarget: rng.int(1, 15), defaultTargetSet: true }))
}

export function buildDemoState(): AppState {
  const points = demoPoints()
  const calendar = buildCalendar()
  const targetRules = buildTargetRules(points)
  const entries = buildEntries(calendar, targetRules, DEMO_EMPLOYEES, true, points)
  const approvals = buildApprovals()
  const monthOverrides = buildMonthOverrides()

  // The planted scenarios post people on specific Points, so the roster is reconciled
  // with what was actually generated — an employee always works the Points they have rows on.
  const workedBy = new Map<number, Set<string>>()
  for (const entry of entries) {
    if (!entry.pointId) continue
    const own = workedBy.get(entry.empId) ?? new Set<string>()
    own.add(entry.pointId)
    workedBy.set(entry.empId, own)
  }

  return {
    ...buildBaseState(),
    // The demo is self-contained: its own invented roster replaces the supplied one.
    directory: [],
    points,
    employees: DEMO_EMPLOYEES.map((employee) => ({
      ...employee,
      pointIds: [...new Set([...employee.pointIds, ...(workedBy.get(employee.empId) ?? [])])],
    })),
    calendar,
    targetRules,
    entries,
    approvals,
    monthOverrides,
    auditLog: buildAuditLog(entries, targetRules, approvals, monthOverrides, points),
  }
}

/** Kept for the tests and callers that still want the populated demo. */
export const buildSeedState = buildDemoState

/**
 * Demo production history for whatever roster is currently loaded — real staff included.
 * This is what the "Generate demo entries" button calls, so an imported roster can be
 * exercised through the scorecard, the month-end flow and the export without hand-typing
 * a month of batches.
 */
export function generateEntriesForRoster(state: AppState): DailyEntry[] {
  return buildEntries(state.calendar, state.targetRules, state.employees, false, state.points)
}

// ---------------------------------------------------------------------------
// Demo guide — every seeded scenario, with a link to where it can be seen
// ---------------------------------------------------------------------------

export interface Scenario {
  n: number
  title: string
  detail: string
  where: string
  to: string
}

export const SCENARIOS: Scenario[] = [
  { n: 1, title: 'An employee who scores 20 every day', detail: 'Adeel Farooq (4101) is at or above target on every working day, so his Production Score is a flat 20.00.', where: 'Employee Detail', to: `/employees/4101?period=${MAIN_PERIOD_ID}` },
  { n: 2, title: 'An employee under target, averaging about 15', detail: 'Bilal Nawaz (4102) runs below target all month and has a notably poor week from 24 to 29 August.', where: 'Employee Detail', to: `/employees/4102?period=${MAIN_PERIOD_ID}` },
  { n: 3, title: 'Output above target — the cap at 20', detail: 'Hamza Siddiqui (4103) on Dispersion: 4.75 batches against a target of 4. The screen shows 118.8% and a score of 20.00, never 23.75.', where: 'Daily Entry, 30 Sep (live) and 19 Aug', to: `/daily-entry?period=${OPEN_PERIOD_ID}&date=2026-09-30` },
  { n: 4, title: 'A duplicate row', detail: 'Zeeshan Haider (4105) appears twice on Weighing for 28 September. The rows warn "Possible duplicate" and block Submit day until they are merged or confirmed.', where: 'Daily Entry, 28 Sep', to: `/daily-entry?period=${OPEN_PERIOD_ID}&date=2026-09-28` },
  { n: 5, title: 'An outlier that needs confirming', detail: 'Faizan Mir (4106) on Varnish Plant: target 1, output 19 — 1,900%. A soft warning asks for a confirm; the score still caps at 20.', where: 'Daily Entry, 29 Sep', to: `/daily-entry?period=${OPEN_PERIOD_ID}&date=2026-09-29` },
  { n: 6, title: 'A blank point that blocks Save', detail: 'Nabeel Arshad (4107) has a row for 30 September with no point. Save is blocked until a point is chosen.', where: 'Daily Entry, 30 Sep', to: `/daily-entry?period=${OPEN_PERIOD_ID}&date=2026-09-30` },
  { n: 7, title: 'Two points in one day', detail: 'Usman Tariq (4104) worked Filtration (score 20) and Piccolo (score 10) on 20 August, so his day score is 15.00.', where: 'Employee Detail, or the scorecard cell', to: `/employees/4104?period=${MAIN_PERIOD_ID}` },
  { n: 8, title: 'A HOD target change on a stock-taking day', detail: 'The HOD cut Dispersion, Grinding and Filtration targets for 25 August with the reason "Stock-taking day". The change is in the target history and in the audit log.', where: 'Targets, then Audit Log', to: `/targets?period=${MAIN_PERIOD_ID}` },
  { n: 9, title: 'A day missing entries for a block of staff', detail: 'A dozen employees have no rows for 29 September. The dashboard to-do and the month-end checklist both flag it.', where: 'Daily Entry, 29 Sep', to: `/daily-entry?period=${OPEN_PERIOD_ID}&date=2026-09-29` },
  { n: 10, title: 'A period in each workflow state', detail: 'Jun–Jul is Locked, Jul–Aug is HOD Signed, Aug–Sep is Submitted and Sep–Oct is Open. Switch period in the top bar and switch account to test each step.', where: 'Month-end Review', to: '/month-end' },
  { n: 11, title: 'A rejected submission, then a resubmit', detail: 'The HOD returned the August month with a comment about the 28 August Dispersion rows. The Office Executive corrected it and resubmitted.', where: 'Month-end Review, step history', to: `/month-end?period=${MAIN_PERIOD_ID}` },
  { n: 12, title: 'A new employee waiting for MD approval', detail: 'Ibrahim Saeed (4999) is marked "Pending MD approval" and is excluded from the roll-up. Switch to MD and CEO to approve him.', where: 'People — as Admin, then as MD', to: '/people?tab=employees' },
  { n: 13, title: 'Probation staff, a mid-period joiner and a leaver', detail: 'Rashid Mehboob (4116) and Zohaib Nazir (4203) are on probation, Saad Zubair (4119) joined on 1 September and Irfan Jamil (4120) left on 5 September. All are flagged for the later pro-rata phase.', where: 'Scorecard', to: '/scorecard' },
]
