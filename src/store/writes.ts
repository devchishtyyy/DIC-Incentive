/**
 * Every change to the data goes through `applyWrite`. There is no other way to mutate
 * state, and `applyWrite` always produces the matching audit rows — so an edit that is
 * not audited is impossible by construction.
 */

import type { AppSettings } from '../config/policy'
import { DEFAULT_DEPARTMENT_ID } from '../data/masters'
import { awaitingSapDetail } from '../data/plantMasters'
import { restatePeriods } from '../domain/periods'
import { currentRateTable, snapshotRowsFor } from './selectors'
import type { GradeBand, RateTable } from '../domain/rates'
import { describeSchedule, type SyncSchedule, type SyncStatus } from '../domain/syncSchedule'
import type {
  ApprovalStep,
  AppState,
  AttendanceRecord,
  AuditLogEntry,
  Department,
  DepartmentMarks,
  DirectoryEntry,
  DailyEntry,
  Employee,
  KpiOverride,
  SubmittedTotal,
  IsoDate,
  MonthOverride,
  MonthPeriod,
  PeriodSnapshot,
  Point,
  User,
} from '../domain/types'

// ---------------------------------------------------------------------------

export type WriteOp =
  // Daily Entry
  | { kind: 'entry.add'; entry: DailyEntry }
  | { kind: 'entry.addMany'; entries: DailyEntry[] }
  | { kind: 'entry.setActual'; entryId: string; value: number | null }
  | { kind: 'entry.setTarget'; entryId: string; value: number | null; reason: string }
  | { kind: 'entry.setPoint'; entryId: string; pointId: string | null }
  | { kind: 'entry.setEmployee'; entryId: string; empId: number }
  | { kind: 'entry.delete'; entryId: string }
  | { kind: 'entry.deleteMany'; entryIds: string[] }
  | { kind: 'entry.acknowledge'; entryId: string; code: string; note: string }
  | { kind: 'entry.merge'; keepId: string; dropIds: string[] }
  | { kind: 'entry.override'; entryId: string; score: number | null; reason: string }
  | { kind: 'day.submit'; periodId: string; date: IsoDate }
  | { kind: 'day.copyPrevious'; periodId: string; from: IsoDate; to: IsoDate; entries: DailyEntry[] }
  // Targets
  | { kind: 'target.setDated'; pointId: string; from: IsoDate; to: IsoDate; target: number; reason: string }
  | { kind: 'target.setDefault'; pointId: string; target: number; reason: string }
  | { kind: 'target.deleteRule'; ruleId: string }
  // Month-end workflow
  | { kind: 'month.submit'; periodId: string; comment: string }
  | { kind: 'month.hodSign'; periodId: string; decision: 'Signed' | 'Returned'; comment: string }
  | { kind: 'month.opsDecision'; periodId: string; decision: 'Approved' | 'Returned'; comment: string }
  | { kind: 'month.reopen'; periodId: string; reason: string }
  | { kind: 'month.override'; periodId: string; empId: number; score: number; reason: string }
  | { kind: 'month.reviewOverride'; overrideId: string }
  // Master data
  | { kind: 'directory.sync'; entries: DirectoryEntry[]; source: string }
  | { kind: 'employee.addFromDirectory'; empIds: number[] }
  | { kind: 'employee.upsert'; employee: Employee; isNew: boolean }
  | { kind: 'employee.setActive'; empId: number; active: boolean; reason: string }
  | { kind: 'employee.approveAdd'; empIds: number[]; comment: string }
  | { kind: 'employee.setName'; empId: number; name: string }
  | { kind: 'point.create'; name: string; assignToEmpId?: number }
  | { kind: 'point.upsert'; point: Point; isNew: boolean }
  | { kind: 'employee.setPoints'; empId: number; pointIds: string[] }
  | { kind: 'point.setActive'; pointId: string; active: boolean }
  | { kind: 'user.upsert'; user: User; isNew: boolean }
  | { kind: 'calendar.set'; date: IsoDate; isWorkingDay: boolean; note: string }
  // Settings
  | { kind: 'settings.update'; patch: Partial<AppSettings> }
  // Department marks, attendance, submitted totals
  | { kind: 'deptMarks.set'; periodId: string; departmentId: string; patch: Partial<DepartmentMarks> }
  | { kind: 'attendance.setMany'; periodId: string; rows: Array<{ empId: number; daysAbsent: number | null }> }
  | { kind: 'submittedTotal.setMany'; periodId: string; rows: Array<{ empId: number; total: number | null }> }
  | { kind: 'kpiOverride.set'; periodId: string; empId: number; kpi: string; value: number; reason: string }
  | { kind: 'kpiOverride.clear'; overrideId: string }
  | { kind: 'employee.setOutputNotMeasured'; empIds: number[]; value: boolean; reason: string }
  | { kind: 'employee.setDepartment'; empIds: number[]; departmentId: string }
  | { kind: 'department.upsert'; department: Department; isNew: boolean }
  // Money
  | { kind: 'rates.setTable'; table: RateTable }
  | { kind: 'rates.setAliases'; aliases: Record<string, GradeBand> }
  // Roster sync
  | { kind: 'sync.setSchedule'; schedule: SyncSchedule }
  | { kind: 'sync.saveMapping'; mapping: unknown }
  | { kind: 'sync.record'; status: SyncStatus; message: string; count: number; at: string }
  // Demo data
  | { kind: 'demo.setEntries'; entries: DailyEntry[] }
  | { kind: 'demo.clearEntries' }

export interface WriteContext {
  actorUserId: string
  now: string
}

export interface WriteResult {
  state: AppState
  logs: AuditLogEntry[]
  /** Short sentence for the success toast. */
  message: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0
function makeId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}`.toUpperCase()
}

export function newEntryId(): string {
  return makeId('EN')
}

const str = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * HOD sign-offs only count from the last point the month was (re)opened for signing:
 * a fresh submission, an Operations Manager return, or a reopen all wipe the slate.
 */
export function signatureBoundary(state: AppState, periodId: string): string {
  const resets = state.approvals
    .filter(
      (step) =>
        step.periodId === periodId &&
        (step.decision === 'Submitted' || step.decision === 'Reopened' || (step.step === 'Ops' && step.decision === 'Returned')),
    )
    .map((step) => step.timestamp)
    .sort()
  return resets.length > 0 ? resets[resets.length - 1] : ''
}

/** Has the HOD signed off the current submission of this period? */
export function hodHasSigned(state: AppState, periodId: string): boolean {
  const boundary = signatureBoundary(state, periodId)
  return state.approvals.some(
    (step) => step.periodId === periodId && step.step === 'HOD' && step.decision === 'Signed' && step.timestamp >= boundary,
  )
}

function setPeriodStatus(state: AppState, periodId: string, status: MonthPeriod['status']): AppState {
  return { ...state, periods: state.periods.map((p) => (p.periodId === periodId ? { ...p, status } : p)) }
}

/** The identity of a row: one employee, on one point, on one day. */
function rowKey(entry: Pick<DailyEntry, 'date' | 'empId' | 'pointId'>): string {
  return `${entry.date}|${entry.empId}|${entry.pointId ?? ''}`
}

function touch(entry: DailyEntry, ctx: WriteContext): DailyEntry {
  return { ...entry, updatedBy: ctx.actorUserId, updatedAt: ctx.now }
}

// ---------------------------------------------------------------------------
// The one write function
// ---------------------------------------------------------------------------

export function applyWrite(state: AppState, op: WriteOp, ctx: WriteContext): WriteResult {
  const logs: AuditLogEntry[] = []
  let logSeq = 0
  const audit = (
    entity: AuditLogEntry['entity'],
    entityId: string,
    field: string,
    oldValue: unknown,
    newValue: unknown,
    reason = '',
  ) => {
    logSeq += 1
    logs.push({
      logId: `${makeId('LOG')}${logSeq}`,
      timestamp: ctx.now,
      userId: ctx.actorUserId,
      entity,
      entityId,
      field,
      oldValue: str(oldValue),
      newValue: str(newValue),
      reason,
    })
  }

  const entryById = (entryId: string) => state.entries.find((e) => e.entryId === entryId)
  const employeeLabel = (empId: number) => {
    const employee = state.employees.find((e) => e.empId === empId)
    return employee ? `Emp ${empId} ${employee.name}` : `Emp ${empId}`
  }
  const pointName = (pointId: string | null) =>
    pointId ? (state.points.find((p) => p.pointId === pointId)?.name ?? pointId) : '(blank)'

  switch (op.kind) {
    // --- Daily Entry ------------------------------------------------------
    case 'entry.add': {
      audit('DailyEntry', op.entry.entryId, 'Row created', '', `${employeeLabel(op.entry.empId)} · ${pointName(op.entry.pointId)} · ${op.entry.date}`)
      return { state: { ...state, entries: [...state.entries, op.entry] }, logs, message: 'Row added.' }
    }

    case 'entry.addMany': {
      if (op.entries.length === 0) return { state, logs: [], message: '' }

      // A row is one employee on one point on one day. Anything already on the sheet is
      // skipped rather than created again, so bulk add can never manufacture a duplicate.
      const seen = new Set(state.entries.map(rowKey))
      const fresh: DailyEntry[] = []
      let skipped = 0
      for (const entry of op.entries) {
        const key = rowKey(entry)
        if (seen.has(key)) {
          skipped += 1
          continue
        }
        seen.add(key)
        fresh.push(entry)
      }

      if (fresh.length === 0) {
        return { state, logs: [], message: `Nothing added — all ${skipped} row${skipped === 1 ? ' was' : 's were'} already on the sheet.` }
      }

      // One audit row per created row — "written on every create" means every one.
      for (const entry of fresh) {
        audit('DailyEntry', entry.entryId, 'Row created', '', `${employeeLabel(entry.empId)} · ${pointName(entry.pointId)} · ${entry.date}`)
      }

      return {
        state: { ...state, entries: [...state.entries, ...fresh] },
        logs,
        message:
          `${fresh.length} row${fresh.length === 1 ? '' : 's'} added for ${fresh[0].date}.` +
          (skipped > 0 ? ` ${skipped} skipped — already on the sheet.` : ''),
      }
    }

    case 'entry.deleteMany': {
      const doomed = state.entries.filter((entry) => op.entryIds.includes(entry.entryId))
      if (doomed.length === 0) return { state, logs: [], message: '' }
      for (const entry of doomed) {
        audit(
          'DailyEntry',
          entry.entryId,
          'Row deleted',
          `${employeeLabel(entry.empId)} · ${pointName(entry.pointId)} · ${entry.date} · ${str(entry.actualBatches)} batches`,
          '',
        )
      }
      const ids = new Set(op.entryIds)
      return {
        state: { ...state, entries: state.entries.filter((entry) => !ids.has(entry.entryId)) },
        logs,
        message: `${doomed.length} draft row${doomed.length === 1 ? '' : 's'} deleted.`,
      }
    }

    case 'entry.setActual': {
      const existing = entryById(op.entryId)
      if (!existing || existing.actualBatches === op.value) return { state, logs: [], message: '' }
      audit('DailyEntry', op.entryId, `Output Batch — ${employeeLabel(existing.empId)} · ${pointName(existing.pointId)} · ${existing.date}`, existing.actualBatches, op.value)
      return {
        state: { ...state, entries: state.entries.map((e) => (e.entryId === op.entryId ? touch({ ...e, actualBatches: op.value }, ctx) : e)) },
        logs,
        message: 'Output Batch saved.',
      }
    }

    case 'entry.setTarget': {
      const existing = entryById(op.entryId)
      if (!existing || existing.target === op.value) return { state, logs: [], message: '' }
      audit('DailyEntry', op.entryId, `Daily Target — ${employeeLabel(existing.empId)} · ${pointName(existing.pointId)} · ${existing.date}`, existing.target, op.value, op.reason)
      return {
        state: { ...state, entries: state.entries.map((e) => (e.entryId === op.entryId ? touch({ ...e, target: op.value }, ctx) : e)) },
        logs,
        message: 'Daily Target changed.',
      }
    }

    case 'entry.setPoint': {
      const existing = entryById(op.entryId)
      if (!existing || existing.pointId === op.pointId) return { state, logs: [], message: '' }
      const point = op.pointId ? state.points.find((p) => p.pointId === op.pointId) : null
      audit('DailyEntry', op.entryId, `Point — ${employeeLabel(existing.empId)} · ${existing.date}`, pointName(existing.pointId), pointName(op.pointId))
      // A new point brings its own default target when the row has none yet.
      const nextTarget = existing.target === null && point ? point.defaultTarget : existing.target
      return {
        state: { ...state, entries: state.entries.map((e) => (e.entryId === op.entryId ? touch({ ...e, pointId: op.pointId, target: nextTarget }, ctx) : e)) },
        logs,
        message: 'Point changed.',
      }
    }

    case 'entry.setEmployee': {
      const existing = entryById(op.entryId)
      if (!existing || existing.empId === op.empId) return { state, logs: [], message: '' }
      audit('DailyEntry', op.entryId, `Employee — ${existing.date} · ${pointName(existing.pointId)}`, employeeLabel(existing.empId), employeeLabel(op.empId))
      return {
        state: { ...state, entries: state.entries.map((e) => (e.entryId === op.entryId ? touch({ ...e, empId: op.empId }, ctx) : e)) },
        logs,
        message: 'Employee changed.',
      }
    }

    case 'entry.delete': {
      const existing = entryById(op.entryId)
      if (!existing) return { state, logs: [], message: '' }
      audit('DailyEntry', op.entryId, 'Row deleted', `${employeeLabel(existing.empId)} · ${pointName(existing.pointId)} · ${existing.date} · ${str(existing.actualBatches)} batches`, '')
      return { state: { ...state, entries: state.entries.filter((e) => e.entryId !== op.entryId) }, logs, message: 'Draft row deleted.' }
    }

    case 'entry.acknowledge': {
      const existing = entryById(op.entryId)
      if (!existing || existing.acknowledgedWarnings.includes(op.code)) return { state, logs: [], message: '' }
      audit('DailyEntry', op.entryId, `Warning confirmed — ${op.code}`, 'open', 'confirmed', op.note)
      return {
        state: {
          ...state,
          entries: state.entries.map((e) =>
            e.entryId === op.entryId ? touch({ ...e, acknowledgedWarnings: [...e.acknowledgedWarnings, op.code] }, ctx) : e,
          ),
        },
        logs,
        message: 'Warning confirmed.',
      }
    }

    case 'entry.merge': {
      const keep = entryById(op.keepId)
      const dropped = op.dropIds.map(entryById).filter((e): e is DailyEntry => Boolean(e))
      if (!keep || dropped.length === 0) return { state, logs: [], message: '' }
      for (const row of dropped) {
        audit('DailyEntry', row.entryId, `Duplicate merged into ${op.keepId}`, `${str(row.actualBatches)} batches`, 'removed', 'Confirmed as a duplicate row')
      }
      return {
        state: { ...state, entries: state.entries.filter((e) => !op.dropIds.includes(e.entryId)) },
        logs,
        message: `Merged ${dropped.length + 1} duplicate rows into one.`,
      }
    }

    case 'entry.override': {
      const existing = entryById(op.entryId)
      if (!existing) return { state, logs: [], message: '' }
      audit('DailyEntry', op.entryId, `Full marks override — ${employeeLabel(existing.empId)} · ${existing.date}`, existing.scoreOverride, op.score, op.reason)
      return {
        state: {
          ...state,
          entries: state.entries.map((e) =>
            e.entryId === op.entryId ? touch({ ...e, scoreOverride: op.score, overrideReason: op.score === null ? null : op.reason }, ctx) : e,
          ),
        },
        logs,
        message: op.score === null ? 'Override removed.' : 'Full marks awarded for this day.',
      }
    }

    case 'day.submit': {
      const affected = state.entries.filter((e) => e.periodId === op.periodId && e.date === op.date && e.status === 'Draft')
      if (affected.length === 0) return { state, logs: [], message: 'Nothing left in draft for this day.' }
      audit('DailyEntry', `${op.periodId}|${op.date}`, `Day submitted — ${op.date}`, `${affected.length} draft rows`, 'Submitted')
      const ids = new Set(affected.map((e) => e.entryId))
      return {
        state: { ...state, entries: state.entries.map((e) => (ids.has(e.entryId) ? touch({ ...e, status: 'Submitted' }, ctx) : e)) },
        logs,
        message: `${affected.length} rows submitted for ${op.date}.`,
      }
    }

    case 'day.copyPrevious': {
      if (op.entries.length === 0) return { state, logs: [], message: 'The previous working day has no rows to copy.' }
      audit('DailyEntry', `${op.periodId}|${op.to}`, `Rows copied from ${op.from}`, '', `${op.entries.length} rows`)
      return { state: { ...state, entries: [...state.entries, ...op.entries] }, logs, message: `Copied ${op.entries.length} rows from ${op.from}.` }
    }

    // --- Targets ----------------------------------------------------------
    case 'target.setDated': {
      const point = state.points.find((p) => p.pointId === op.pointId)
      const rule = {
        ruleId: makeId('TR'),
        pointId: op.pointId,
        effectiveFrom: op.from,
        effectiveTo: op.to,
        target: op.target,
        reason: op.reason as never,
        changedBy: ctx.actorUserId,
        changedAt: ctx.now,
      }
      audit('TargetRule', rule.ruleId, `Daily Target — ${point?.name ?? op.pointId} (${op.from}${op.to !== op.from ? ` to ${op.to}` : ''})`, point?.defaultTarget, op.target, op.reason)

      // Only rows that are still editable pick up the new target — a locked or already
      // signed-off day keeps the target it was scored with.
      const editablePeriods = new Set(state.periods.filter((p) => p.status === 'Open' || p.status === 'Submitted').map((p) => p.periodId))
      let rewritten = 0
      const entries = state.entries.map((entry) => {
        if (entry.pointId !== op.pointId) return entry
        if (entry.date < op.from || entry.date > op.to) return entry
        if (entry.status === 'Locked' || !editablePeriods.has(entry.periodId)) return entry
        if (entry.target === op.target) return entry
        rewritten += 1
        return touch({ ...entry, target: op.target }, ctx)
      })
      if (rewritten > 0) {
        audit('DailyEntry', op.pointId, `Daily Target applied to open rows (${op.from} to ${op.to})`, '', `${rewritten} rows`, op.reason)
      }

      return {
        state: { ...state, targetRules: [...state.targetRules, rule], entries },
        logs,
        message: rewritten > 0 ? `Target set. ${rewritten} open rows updated.` : 'Target set for those dates.',
      }
    }

    case 'target.setDefault': {
      const point = state.points.find((p) => p.pointId === op.pointId)
      if (!point || point.defaultTarget === op.target) return { state, logs: [], message: '' }
      audit('Point', op.pointId, `Default target — ${point.name}`, point.defaultTarget, op.target, op.reason)
      const rule = {
        ruleId: makeId('TR'),
        pointId: op.pointId,
        effectiveFrom: ctx.now.slice(0, 10),
        effectiveTo: null,
        target: op.target,
        reason: 'Default' as const,
        changedBy: ctx.actorUserId,
        changedAt: ctx.now,
      }
      return {
        state: {
          ...state,
          // Typing a real target is what "set" means — the "not set" flag clears itself.
          points: state.points.map((p) => (p.pointId === op.pointId ? { ...p, defaultTarget: op.target, defaultTargetSet: true } : p)),
          targetRules: [...state.targetRules, rule],
        },
        logs,
        message: `Default target for ${point.name} is now ${op.target}.`,
      }
    }

    case 'target.deleteRule': {
      const rule = state.targetRules.find((r) => r.ruleId === op.ruleId)
      if (!rule) return { state, logs: [], message: '' }
      const point = state.points.find((p) => p.pointId === rule.pointId)
      audit('TargetRule', op.ruleId, `Dated target removed — ${point?.name ?? rule.pointId}`, rule.target, '', rule.reason)
      return { state: { ...state, targetRules: state.targetRules.filter((r) => r.ruleId !== op.ruleId) }, logs, message: 'Dated target removed.' }
    }

    // --- Month-end workflow -----------------------------------------------
    case 'month.submit': {
      const step = makeStep(op.periodId, 'Submit', ctx, 'Submitted', op.comment)
      audit('MonthPeriod', op.periodId, 'Month submitted to HOD', 'Open', 'Submitted', op.comment)
      return {
        state: { ...setPeriodStatus(state, op.periodId, 'Submitted'), approvals: [...state.approvals, step] },
        logs,
        message: 'Month submitted for HOD sign-off.',
      }
    }

    case 'month.hodSign': {
      const step = makeStep(op.periodId, 'HOD', ctx, op.decision, op.comment)
      const withStep: AppState = { ...state, approvals: [...state.approvals, step] }

      if (op.decision === 'Returned') {
        audit('MonthPeriod', op.periodId, 'HOD returned the month', 'Submitted', 'Open', op.comment)
        return {
          state: setPeriodStatus(withStep, op.periodId, 'Open'),
          logs,
          message: 'Returned to the Office Executive with your comment.',
        }
      }

      audit('MonthPeriod', op.periodId, 'HOD sign-off', 'Submitted', 'HOD Signed', op.comment)
      return {
        state: setPeriodStatus(withStep, op.periodId, 'HOD Signed'),
        logs,
        message: 'Signed off. The Operations Manager can now approve the month.',
      }
    }

    case 'month.opsDecision': {
      const step = makeStep(op.periodId, 'Ops', ctx, op.decision, op.comment)
      const withStep: AppState = { ...state, approvals: [...state.approvals, step] }

      if (op.decision === 'Returned') {
        audit('MonthPeriod', op.periodId, 'Operations Manager returned the month', 'HOD Signed', 'Submitted', op.comment)
        return {
          state: setPeriodStatus(withStep, op.periodId, 'Submitted'),
          logs,
          message: 'Returned to the HOD. Their sign-off has been cleared.',
        }
      }

      audit('MonthPeriod', op.periodId, 'Operations Manager approved — month locked', 'HOD Signed', 'Locked', op.comment)
      const locked = withStep.entries.map((e) => (e.periodId === op.periodId && e.status !== 'Locked' ? { ...e, status: 'Locked' as const } : e))
      audit('DailyEntry', op.periodId, 'All rows locked', 'Submitted', 'Locked', 'Month approved')

      /*
       * Freeze the money as well as the rows.
       *
       * Locking the entries stops the scores moving, but Approved comes from a rate table
       * that gets revised — the signed sheet is due for renewal in Dec 2026. Writing the
       * figures and the rate version down means a later revision cannot restate what
       * somebody has already been paid, which is the one thing a locked period must
       * guarantee. `periodPay` reads this back verbatim instead of recomputing.
       */
      const rateVersionId = currentRateTable(state).versionId
      const snapshot: PeriodSnapshot = {
        periodId: op.periodId,
        rateVersionId,
        lockedBy: ctx.actorUserId,
        lockedAt: ctx.now,
        rows: snapshotRowsFor(state, op.periodId),
      }
      const payable = snapshot.rows.reduce((sum, row) => sum + (row.earned ?? 0), 0)
      audit('MonthPeriod', op.periodId, 'Incentive frozen', '', `${snapshot.rows.length} people · PKR ${payable} · rates ${rateVersionId}`, 'Month locked')

      return {
        state: {
          ...setPeriodStatus(withStep, op.periodId, 'Locked'),
          entries: locked,
          periodSnapshots: [...state.periodSnapshots.filter((s) => s.periodId !== op.periodId), snapshot],
        },
        logs,
        message: 'Month approved and locked. Finance can now export it.',
      }
    }

    case 'month.reopen': {
      const step = makeStep(op.periodId, 'Reopen', ctx, 'Reopened', op.reason)
      audit('MonthPeriod', op.periodId, 'Month reopened', 'Locked', 'Open', op.reason)
      // The frozen figures go with it: a reopened period is live again by definition, and
      // leaving the snapshot behind would show stale money beside editable scores.
      if (state.periodSnapshots.some((s) => s.periodId === op.periodId)) {
        audit('MonthPeriod', op.periodId, 'Frozen incentive discarded', 'frozen', 'recomputed live', op.reason)
      }
      const unlocked = state.entries.map((e) => (e.periodId === op.periodId && e.status === 'Locked' ? { ...e, status: 'Submitted' as const } : e))
      audit('DailyEntry', op.periodId, 'Rows unlocked for correction', 'Locked', 'Submitted', op.reason)
      return {
        state: {
          ...setPeriodStatus({ ...state, approvals: [...state.approvals, step] }, op.periodId, 'Open'),
          entries: unlocked,
          periodSnapshots: state.periodSnapshots.filter((snap) => snap.periodId !== op.periodId),
        },
        logs,
        message: 'Month reopened. The HOD has been notified.',
      }
    }

    case 'month.override': {
      const override: MonthOverride = {
        overrideId: makeId('MO'),
        periodId: op.periodId,
        empId: op.empId,
        score: op.score,
        reason: op.reason,
        grantedBy: ctx.actorUserId,
        grantedAt: ctx.now,
        mdReviewed: false,
      }
      audit('MonthOverride', override.overrideId, `Full marks override — ${employeeLabel(op.empId)}, period ${op.periodId}`, '', op.score, op.reason)
      return {
        state: { ...state, monthOverrides: [...state.monthOverrides.filter((o) => !(o.periodId === op.periodId && o.empId === op.empId)), override] },
        logs,
        message: 'Full marks awarded for the month. The MD will review it.',
      }
    }

    case 'month.reviewOverride': {
      const override = state.monthOverrides.find((o) => o.overrideId === op.overrideId)
      if (!override) return { state, logs: [], message: '' }
      audit('MonthOverride', op.overrideId, 'MD review', 'pending', 'reviewed', override.reason)
      return {
        state: { ...state, monthOverrides: state.monthOverrides.map((o) => (o.overrideId === op.overrideId ? { ...o, mdReviewed: true } : o)) },
        logs,
        message: 'Override marked as reviewed.',
      }
    }

    // --- Master data ------------------------------------------------------
    case 'directory.sync': {
      if (op.entries.length === 0) return { state, logs: [], message: 'Nothing to sync.' }

      const previous = new Map(state.directory.map((entry) => [entry.empId, entry]))
      const added = op.entries.filter((entry) => !previous.has(entry.empId))

      // One audit row for the sync, not one per person — a 300-row directory refresh is a
      // single administrative act, and the arrivals are what anyone would look for.
      audit('Employee', 'directory', 'SAP directory synced', `${state.directory.length} on file`, `${op.entries.length} on file`, op.source)
      for (const entry of added) {
        audit('Employee', String(entry.empId), 'Appeared in the SAP directory', '', `${entry.name} · ${entry.grade}`, op.source)
      }

      // People who are already on the incentive list get their missing detail filled in.
      // The 42 Emp IDs DIC supplied ship as placeholders — a real name, pay grade and
      // joining date only exist in SuccessFactors — so the first sync is what makes them
      // readable. Only blanks and placeholders are written: a field somebody edited by
      // hand is theirs, and a sync must never quietly overwrite it.
      const fromSap = new Map(op.entries.map((entry) => [entry.empId, entry]))
      let filled = 0
      const employees = state.employees.map((employee) => {
        const entry = fromSap.get(employee.empId)
        if (!entry) return employee
        const placeholder = awaitingSapDetail(employee)
        const next: Employee = {
          ...employee,
          name: placeholder ? entry.name : employee.name,
          grade: placeholder || !employee.grade || employee.grade === '—' ? entry.grade : employee.grade,
          site: placeholder ? entry.site : employee.site,
          joinDate: employee.joinDate || entry.joinDate,
          sapUserId: employee.sapUserId ?? entry.sapUserId,
        }
        if (next.name === employee.name && next.grade === employee.grade && next.site === employee.site && next.joinDate === employee.joinDate) {
          return employee
        }
        filled += 1
        audit('Employee', String(employee.empId), 'Detail filled in from SAP', employee.name, `${next.name} · ${next.grade} · joined ${next.joinDate || 'unknown'}`, op.source)
        return next
      })

      return {
        state: { ...state, directory: op.entries.slice().sort((a, b) => a.empId - b.empId), employees },
        logs,
        message:
          `Directory synced — ${op.entries.length} people from SAP` +
          (added.length > 0 ? `, ${added.length} new since last time` : '') +
          (filled > 0 ? `, ${filled} on the incentive list filled in.` : '.'),
      }
    }

    case 'employee.addFromDirectory': {
      const already = new Set(state.employees.map((employee) => employee.empId))
      const picked = op.empIds
        .filter((empId) => !already.has(empId))
        .map((empId) => state.directory.find((entry) => entry.empId === empId))
        .filter((entry): entry is DirectoryEntry => Boolean(entry))

      if (picked.length === 0) return { state, logs: [], message: 'Nobody new to add — they are already on the list.' }

      const employees: Employee[] = picked.map((entry) => ({
        empId: entry.empId,
        sapUserId: entry.sapUserId,
        name: entry.name,
        grade: entry.grade,
        site: entry.site,
        // Job title does not reliably say who supervises, so everyone starts as an Operator.
        role: 'Operator',
        status: 'Active',
        pointIds: entry.pointIds,
        departmentId: DEFAULT_DEPARTMENT_ID,
        outputNotMeasured: false,
        joinDate: entry.joinDate,
        leaveDate: null,
        // Policy section 10 — the MD puts people on the incentive list, not the Admin.
        incentiveListStatus: 'Pending MD approval',
        requestedBy: ctx.actorUserId,
        requestedAt: ctx.now,
        active: true,
      }))

      for (const employee of employees) {
        audit('Employee', String(employee.empId), 'Proposed for the incentive list', '', `${employee.name} · ${employee.grade}`, 'Selected from the SAP directory — waiting for MD approval')
      }

      return {
        state: { ...state, employees: [...state.employees, ...employees].sort((a, b) => a.empId - b.empId) },
        logs,
        message: `${employees.length} sent to the MD for approval.`,
      }
    }

    case 'employee.upsert': {
      const previous = state.employees.find((e) => e.empId === op.employee.empId)
      if (op.isNew || !previous) {
        audit('Employee', String(op.employee.empId), 'Employee created', '', `${op.employee.name} · ${op.employee.grade} · ${op.employee.site}`, op.employee.incentiveListStatus === 'Pending MD approval' ? 'Added to the incentive list — waiting for MD approval' : '')
        return { state: { ...state, employees: [...state.employees, op.employee] }, logs, message: `${op.employee.name} added.` }
      }
      for (const field of ['name', 'grade', 'site', 'role', 'status', 'joinDate', 'leaveDate'] as const) {
        if (str(previous[field]) !== str(op.employee[field])) {
          audit('Employee', String(op.employee.empId), field, previous[field], op.employee[field])
        }
      }
      return { state: { ...state, employees: state.employees.map((e) => (e.empId === op.employee.empId ? op.employee : e)) }, logs, message: `${op.employee.name} updated.` }
    }

    case 'employee.setActive': {
      const employee = state.employees.find((e) => e.empId === op.empId)
      if (!employee) return { state, logs: [], message: '' }
      audit('Employee', String(op.empId), 'Active', employee.active, op.active, op.reason)
      return {
        state: { ...state, employees: state.employees.map((e) => (e.empId === op.empId ? { ...e, active: op.active } : e)) },
        logs,
        message: op.active ? `${employee.name} reactivated.` : `${employee.name} deactivated. Their entries are kept.`,
      }
    }

    case 'employee.setName': {
      const employee = state.employees.find((e) => e.empId === op.empId)
      if (!employee) return { state, logs: [], message: '' }

      const name = op.name.trim().replace(/\s+/g, ' ')
      if (name === employee.name) return { state, logs: [], message: '' }

      // Worth saying in the audit whether this filled a gap or changed a record, because
      // the second is the one somebody might come asking about.
      const filling = employee.name.trim() === ''
      audit(
        'Employee',
        String(op.empId),
        'Name',
        employee.name,
        name,
        filling ? 'Typed in — SuccessFactors has no record of this Emp ID' : 'Corrected by hand',
      )

      return {
        state: { ...state, employees: state.employees.map((e) => (e.empId === op.empId ? { ...e, name } : e)) },
        logs,
        message: name === '' ? 'Name cleared.' : `${name} named.`,
      }
    }

    case 'employee.approveAdd': {
      // One approval or forty-two, it is the same act and the same op — the MD should never
      // have to click a list of people one at a time. Each person still gets their own
      // audit row, because section 10 is about who was approved, not how many.
      const picked = new Set(op.empIds)
      const approving = state.employees.filter((e) => picked.has(e.empId) && e.incentiveListStatus === 'Pending MD approval')
      if (approving.length === 0) return { state, logs: [], message: 'Nothing waiting for approval.' }

      for (const employee of approving) {
        audit('Employee', String(employee.empId), 'Incentive list', 'Pending MD approval', 'Approved', op.comment)
      }

      const approved = new Set(approving.map((e) => e.empId))
      return {
        state: {
          ...state,
          employees: state.employees.map((e) =>
            approved.has(e.empId) ? { ...e, incentiveListStatus: 'Approved', approvedBy: ctx.actorUserId, approvedAt: ctx.now } : e,
          ),
        },
        logs,
        message:
          approving.length === 1
            ? `${approving[0].name} is now on the incentive list.`
            : `${approving.length} people are now on the incentive list.`,
      }
    }

    case 'point.create': {
      const name = op.name.trim()
      if (!name) return { state, logs: [], message: '' }

      // Match case-insensitively so "manual", "Manual" and "MANUAL" stay one Point —
      // the exact mess section 6 of the brief describes.
      const existing = state.points.find((point) => point.name.trim().toLowerCase() === name.toLowerCase())
      const point: Point = existing ?? {
        pointId: makeId('PT'),
        name,
        // A new Point has no agreed target yet; the Targets screen flags it.
        defaultTarget: 1,
        defaultTargetSet: false,
        active: true,
        createdOnTheFloor: true,
      }

      if (!existing) {
        audit('Point', point.pointId, 'Point created during entry', '', name, 'Typed in on the Daily Entry screen')
      }

      let employees = state.employees
      if (op.assignToEmpId !== undefined) {
        employees = state.employees.map((employee) => {
          if (employee.empId !== op.assignToEmpId || employee.pointIds.includes(point.pointId)) return employee
          audit('Employee', String(employee.empId), 'Points', employee.pointIds.length, employee.pointIds.length + 1, `Assigned to ${name}`)
          return { ...employee, pointIds: [...employee.pointIds, point.pointId] }
        })
      }

      return {
        state: { ...state, points: existing ? state.points : [...state.points, point], employees },
        logs,
        message: existing ? `${name} already exists — using it.` : `${name} added. Set its Daily Target on the Targets screen.`,
      }
    }

    case 'employee.setPoints': {
      const employee = state.employees.find((e) => e.empId === op.empId)
      if (!employee) return { state, logs: [], message: '' }
      const names = (ids: string[]) => ids.map((id) => state.points.find((p) => p.pointId === id)?.name ?? id).join(', ')
      audit('Employee', String(op.empId), 'Points', names(employee.pointIds), names(op.pointIds))
      return {
        state: { ...state, employees: state.employees.map((e) => (e.empId === op.empId ? { ...e, pointIds: op.pointIds } : e)) },
        logs,
        message: `Points updated for ${employee.name}.`,
      }
    }

    case 'point.upsert': {
      const previous = state.points.find((p) => p.pointId === op.point.pointId)
      if (op.isNew || !previous) {
        audit('Point', op.point.pointId, 'Point created', '', `${op.point.name} · default target ${op.point.defaultTarget}`)
        const rule = {
          ruleId: makeId('TR'),
          pointId: op.point.pointId,
          effectiveFrom: ctx.now.slice(0, 10),
          effectiveTo: null,
          target: op.point.defaultTarget,
          reason: 'Default' as const,
          changedBy: ctx.actorUserId,
          changedAt: ctx.now,
        }
        return { state: { ...state, points: [...state.points, op.point], targetRules: [...state.targetRules, rule] }, logs, message: `${op.point.name} added.` }
      }
      for (const field of ['name', 'defaultTarget'] as const) {
        if (str(previous[field]) !== str(op.point[field])) audit('Point', op.point.pointId, field, previous[field], op.point[field])
      }
      return { state: { ...state, points: state.points.map((p) => (p.pointId === op.point.pointId ? op.point : p)) }, logs, message: `${op.point.name} updated.` }
    }

    case 'point.setActive': {
      const point = state.points.find((p) => p.pointId === op.pointId)
      if (!point) return { state, logs: [], message: '' }
      audit('Point', op.pointId, 'Active', point.active, op.active)
      return {
        state: { ...state, points: state.points.map((p) => (p.pointId === op.pointId ? { ...p, active: op.active } : p)) },
        logs,
        message: op.active ? `${point.name} reactivated.` : `${point.name} deactivated.`,
      }
    }

    case 'user.upsert': {
      const previous = state.users.find((u) => u.userId === op.user.userId)
      if (op.isNew || !previous) {
        audit('User', op.user.userId, 'User created', '', `${op.user.name} · ${op.user.role}`)
        return { state: { ...state, users: [...state.users, op.user] }, logs, message: `${op.user.name} added.` }
      }
      for (const field of ['name', 'role'] as const) {
        if (str(previous[field]) !== str(op.user[field])) audit('User', op.user.userId, field, previous[field], op.user[field])
      }
      return { state: { ...state, users: state.users.map((u) => (u.userId === op.user.userId ? op.user : u)) }, logs, message: `${op.user.name} updated.` }
    }

    case 'calendar.set': {
      const previous = state.calendar.find((d) => d.date === op.date)
      audit('DayCalendar', op.date, 'Working day', previous?.isWorkingDay ?? '', op.isWorkingDay, op.note)
      const next = { date: op.date, isWorkingDay: op.isWorkingDay, note: op.note }
      return {
        state: {
          ...state,
          calendar: previous
            ? state.calendar.map((d) => (d.date === op.date ? next : d))
            : [...state.calendar, next].sort((a, b) => a.date.localeCompare(b.date)),
        },
        logs,
        message: `${op.date} marked as ${op.isWorkingDay ? 'a working day' : 'non-working'}.`,
      }
    }

    // --- Settings ---------------------------------------------------------
    case 'settings.update': {
      const keys = Object.keys(op.patch) as Array<keyof AppSettings>
      for (const key of keys) {
        if (str(state.settings[key]) !== str(op.patch[key])) audit('Settings', key, key, state.settings[key], op.patch[key])
      }
      if (logs.length === 0) return { state, logs: [], message: '' }

      const settings = { ...state.settings, ...op.patch }

      /*
       * The period start day is not just a number on a screen: it decides which dates each
       * period covers. Changing it has to move the periods with it, or the setting and the
       * data disagree and every date boundary is wrong until somebody notices.
       *
       * Ids and statuses are kept, so entries, approvals and the audit trail still point at
       * the same periods. A Locked period moves too — its dates were always derived from
       * this rule — but what it contains does not change.
       */
      if ('periodStartDay' in op.patch && settings.periodStartDay !== state.settings.periodStartDay) {
        const periods = restatePeriods(state.periods, settings.periodStartDay)
        for (const period of periods) {
          const before = state.periods.find((p) => p.periodId === period.periodId)
          if (before && (before.startDate !== period.startDate || before.endDate !== period.endDate)) {
            audit('MonthPeriod', period.periodId, 'Dates', `${before.startDate} to ${before.endDate}`, `${period.startDate} to ${period.endDate}`, 'Period start day changed')
          }
        }
        return { state: { ...state, settings, periods }, logs, message: `Settings saved. ${periods.length} periods moved to start on the ${settings.periodStartDay}th.` }
      }

      return { state: { ...state, settings }, logs, message: 'Settings saved.' }
    }

    // --- Department marks, attendance, submitted totals -------------------
    case 'deptMarks.set': {
      const existing = state.departmentMarks.find((m) => m.periodId === op.periodId && m.departmentId === op.departmentId)
      const department = state.departments.find((d) => d.departmentId === op.departmentId)
      const label = department?.name ?? op.departmentId

      const base: DepartmentMarks = existing ?? {
        departmentId: op.departmentId,
        periodId: op.periodId,
        wastePercentHundredths: null,
        variancePercentHundredths: null,
        varianceMarksDirect: null,
        quality: null,
        ehs: null,
        wcm5s: null,
        updatedBy: ctx.actorUserId,
        updatedAt: ctx.now,
      }

      const next: DepartmentMarks = { ...base, ...op.patch, updatedBy: ctx.actorUserId, updatedAt: ctx.now }

      const fields = ['wastePercentHundredths', 'variancePercentHundredths', 'varianceMarksDirect', 'quality', 'ehs', 'wcm5s'] as const
      for (const field of fields) {
        if (str(base[field]) !== str(next[field])) {
          audit('DepartmentMarks', `${op.departmentId}|${op.periodId}`, `${label} — ${field}`, base[field], next[field], op.periodId)
        }
      }
      if (logs.length === 0) return { state, logs: [], message: '' }

      return {
        state: {
          ...state,
          departmentMarks: [
            ...state.departmentMarks.filter((m) => !(m.periodId === op.periodId && m.departmentId === op.departmentId)),
            next,
          ],
        },
        logs,
        message: `${label} marks saved.`,
      }
    }

    case 'attendance.setMany': {
      const byEmp = new Map(state.attendance.filter((a) => a.periodId === op.periodId).map((a) => [a.empId, a]))
      let changed = 0

      for (const row of op.rows) {
        const before = byEmp.get(row.empId)
        if (str(before?.daysAbsent ?? null) === str(row.daysAbsent)) continue
        changed += 1
        audit('Attendance', `${row.empId}|${op.periodId}`, `Days absent — ${employeeLabel(row.empId)}`, before?.daysAbsent ?? '', row.daysAbsent, op.periodId)
        byEmp.set(row.empId, { periodId: op.periodId, empId: row.empId, daysAbsent: row.daysAbsent, updatedBy: ctx.actorUserId, updatedAt: ctx.now })
      }

      if (changed === 0) return { state, logs: [], message: 'Nothing changed.' }

      const kept: AttendanceRecord[] = state.attendance.filter((a) => a.periodId !== op.periodId)
      return {
        state: { ...state, attendance: [...kept, ...byEmp.values()] },
        logs,
        message: `Attendance saved for ${changed} ${changed === 1 ? 'person' : 'people'}.`,
      }
    }

    case 'submittedTotal.setMany': {
      const byEmp = new Map(state.submittedTotals.filter((t) => t.periodId === op.periodId).map((t) => [t.empId, t]))
      let changed = 0

      for (const row of op.rows) {
        const before = byEmp.get(row.empId)
        if (str(before?.total ?? null) === str(row.total)) continue
        changed += 1
        audit('SubmittedTotal', `${row.empId}|${op.periodId}`, `Total /100 — ${employeeLabel(row.empId)}`, before?.total ?? '', row.total, op.periodId)
        byEmp.set(row.empId, { periodId: op.periodId, empId: row.empId, total: row.total, updatedBy: ctx.actorUserId, updatedAt: ctx.now })
      }

      if (changed === 0) return { state, logs: [], message: 'Nothing changed.' }

      const kept: SubmittedTotal[] = state.submittedTotals.filter((t) => t.periodId !== op.periodId)
      return {
        state: { ...state, submittedTotals: [...kept, ...byEmp.values()] },
        logs,
        message: `Totals saved for ${changed} ${changed === 1 ? 'person' : 'people'}.`,
      }
    }

    case 'kpiOverride.set': {
      const previous = state.kpiOverrides.find((o) => o.periodId === op.periodId && o.empId === op.empId && o.kpi === op.kpi)
      const override: KpiOverride = {
        overrideId: previous?.overrideId ?? makeId('KO'),
        periodId: op.periodId,
        empId: op.empId,
        kpi: op.kpi,
        value: op.value,
        reason: op.reason,
        grantedBy: ctx.actorUserId,
        grantedAt: ctx.now,
      }
      audit('MonthOverride', override.overrideId, `${op.kpi} override — ${employeeLabel(op.empId)}, period ${op.periodId}`, previous?.value ?? '', op.value, op.reason)
      return {
        state: {
          ...state,
          kpiOverrides: [...state.kpiOverrides.filter((o) => o.overrideId !== override.overrideId), override],
        },
        logs,
        message: 'Override saved.',
      }
    }

    case 'kpiOverride.clear': {
      const override = state.kpiOverrides.find((o) => o.overrideId === op.overrideId)
      if (!override) return { state, logs: [], message: '' }
      audit('MonthOverride', op.overrideId, `${override.kpi} override removed — ${employeeLabel(override.empId)}`, override.value, '', override.reason)
      return {
        state: { ...state, kpiOverrides: state.kpiOverrides.filter((o) => o.overrideId !== op.overrideId) },
        logs,
        message: 'Override removed.',
      }
    }

    case 'employee.setOutputNotMeasured': {
      const picked = new Set(op.empIds)
      const affected = state.employees.filter((e) => picked.has(e.empId) && e.outputNotMeasured !== op.value)
      if (affected.length === 0) return { state, logs: [], message: 'Nothing changed.' }

      for (const employee of affected) {
        audit('Employee', String(employee.empId), 'Output not measured', employee.outputNotMeasured, op.value, op.reason)
      }
      const ids = new Set(affected.map((e) => e.empId))
      return {
        state: { ...state, employees: state.employees.map((e) => (ids.has(e.empId) ? { ...e, outputNotMeasured: op.value } : e)) },
        logs,
        message: op.value
          ? `${affected.length} set to take the department average.`
          : `${affected.length} back to being scored on their own output.`,
      }
    }

    case 'employee.setDepartment': {
      const picked = new Set(op.empIds)
      const department = state.departments.find((d) => d.departmentId === op.departmentId)
      if (!department) return { state, logs: [], message: '' }

      const affected = state.employees.filter((e) => picked.has(e.empId) && e.departmentId !== op.departmentId)
      if (affected.length === 0) return { state, logs: [], message: 'Nothing changed.' }

      for (const employee of affected) {
        const before = state.departments.find((d) => d.departmentId === employee.departmentId)?.name ?? employee.departmentId
        audit('Employee', String(employee.empId), 'Department', before, department.name)
      }
      const ids = new Set(affected.map((e) => e.empId))
      return {
        state: { ...state, employees: state.employees.map((e) => (ids.has(e.empId) ? { ...e, departmentId: op.departmentId } : e)) },
        logs,
        message: `${affected.length} moved to ${department.name}.`,
      }
    }

    case 'department.upsert': {
      const previous = state.departments.find((d) => d.departmentId === op.department.departmentId)
      if (op.isNew || !previous) {
        audit('Department', op.department.departmentId, 'Department created', '', `${op.department.name} · ${op.department.rateGroup} · ${op.department.scoringMode}`)
        return { state: { ...state, departments: [...state.departments, op.department] }, logs, message: `${op.department.name} added.` }
      }
      for (const field of ['name', 'rateGroup', 'scoringMode', 'active'] as const) {
        if (str(previous[field]) !== str(op.department[field])) {
          audit('Department', op.department.departmentId, field, previous[field], op.department[field])
        }
      }
      if (logs.length === 0) return { state, logs: [], message: '' }
      return {
        state: { ...state, departments: state.departments.map((d) => (d.departmentId === op.department.departmentId ? op.department : d)) },
        logs,
        message: `${op.department.name} updated.`,
      }
    }

    // --- Money ------------------------------------------------------------
    case 'rates.setTable': {
      const current = state.rateTables[state.rateTables.length - 1]
      for (const row of op.table.rows) {
        const before = current?.rows.find((r) => r.siteGroup === row.siteGroup && r.rateGroup === row.rateGroup)
        for (const band of ['B1', 'B2', 'B3'] as const) {
          if (str(before?.[band]) !== str(row[band])) {
            audit('RateTable', op.table.versionId, `${row.siteGroup} · ${row.rateGroup} · ${band}`, before?.[band] ?? '', row[band], op.table.note)
          }
        }
      }
      if (logs.length === 0) return { state, logs: [], message: '' }

      /*
       * A rate change never reaches a locked period: those read their frozen snapshot, so
       * what somebody was already paid cannot be restated by a later revision.
       */
      return {
        state: { ...state, rateTables: [...state.rateTables.filter((t) => t.versionId !== op.table.versionId), op.table] },
        logs,
        message: 'Rate table saved. Locked periods keep the rates they were approved on.',
      }
    }

    case 'rates.setAliases': {
      const before = state.gradeAliases
      const codes = new Set([...Object.keys(before), ...Object.keys(op.aliases)])
      for (const code of codes) {
        if (str(before[code]) !== str(op.aliases[code])) {
          audit('RateTable', 'gradeAliases', `Grade ${code}`, before[code] ?? '', op.aliases[code] ?? '')
        }
      }
      if (logs.length === 0) return { state, logs: [], message: '' }
      return { state: { ...state, gradeAliases: { ...op.aliases } }, logs, message: 'Grade bands saved.' }
    }

    // --- Roster sync ------------------------------------------------------
    case 'sync.setSchedule': {
      audit('Settings', 'rosterSync', 'Weekly roster sync', describeSchedule(state.rosterSync.schedule), describeSchedule(op.schedule))
      return {
        state: { ...state, rosterSync: { ...state.rosterSync, schedule: op.schedule } },
        logs,
        message: op.schedule.enabled ? `Roster sync set to ${describeSchedule(op.schedule).toLowerCase()}.` : 'Weekly roster sync switched off.',
      }
    }

    case 'sync.saveMapping': {
      audit('Settings', 'sapMapping', 'SAP field mapping', state.sapMapping ? 'set' : 'none', 'saved', 'Reused by the scheduled sync')
      return { state: { ...state, sapMapping: op.mapping }, logs, message: '' }
    }

    case 'sync.record': {
      // Only a success moves lastRunAt — a failure must not satisfy this week's slot.
      const next = {
        ...state.rosterSync,
        lastAttemptAt: op.at,
        lastStatus: op.status,
        lastMessage: op.message,
        lastCount: op.count,
        lastRunAt: op.status === 'ok' ? op.at : state.rosterSync.lastRunAt,
      }
      audit('Settings', 'rosterSync', 'Scheduled roster sync', '', op.status === 'ok' ? `${op.count} users` : 'failed', op.message)
      return { state: { ...state, rosterSync: next }, logs, message: '' }
    }

    // --- Demo data --------------------------------------------------------
    case 'demo.setEntries': {
      audit('DailyEntry', 'demo', 'Demo entries generated', `${state.entries.length} rows`, `${op.entries.length} rows`, 'Demo data — not real production')
      return { state: { ...state, entries: op.entries }, logs, message: `${op.entries.length} demo rows generated for the current roster.` }
    }

    case 'demo.clearEntries': {
      if (state.entries.length === 0) return { state, logs: [], message: 'There are no entries to clear.' }
      audit('DailyEntry', 'demo', 'All entries cleared', `${state.entries.length} rows`, '0 rows', 'Cleared from Settings')
      return {
        state: { ...state, entries: [], approvals: [], monthOverrides: [] },
        logs,
        message: 'All entries, approvals and overrides cleared. The roster is untouched.',
      }
    }

    default:
      return { state, logs: [], message: '' }
  }
}

function makeStep(
  periodId: string,
  step: ApprovalStep['step'],
  ctx: WriteContext,
  decision: ApprovalStep['decision'],
  comment: string,
): ApprovalStep {
  return { stepId: makeId('AP'), periodId, step, actorUserId: ctx.actorUserId, decision, comment, timestamp: ctx.now }
}


