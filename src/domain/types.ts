/**
 * Entities, named after the policy terms office staff already use
 * (Production Area, Point, Daily Target, Output Batch).
 *
 * Shaped as if they were database tables: every relationship is an ID, never a name.
 * Dates are ISO `YYYY-MM-DD` strings; timestamps are ISO date-times.
 */

import type { AppSettings, TargetChangeReason } from '../config/policy'
import type { GradeBand, RateTable } from './rates'
import type { SyncState } from './syncSchedule'

export type IsoDate = string // YYYY-MM-DD
export type IsoDateTime = string // YYYY-MM-DDTHH:mm:ss.sssZ

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** Six policy roles (section 4) plus System Admin, which exists only for the app. */
export type RoleId =
  | 'OFFICE_EXEC'
  | 'HOD'
  | 'OPS_MANAGER'
  | 'FINANCE'
  | 'EHS_REP'
  | 'MD_CEO'
  | 'ADMIN'

export const ROLE_LABELS: Record<RoleId, string> = {
  OFFICE_EXEC: 'Office Executive',
  HOD: 'HOD (Department Head)',
  OPS_MANAGER: 'Operations Manager',
  FINANCE: 'Finance',
  EHS_REP: 'EHS Representative',
  MD_CEO: 'MD and CEO',
  ADMIN: 'System Admin',
}

export const ROLE_SHORT: Record<RoleId, string> = {
  OFFICE_EXEC: 'Office Exec',
  HOD: 'HOD',
  OPS_MANAGER: 'Ops Manager',
  FINANCE: 'Finance',
  EHS_REP: 'EHS Rep',
  MD_CEO: 'MD / CEO',
  ADMIN: 'Admin',
}

export interface User {
  userId: string
  name: string
  role: RoleId
  /**
   * The SuccessFactors username this account signs in with, without the `@packagesli`
   * suffix — usually their employee number.
   *
   * Kept here rather than derived, because the sign-in username and the Emp ID on the
   * incentive list are different identifiers: a verified sign-in of `10009671` says who
   * somebody is, and nothing at all about what they may do. The role is this app's to
   * decide, so the Admin links the two and an unlinked account cannot get in.
   */
  sapUsername?: string
}

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

export type Site = 'Kasur' | 'Karachi' | 'Inplant'
export type EmployeeRole = 'Operator' | 'Supervisor'
export type EmployeeStatus = 'Active' | 'Probation' | 'Left'

export interface Employee {
  /**
   * The Emp ID used on the floor and in the Excel — 4 digits. This is the key, and what
   * the Employee KPI sheet's "Emp Code" column expects.
   */
  empId: number
  /** The SuccessFactors userId it came from, 8 digits. Kept so a sync can match back. */
  sapUserId: number | null
  name: string
  /** The SAP pay grade, as SuccessFactors holds it. Shown instead of the job title. */
  grade: string
  site: Site
  role: EmployeeRole
  status: EmployeeStatus
  /** The Points this employee works. Daily Entry offers these first. */
  pointIds: string[]
  /** The department whose marks and rate group apply to them. */
  departmentId: string
  /**
   * True for somebody whose output is not measured — no Point, no production rows — who
   * takes the department average as their Production Score instead.
   *
   * Off unless somebody sets it, and never inferred from an absence of rows: an employee
   * with no rows and no flag is far more likely to be a forgotten entry than an unmeasured
   * job, so that case blocks submission rather than quietly paying a department average.
   */
  outputNotMeasured: boolean
  joinDate: IsoDate
  leaveDate: IsoDate | null
  /** Additions to the incentive list need MD approval (policy section 10). */
  incentiveListStatus: 'Approved' | 'Pending MD approval'
  requestedBy?: string
  requestedAt?: IsoDateTime
  approvedBy?: string
  approvedAt?: IsoDateTime
  active: boolean
}

/**
 * A department: the org unit that marks are set for, and that decides the pay rate group.
 *
 * Not the Production Areas Phase 1 removed. An Area grouped Points *inside* Production;
 * a Department is the unit a HOD runs, that gets one set of waste/variance/quality/EHS/WCM
 * marks per period, and whose rate group picks a column out of the rate table.
 */
export type RateGroup = 'Production' | 'Support'

/**
 * How a department's employees are scored.
 *
 * `computed` builds the total out of the seven KPIs. `submittedTotal` takes one figure out
 * of 100 per employee — Maintenance and Support Production work that way, and the brief is
 * explicit that they do not use the KPI breakdown at all.
 */
export type DepartmentScoringMode = 'computed' | 'submittedTotal'

export interface Department {
  departmentId: string
  name: string
  /** Picks the Production or Support column out of the rate table (rate sheet 2025/2026). */
  rateGroup: RateGroup
  scoringMode: DepartmentScoringMode
  active: boolean
}

/** A Point is a work station or activity: Dispersion, Grinding, Filtration, P48… */
export interface Point {
  pointId: string
  name: string
  defaultTarget: number
  /**
   * False while the Daily Target is still the placeholder it was created with. The Targets
   * screen flags these — a placeholder target produces a meaningless score.
   */
  defaultTargetSet: boolean
  active: boolean
  /** True for a Point an Office Executive or HOD typed in during entry. */
  createdOnTheFloor?: boolean
}

export interface DayCalendarEntry {
  date: IsoDate
  isWorkingDay: boolean
  note: string
}

/**
 * One person as SAP holds them — the master data, kept apart from the incentive list.
 *
 * The weekly sync fills this. Nobody here is scored or paid anything: the System Admin
 * picks from it, which creates an Employee marked "Pending MD approval", and only the MD
 * puts them on the list (policy section 10).
 */
export interface DirectoryEntry {
  empId: number
  sapUserId: number | null
  name: string
  grade: string
  site: Site
  joinDate: IsoDate
  pointIds: string[]
  /** When this record was last seen in a SAP sync. */
  syncedAt: IsoDateTime
}

// ---------------------------------------------------------------------------
// Daily entry
// ---------------------------------------------------------------------------

export type EntryStatus = 'Draft' | 'Submitted' | 'Locked'

/**
 * One row per employee, per point, per day. An employee may have several rows in a day.
 * `percent` and `score` are never stored — they are computed by the calc module.
 */
export interface DailyEntry {
  entryId: string
  periodId: string
  date: IsoDate
  empId: number
  /** Null only while a row is being filled in — a blank point blocks Save. */
  pointId: string | null
  /** Daily Target, copied from the TargetRule in force when the row was created. */
  target: number | null
  /** Output Batch. Null means "not entered yet". */
  actualBatches: number | null
  /** HOD full-marks override for this row. When set, it replaces the computed score. */
  scoreOverride: number | null
  overrideReason: string | null
  /** Warning codes the user has explicitly confirmed (duplicates, outliers, non-working day). */
  acknowledgedWarnings: string[]
  status: EntryStatus
  enteredBy: string
  enteredAt: IsoDateTime
  updatedBy: string | null
  updatedAt: IsoDateTime | null
}

/** Default target history for a point. A DailyEntry copies the target at creation. */
export interface TargetRule {
  ruleId: string
  pointId: string
  effectiveFrom: IsoDate
  /** Null means "until further notice". */
  effectiveTo: IsoDate | null
  target: number
  reason: TargetChangeReason | 'Default'
  changedBy: string
  changedAt: IsoDateTime
}

// ---------------------------------------------------------------------------
// Period and approval
// ---------------------------------------------------------------------------

export type PeriodStatus = 'Open' | 'Submitted' | 'HOD Signed' | 'Locked'

export interface MonthPeriod {
  periodId: string
  label: string
  startDate: IsoDate
  endDate: IsoDate
  status: PeriodStatus
}

export type ApprovalStepKind = 'Submit' | 'HOD' | 'Ops' | 'Reopen'
export type ApprovalDecision = 'Submitted' | 'Signed' | 'Approved' | 'Returned' | 'Reopened'

export interface ApprovalStep {
  stepId: string
  periodId: string
  step: ApprovalStepKind
  actorUserId: string
  decision: ApprovalDecision
  comment: string
  timestamp: IsoDateTime
}

/** HOD full-marks override applied to a whole employee-month. */
export interface MonthOverride {
  overrideId: string
  periodId: string
  empId: number
  score: number
  reason: string
  grantedBy: string
  grantedAt: IsoDateTime
  /** MD reviews extraordinary awards (policy section 10). */
  mdReviewed: boolean
}

// ---------------------------------------------------------------------------
// The other six KPIs
// ---------------------------------------------------------------------------

/**
 * One department's marks for one period.
 *
 * Waste and variance are entered as percentages and converted by the policy tables;
 * quality, EHS and WCM are marks as given. Percentages are held in **integer hundredths**
 * (2.83% is 283) so the table boundaries are exact — see `calc.ts`.
 */
export interface DepartmentMarks {
  departmentId: string
  periodId: string
  wastePercentHundredths: number | null
  /** Either a percentage to run through table 7.1… */
  variancePercentHundredths: number | null
  /** …or marks given directly, which wins when both are present. */
  varianceMarksDirect: number | null
  quality: number | null
  ehs: number | null
  wcm5s: number | null
  updatedBy: string
  updatedAt: IsoDateTime
}

/** Days absent for one employee in one period. Null means nobody has said yet; 0 is an answer. */
export interface AttendanceRecord {
  periodId: string
  empId: number
  daysAbsent: number | null
  updatedBy: string
  updatedAt: IsoDateTime
}

/** One employee's total out of 100, for a department that does not use the KPI breakdown. */
export interface SubmittedTotal {
  periodId: string
  empId: number
  total: number | null
  updatedBy: string
  updatedAt: IsoDateTime
}

/** A per-employee departure from the department's marks, or from the rate table. */
export interface KpiOverride {
  overrideId: string
  periodId: string
  empId: number
  /** A KPI key, or 'approved' for the rate-table amount. */
  kpi: string
  value: number
  reason: string
  grantedBy: string
  grantedAt: IsoDateTime
}

/**
 * What a period was worth, frozen at the moment it locked.
 *
 * Rates get revised; the signed sheet is due for renewal in Dec 2026. Recomputing a locked
 * period against a newer rate would silently restate what somebody was already paid, so the
 * figures and the rate version that produced them are written down and read back verbatim.
 */
export interface PeriodSnapshot {
  periodId: string
  rateVersionId: string
  lockedBy: string
  lockedAt: IsoDateTime
  rows: PeriodSnapshotRow[]
}

export interface PeriodSnapshotRow {
  empId: number
  total: number | null
  approved: number | null
  earned: number | null
  band: string | null
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type AuditEntity =
  | 'DailyEntry'
  | 'TargetRule'
  | 'MonthPeriod'
  | 'Employee'
  | 'Point'
  | 'Area'
  | 'Department'
  | 'DepartmentMarks'
  | 'Attendance'
  | 'SubmittedTotal'
  | 'RateTable'
  | 'User'
  | 'DayCalendar'
  | 'Settings'
  | 'MonthOverride'

export interface AuditLogEntry {
  logId: string
  timestamp: IsoDateTime
  userId: string
  /**
   * The incentive period this change belongs to.
   *
   * Not the same as the month the timestamp falls in: a correction made on 25 October to a
   * row dated 20 September belongs to September's month-end, and that is the month somebody
   * auditing it will be looking at. Empty only for changes that belong to no period, such
   * as editing master data.
   */
  periodId: string
  entity: AuditEntity
  entityId: string
  field: string
  oldValue: string
  newValue: string
  reason: string
}

// ---------------------------------------------------------------------------
// Derived (never stored by hand)
// ---------------------------------------------------------------------------

export interface EmployeeDayScore {
  empId: number
  date: IsoDate
  /** Null when the employee has no scorable entry that day — never treated as zero. */
  score: number | null
  entryCount: number
}

export interface EmployeeMonthSummary {
  periodId: string
  empId: number
  daysScored: number
  /** Unrounded. Round only for display. */
  avgScore: number | null
  finalScore: number | null
  flags: string[]
}

// ---------------------------------------------------------------------------
// Root state
// ---------------------------------------------------------------------------

export interface AppState {
  schemaVersion: number
  users: User[]
  points: Point[]
  departments: Department[]
  /** Everyone SAP knows about. Master data, not the incentive list. */
  directory: DirectoryEntry[]
  employees: Employee[]
  calendar: DayCalendarEntry[]
  periods: MonthPeriod[]
  targetRules: TargetRule[]
  entries: DailyEntry[]
  approvals: ApprovalStep[]
  departmentMarks: DepartmentMarks[]
  attendance: AttendanceRecord[]
  submittedTotals: SubmittedTotal[]
  kpiOverrides: KpiOverride[]
  monthOverrides: MonthOverride[]
  /** Rate tables, newest last. The one in force is the latest by effectiveFrom. */
  rateTables: RateTable[]
  /** Grade code to band. MD-editable, so an unseen grade is a data fix, not a release. */
  gradeAliases: Record<string, GradeBand>
  /** Frozen figures for locked periods, keyed by periodId. */
  periodSnapshots: PeriodSnapshot[]
  auditLog: AuditLogEntry[]
  settings: AppSettings
  /** Maps the old Excel spellings onto one canonical point — used by a future import. */
  pointAliases: Record<string, string>
  /** The weekly SAP roster sync: schedule, last result, backoff. */
  rosterSync: SyncState
  /**
   * The SAP field mapping confirmed during the first manual import. The scheduled sync
   * reuses it, so it runs unattended — without it there is nothing to run.
   */
  sapMapping: unknown | null
}
