/**
 * Read-side helpers. Every screen reads the data through these, so the Dashboard, the
 * Scorecard and the Export can never disagree about a number.
 */

import {
  calcEmployeeDay,
  calcMonthly,
  entryPercent,
  entryScore,
  isScorable,
  openIssues,
  validateEntry,
  type ValidationIssue,
} from '../domain/calc'
import { deadlineForPeriod, dateRange, daysBetween } from '../domain/dates'
import type {
  AppState,
  DailyEntry,
  Employee,
  EmployeeMonthSummary,
  IsoDate,
  MonthPeriod,
  Point,
} from '../domain/types'

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function employeeById(state: AppState, empId: number): Employee | undefined {
  return state.employees.find((e) => e.empId === empId)
}

/**
 * What to put where a name goes. One helper, so no screen ever invents a name of its own.
 *
 * Names come from SuccessFactors and nowhere else, so somebody who has not been synced yet
 * has none. Saying that is better than echoing their Emp ID back at them, which is what
 * every column on the row already shows.
 */
export function displayName(person: { name: string } | undefined, empId?: number): string {
  if (!person) return empId === undefined ? 'Unknown employee' : `Emp ${empId} — not on the incentive list`
  return person.name.trim() || 'Name not synced yet'
}

export function pointById(state: AppState, pointId: string | null): Point | undefined {
  return pointId ? state.points.find((p) => p.pointId === pointId) : undefined
}

export function userName(state: AppState, userId: string): string {
  return state.users.find((u) => u.userId === userId)?.name ?? userId
}

export function periodById(state: AppState, periodId: string): MonthPeriod | undefined {
  return state.periods.find((p) => p.periodId === periodId)
}

/** The period a date falls in, if any. The Excel periods do not tile the calendar exactly. */
export function periodForDate(state: AppState, date: IsoDate): MonthPeriod | undefined {
  return state.periods.find((p) => p.startDate <= date && date <= p.endDate)
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export function isWorkingDay(state: AppState, date: IsoDate): boolean {
  return state.calendar.find((d) => d.date === date)?.isWorkingDay ?? false
}

export function calendarDay(state: AppState, date: IsoDate) {
  return state.calendar.find((d) => d.date === date) ?? null
}

/** Every working day in the period. */
export function periodWorkingDays(state: AppState, period: MonthPeriod): IsoDate[] {
  return dateRange(period.startDate, period.endDate).filter((date) => isWorkingDay(state, date))
}

/** Working days up to and including today — the days that ought to have entries by now. */
export function periodWorkingDaysToDate(state: AppState, period: MonthPeriod, today: IsoDate): IsoDate[] {
  return periodWorkingDays(state, period).filter((date) => date <= today)
}

export function nextWorkingDayFor(state: AppState, period: MonthPeriod, today: IsoDate): IsoDate {
  const days = periodWorkingDaysToDate(state, period, today)
  return days.length > 0 ? days[days.length - 1] : period.startDate
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

/** Employees shown on screen — Operators and Supervisors only. */
export function employeesInScope(state: AppState): Employee[] {
  return state.employees.filter((employee) => employee.active).sort((a, b) => a.empId - b.empId)
}

/**
 * Employees that count toward the monthly roll-up. Anyone still "Pending MD approval"
 * is excluded until the MD approves them (policy section 10).
 */
export function employeesInRollup(state: AppState): Employee[] {
  return employeesInScope(state).filter((e) => e.incentiveListStatus === 'Approved')
}

/**
 * The point each employee works most often, with the most recent day breaking a tie.
 * Used to pre-fill the point when rows are added in bulk, so the Office Executive types
 * nothing for the common case.
 *
 * Somebody with no assignment and no history gets nothing, deliberately: the Add row
 * dialog then shows them as "no point yet" and makes the user choose. Guessing a Point
 * would post real output against the wrong Daily Target, which is worse than an empty box.
 */
export function usualPoints(state: AppState): Map<number, string> {
  const tally = new Map<number, Map<string, { count: number; latest: IsoDate }>>()

  for (const entry of state.entries) {
    if (!entry.pointId) continue
    let byPoint = tally.get(entry.empId)
    if (!byPoint) {
      byPoint = new Map()
      tally.set(entry.empId, byPoint)
    }
    const seen = byPoint.get(entry.pointId)
    if (seen) {
      seen.count += 1
      if (entry.date > seen.latest) seen.latest = entry.date
    } else {
      byPoint.set(entry.pointId, { count: 1, latest: entry.date })
    }
  }

  const out = new Map<number, string>()
  for (const employee of state.employees) {
    const byPoint = tally.get(employee.empId)
    // Most-worked Point, but only one they are actually assigned to when they have any.
    const ranked = byPoint
      ? [...byPoint.entries()]
          .sort((a, b) => b[1].count - a[1].count || b[1].latest.localeCompare(a[1].latest))
          .map(([pointId]) => pointId)
      : []

    const assigned = ranked.find((pointId) => employee.pointIds.includes(pointId)) ?? employee.pointIds[0]
    const chosen = assigned ?? ranked[0]
    if (chosen) out.set(employee.empId, chosen)
  }
  return out
}

export function employeeIsActiveOn(employee: Employee, date: IsoDate): boolean {
  if (date < employee.joinDate) return false
  if (employee.leaveDate !== null && date > employee.leaveDate) return false
  return true
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface EntryQuery {
  periodId?: string
  date?: IsoDate
  empId?: number
  pointId?: string
}

export function selectEntries(state: AppState, query: EntryQuery): DailyEntry[] {
  return state.entries
    .filter((entry) => {
      if (query.periodId && entry.periodId !== query.periodId) return false
      if (query.date && entry.date !== query.date) return false
      if (query.empId !== undefined && entry.empId !== query.empId) return false
      if (query.pointId && entry.pointId !== query.pointId) return false
      return true
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.empId - b.empId || a.entryId.localeCompare(b.entryId))
}

/**
 * Index of entries by date. Duplicate detection needs every row for the date, and
 * rescanning the whole table per row turns a period check into an O(n²) sweep.
 */
function entriesByDate(state: AppState): Map<IsoDate, DailyEntry[]> {
  const index = new Map<IsoDate, DailyEntry[]>()
  for (const entry of state.entries) {
    const bucket = index.get(entry.date)
    if (bucket) bucket.push(entry)
    else index.set(entry.date, [entry])
  }
  return index
}

/** Runs the section 6 validation for one row, with the context it needs. */
export function issuesFor(state: AppState, entry: DailyEntry, index?: Map<IsoDate, DailyEntry[]>): ValidationIssue[] {
  return validateEntry(entry, {
    sameDateEntries: index ? (index.get(entry.date) ?? []) : state.entries.filter((e) => e.date === entry.date),
    point: pointById(state, entry.pointId) ?? null,
    employee: employeeById(state, entry.empId) ?? null,
    calendarDay: calendarDay(state, entry.date),
    settings: state.settings,
  })
}

/** Issues that still stand once the row's confirmed warnings are removed. */
export function openIssuesFor(state: AppState, entry: DailyEntry, index?: Map<IsoDate, DailyEntry[]>): ValidationIssue[] {
  return openIssues(entry, issuesFor(state, entry, index))
}

export interface EntryView {
  entry: DailyEntry
  employee: Employee | undefined
  point: Point | undefined
  percent: number | null
  score: number | null
  issues: ValidationIssue[]
  open: ValidationIssue[]
}

export function toEntryView(state: AppState, entry: DailyEntry): EntryView {
  const issues = issuesFor(state, entry)
  return {
    entry,
    employee: employeeById(state, entry.empId),
    point: pointById(state, entry.pointId),
    percent: entryPercent(entry),
    score: entryScore(entry, state.settings),
    issues,
    open: openIssues(entry, issues),
  }
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

export interface ScorecardRow {
  employee: Employee
  /** Employee-day score by date. Missing or unscored days are absent from the map. */
  byDate: Map<IsoDate, number>
  entriesByDate: Map<IsoDate, number>
  daysScored: number
  /** Unrounded Total Avg Score. */
  total: number | null
  /** Set when a HOD full-marks override replaces the computed total. */
  overridden: boolean
  flags: string[]
}

export function scorecard(state: AppState, periodId: string, pointFilter?: string): { dates: IsoDate[]; rows: ScorecardRow[] } {
  const period = periodById(state, periodId)
  if (!period) return { dates: [], rows: [] }

  const dates = periodWorkingDays(state, period)
  const employees = employeesInRollup(state)
  const entries = selectEntries(state, { periodId, pointId: pointFilter })
  const workingDayCount = dates.length

  const byEmployee = new Map<number, DailyEntry[]>()
  for (const entry of entries) {
    const bucket = byEmployee.get(entry.empId)
    if (bucket) bucket.push(entry)
    else byEmployee.set(entry.empId, [entry])
  }

  const rows = employees.map<ScorecardRow>((employee) => {
    const own = byEmployee.get(employee.empId) ?? []
    const byDate = new Map<IsoDate, number>()
    const entriesByDate = new Map<IsoDate, number>()

    for (const date of dates) {
      const dayRows = own.filter((entry) => entry.date === date)
      if (dayRows.length === 0) continue
      entriesByDate.set(date, dayRows.length)
      const score = calcEmployeeDay(dayRows, state.settings)
      if (score !== null) byDate.set(date, score)
    }

    const override = state.monthOverrides.find((o) => o.periodId === periodId && o.empId === employee.empId)
    const computed = calcMonthly(dates.map((date) => byDate.get(date) ?? null), state.settings, workingDayCount)

    const flags: string[] = []
    if (employee.status === 'Probation') flags.push('Probation — 50% with HOD approval (Phase 3)')
    if (employee.joinDate > period.startDate) flags.push(`Joined ${employee.joinDate} — pro-rata (Phase 3)`)
    if (employee.leaveDate && employee.leaveDate <= period.endDate) flags.push(`Left ${employee.leaveDate} — pro-rata (Phase 3)`)
    if (override) flags.push('HOD full-marks override')

    return {
      employee,
      byDate,
      entriesByDate,
      daysScored: byDate.size,
      total: override ? override.score : computed,
      overridden: Boolean(override),
      flags,
    }
  })

  return { dates, rows }
}

export function employeeSummary(state: AppState, periodId: string, empId: number): EmployeeMonthSummary | null {
  const employee = employeeById(state, empId)
  const period = periodById(state, periodId)
  if (!employee || !period) return null

  const { rows } = scorecard(state, periodId)
  const row = rows.find((r) => r.employee.empId === empId)
  if (!row) {
    return { periodId, empId, daysScored: 0, avgScore: null, finalScore: null, flags: ['Not in the roll-up for this period'] }
  }
  return { periodId, empId, daysScored: row.daysScored, avgScore: row.total, finalScore: row.total, flags: row.flags }
}

// ---------------------------------------------------------------------------
// Period health — drives the Dashboard and the Month-end checklist
// ---------------------------------------------------------------------------

export interface PeriodHealth {
  workingDays: IsoDate[]
  workingDaysToDate: IsoDate[]
  daysWithEntries: IsoDate[]
  missingDays: IsoDate[]
  draftRows: number
  openErrors: number
  openWarnings: number
  /** Rows on the sheet with no Output Batch typed yet — incomplete, not wrong. */
  rowsAwaitingEntry: number
  duplicateRows: number
  underTargetRows: number
  totalRows: number
  deadline: IsoDate
  daysToDeadline: number
  deadlinePassed: boolean
  averageScore: number | null
}

export function periodHealth(state: AppState, period: MonthPeriod, today: IsoDate): PeriodHealth {
  const workingDays = periodWorkingDays(state, period)
  const workingDaysToDate = periodWorkingDaysToDate(state, period, today)
  const entries = selectEntries(state, { periodId: period.periodId })

  const datesWithEntries = new Set(entries.map((e) => e.date))
  const daysWithEntries = workingDays.filter((date) => datesWithEntries.has(date))
  const missingDays = workingDaysToDate.filter((date) => !datesWithEntries.has(date))

  let openErrors = 0
  let openWarnings = 0
  let rowsAwaitingEntry = 0
  let duplicateRows = 0
  let underTargetRows = 0

  const index = entriesByDate(state)
  for (const entry of entries) {
    for (const issue of openIssuesFor(state, entry, index)) {
      // "Not typed yet" is counted on its own — it is not a data problem.
      if (issue.code === 'ACTUAL_MISSING') rowsAwaitingEntry += 1
      else if (issue.severity === 'error') openErrors += 1
      else openWarnings += 1
      if (issue.code === 'DUPLICATE_ROW') duplicateRows += 1
    }
    if (
      isScorable(entry, state.settings) &&
      entry.target &&
      entry.actualBatches !== null &&
      entry.actualBatches < entry.target * state.settings.underTargetFraction
    ) {
      underTargetRows += 1
    }
  }

  const { rows } = scorecard(state, period.periodId)
  const totals = rows.map((r) => r.total).filter((t): t is number => t !== null)
  const deadline = deadlineForPeriod(period.endDate, state.settings.reviewDeadlineDay)

  return {
    workingDays,
    workingDaysToDate,
    daysWithEntries,
    missingDays,
    draftRows: entries.filter((e) => e.status === 'Draft').length,
    openErrors,
    openWarnings,
    rowsAwaitingEntry,
    duplicateRows,
    underTargetRows,
    totalRows: entries.length,
    deadline,
    daysToDeadline: daysBetween(today, deadline),
    deadlinePassed: today > deadline,
    averageScore: totals.length > 0 ? totals.reduce((sum, t) => sum + t, 0) / totals.length : null,
  }
}

// ---------------------------------------------------------------------------
// Month-end checklist
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  label: string
  ok: boolean
  detail: string
}

export function monthChecklist(state: AppState, period: MonthPeriod, today: IsoDate): ChecklistItem[] {
  const health = periodHealth(state, period, today)

  // Nobody on the incentive list means nothing to enter, so the checklist must not sit
  // permanently red and block the Operations Manager from ever approving.
  if (employeesInRollup(state).length === 0) {
    return [
      {
        label: 'Nobody on the incentive list yet',
        ok: true,
        detail: 'Add employees from Master Data and have the MD approve them.',
      },
    ]
  }

  return [
    {
      label: 'All working days entered',
      ok: health.missingDays.length === 0,
      detail:
        health.missingDays.length === 0
          ? `${health.daysWithEntries.length} of ${health.workingDays.length} working days have entries.`
          : `${health.missingDays.length} day(s) with no entries: ${health.missingDays.join(', ')}`,
    },
    {
      label: 'No open warnings',
      ok: health.openWarnings === 0,
      detail:
        health.openWarnings === 0
          ? 'No duplicates or outliers waiting to be confirmed.'
          : `${health.openWarnings} warning(s) still to merge or confirm, including ${health.duplicateRows} possible duplicate row(s).`,
    },
    {
      label: 'Every row has an Output Batch',
      ok: health.openErrors === 0 && health.rowsAwaitingEntry === 0,
      detail:
        health.openErrors === 0 && health.rowsAwaitingEntry === 0
          ? 'Every row has a point, a target and an output batch.'
          : [
              health.openErrors > 0 ? `${health.openErrors} row(s) cannot be scored` : '',
              health.rowsAwaitingEntry > 0 ? `${health.rowsAwaitingEntry} row(s) not typed yet` : '',
            ]
              .filter(Boolean)
              .join(' · '),
    },
    {
      label: 'No draft rows',
      ok: health.draftRows === 0,
      detail: health.draftRows === 0 ? 'Every day has been submitted.' : `${health.draftRows} row(s) are still in Draft.`,
    },
  ]
}

export function checklistComplete(items: ChecklistItem[]): boolean {
  return items.every((item) => item.ok)
}


