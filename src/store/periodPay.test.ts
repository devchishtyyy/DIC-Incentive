/**
 * Pay, and the one guarantee a locked period has to make.
 *
 * Locking stops the scores moving. It also has to stop the *money* moving, and that is a
 * separate problem: Approved comes from a rate table that gets revised, so recomputing a
 * locked period against a newer sheet would silently restate what somebody was already
 * paid. These tests exist mostly to pin that down.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { toHundredths } from '../domain/calc'
import { RATE_TABLE_2025 } from '../domain/rates'
import { DEFAULT_DEPARTMENT_ID } from '../data/masters'
import { buildBaseState } from '../data/seed'
import type { AppState, DailyEntry } from '../domain/types'
import { currentRateTable, periodPay, periodPayTotal } from './selectors'
import { applyWrite } from './writes'

const exec = { actorUserId: 'U-EXEC', now: '2026-10-14T09:00:00.000Z' }
const hod = { actorUserId: 'U-HOD', now: '2026-10-14T10:00:00.000Z' }
const ops = { actorUserId: 'U-OPS', now: '2026-10-14T11:00:00.000Z' }
const md = { actorUserId: 'U-MD', now: '2026-10-14T08:00:00.000Z' }
const PERIOD = '2026-09'

function entry(empId: number, actual: number): DailyEntry {
  return {
    entryId: `E-${empId}`,
    periodId: PERIOD,
    date: '2026-09-16',
    empId,
    pointId: 'PT-GRINDING',
    target: 4,
    actualBatches: actual,
    scoreOverride: null,
    overrideReason: null,
    acknowledgedWarnings: [],
    status: 'Draft',
    enteredBy: 'U-EXEC',
    enteredAt: exec.now,
    updatedBy: null,
    updatedAt: null,
  }
}

/** Two people, full marks everywhere, so Earned is easy to reason about. */
function ready(): AppState {
  let state = buildBaseState()
  state = applyWrite(state, { kind: 'employee.approveAdd', empIds: state.employees.map((e) => e.empId), comment: '' }, md).state
  state = { ...state, employees: state.employees.filter((e) => [1295, 2901].includes(e.empId)) }

  // Give them the real grades SAP returns, so banding is exercised end to end.
  state = {
    ...state,
    employees: state.employees.map((employee) =>
      employee.empId === 1295
        ? { ...employee, grade: 'Technical Executive Level (TE2) (GRD.TE.2)', site: 'Kasur' as const }
        : { ...employee, grade: 'Hourly Worker Level (P3) (GRD.PIII)', site: 'Kasur' as const },
    ),
    entries: [entry(1295, 4), entry(2901, 4)],
  }

  state = applyWrite(
    state,
    {
      kind: 'deptMarks.set',
      periodId: PERIOD,
      departmentId: DEFAULT_DEPARTMENT_ID,
      patch: {
        wastePercentHundredths: toHundredths(2.83),
        variancePercentHundredths: toHundredths(5),
        varianceMarksDirect: null,
        quality: 15,
        ehs: 15,
        wcm5s: 15,
      },
    },
    exec,
  ).state

  return applyWrite(
    state,
    { kind: 'attendance.setMany', periodId: PERIOD, rows: [{ empId: 1295, daysAbsent: 0 }, { empId: 2901, daysAbsent: 0 }] },
    exec,
  ).state
}

function lock(state: AppState): AppState {
  let next = applyWrite(state, { kind: 'month.submit', periodId: PERIOD, comment: '' }, exec).state
  next = applyWrite(next, { kind: 'month.hodSign', periodId: PERIOD, decision: 'Signed', comment: '' }, hod).state
  return applyWrite(next, { kind: 'month.opsDecision', periodId: PERIOD, decision: 'Approved', comment: '' }, ops).state
}

const rowFor = (s: AppState, empId: number) => periodPay(s, PERIOD).find((row) => row.employee.empId === empId)!

let state: AppState
beforeEach(() => {
  state = ready()
})

// ---------------------------------------------------------------------------

describe('approved amounts come off the rate table', () => {
  it('bands a TE2 at Kasur Production as B3', () => {
    const row = rowFor(state, 1295)
    expect(row.band).toBe('B3')
    expect(row.approved).toBe(24750)
  })

  it('bands a PIII as B2', () => {
    const row = rowFor(state, 2901)
    expect(row.band).toBe('B2')
    expect(row.approved).toBe(24100)
  })

  it('pays 100 out of 100 as the full approved amount', () => {
    expect(rowFor(state, 1295).total).toBe(100)
    expect(rowFor(state, 1295).earned).toBe(24750)
  })

  it('follows the department rate group', () => {
    const moved = applyWrite(state, { kind: 'employee.setDepartment', empIds: [1295], departmentId: 'DEP-TECH' }, exec).state
    // Technical is a Support department, and submits a total rather than computing one.
    expect(rowFor(moved, 1295).approved).toBe(23800)
  })

  it('refuses to pay on a grade it cannot band', () => {
    const odd: AppState = {
      ...state,
      employees: state.employees.map((e) => (e.empId === 1295 ? { ...e, grade: 'Chief Mystery Officer' } : e)),
    }
    const row = rowFor(odd, 1295)
    expect(row.approved).toBeNull()
    expect(row.earned).toBeNull()
    expect(row.approvedProblem).toContain('grade alias table')
  })

  it('is fixed by an alias, with no code change', () => {
    const odd: AppState = {
      ...state,
      employees: state.employees.map((e) => (e.empId === 1295 ? { ...e, grade: 'Shift Lead (TE5) (GRD.TE.5)' } : e)),
    }
    const fixed = applyWrite(odd, { kind: 'rates.setAliases', aliases: { ...odd.gradeAliases, TE5: 'B3' } }, md).state
    expect(rowFor(fixed, 1295).approved).toBe(24750)
  })
})

describe('a per-employee approved override', () => {
  it('replaces the rate-table amount', () => {
    const overridden = applyWrite(
      state,
      { kind: 'kpiOverride.set', periodId: PERIOD, empId: 1295, kpi: 'approved', value: 20000, reason: 'Transferred from Karachi mid-period' },
      md,
    ).state

    const row = rowFor(overridden, 1295)
    expect(row.approved).toBe(20000)
    expect(row.rateAmount).toBe(24750)
    expect(row.approvedOverridden).toBe(true)
    expect(row.earned).toBe(20000)
  })

  it('carries its reason into the audit', () => {
    const result = applyWrite(
      state,
      { kind: 'kpiOverride.set', periodId: PERIOD, empId: 1295, kpi: 'approved', value: 20000, reason: 'Kasur transfer' },
      md,
    )
    expect(result.logs[0].reason).toBe('Kasur transfer')
  })

  it('leaves everybody else on the table rate', () => {
    const overridden = applyWrite(
      state,
      { kind: 'kpiOverride.set', periodId: PERIOD, empId: 1295, kpi: 'approved', value: 20000, reason: 'test' },
      md,
    ).state
    expect(rowFor(overridden, 2901).approved).toBe(24100)
  })
})

describe('the period total', () => {
  it('is the sum of the rounded amounts', () => {
    const rows = periodPay(state, PERIOD)
    expect(periodPayTotal(state, PERIOD)).toBe(rows.reduce((sum, row) => sum + (row.earned ?? 0), 0))
  })

  it('is whole rupees', () => {
    expect(Number.isInteger(periodPayTotal(state, PERIOD))).toBe(true)
  })
})

describe('locking freezes the money', () => {
  it('writes a snapshot naming the rate version', () => {
    const locked = lock(state)
    const snapshot = locked.periodSnapshots.find((s) => s.periodId === PERIOD)!
    expect(snapshot.rateVersionId).toBe(RATE_TABLE_2025.versionId)
    expect(snapshot.rows).toHaveLength(2)
  })

  it('audits what was frozen', () => {
    let next = applyWrite(state, { kind: 'month.submit', periodId: PERIOD, comment: '' }, exec).state
    next = applyWrite(next, { kind: 'month.hodSign', periodId: PERIOD, decision: 'Signed', comment: '' }, hod).state
    const result = applyWrite(next, { kind: 'month.opsDecision', periodId: PERIOD, decision: 'Approved', comment: '' }, ops)
    const frozen = result.logs.find((log) => log.field === 'Incentive frozen')!
    expect(frozen.newValue).toContain('PKR')
    expect(frozen.newValue).toContain(RATE_TABLE_2025.versionId)
  })

  it('A LATER RATE EDIT NEVER CHANGES A LOCKED PERIOD', () => {
    const locked = lock(state)
    const before = rowFor(locked, 1295).earned

    const raised = applyWrite(
      locked,
      {
        kind: 'rates.setTable',
        table: {
          ...RATE_TABLE_2025,
          versionId: 'RATE-2027',
          effectiveFrom: '2027-01-01',
          rows: RATE_TABLE_2025.rows.map((row) => ({ ...row, B1: row.B1 * 2, B2: row.B2 * 2, B3: row.B3 * 2 })),
        },
      },
      md,
    ).state

    expect(currentRateTable(raised).versionId).toBe('RATE-2027')
    expect(rowFor(raised, 1295).earned).toBe(before)
    expect(rowFor(raised, 1295).approved).toBe(24750)
  })

  it('applies the new rates to a period that is still open', () => {
    const raised = applyWrite(
      state,
      {
        kind: 'rates.setTable',
        table: {
          ...RATE_TABLE_2025,
          versionId: 'RATE-2027',
          effectiveFrom: '2027-01-01',
          rows: RATE_TABLE_2025.rows.map((row) => ({ ...row, B1: row.B1 * 2, B2: row.B2 * 2, B3: row.B3 * 2 })),
        },
      },
      md,
    ).state
    expect(rowFor(raised, 1295).approved).toBe(49500)
  })

  it('keeps the frozen total even if the marks are somehow changed underneath', () => {
    const locked = lock(state)
    const before = rowFor(locked, 1295).total

    const meddled: AppState = { ...locked, entries: locked.entries.map((e) => ({ ...e, actualBatches: 1 })) }
    expect(rowFor(meddled, 1295).total).toBe(before)
  })

  it('discards the snapshot on reopen, so the period is live again', () => {
    const locked = lock(state)
    const reopened = applyWrite(locked, { kind: 'month.reopen', periodId: PERIOD, reason: 'Correction needed' }, ops).state

    expect(reopened.periodSnapshots.find((s) => s.periodId === PERIOD)).toBeUndefined()

    const meddled: AppState = { ...reopened, entries: reopened.entries.map((e) => ({ ...e, actualBatches: 2 })) }
    expect(rowFor(meddled, 1295).total).toBeLessThan(100)
  })

  it('says in the audit that the frozen figures were discarded', () => {
    const locked = lock(state)
    const result = applyWrite(locked, { kind: 'month.reopen', periodId: PERIOD, reason: 'Correction' }, ops)
    expect(result.logs.some((log) => log.field === 'Frozen incentive discarded')).toBe(true)
  })
})

describe('what is deliberately not applied', () => {
  it('does not halve a probationer — DIC has not confirmed that it happens today', () => {
    const probation: AppState = {
      ...state,
      employees: state.employees.map((e) => (e.empId === 1295 ? { ...e, status: 'Probation' as const } : e)),
    }
    expect(rowFor(probation, 1295).earned).toBe(24750)
  })

  it('does not prorate a mid-period joiner, for the same reason', () => {
    const joiner: AppState = {
      ...state,
      employees: state.employees.map((e) => (e.empId === 1295 ? { ...e, joinDate: '2026-10-01' } : e)),
    }
    expect(rowFor(joiner, 1295).earned).toBe(24750)
  })
})
