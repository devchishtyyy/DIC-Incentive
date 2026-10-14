/**
 * Assembling one employee's seven KPIs for a period.
 *
 * The four cases the brief names, plus the one that would be dangerous to get wrong: an
 * employee with no production rows and no flag must **block**, not quietly take the
 * department average. If that leaked through, a month where somebody's entries were simply
 * forgotten would pay out as if it had been a normal month.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { attendanceMarks, toHundredths } from '../domain/calc'
import { buildBaseState } from '../data/seed'
import { DEFAULT_DEPARTMENT_ID } from '../data/masters'
import type { AppState, DailyEntry } from '../domain/types'
import { checklistComplete, monthChecklist, periodBlockers, periodKpis } from './selectors'
import { applyWrite } from './writes'

const exec = { actorUserId: 'U-EXEC', now: '2026-10-14T09:00:00.000Z' }
const md = { actorUserId: 'U-MD', now: '2026-10-14T09:00:00.000Z' }
const PERIOD = '2026-09'

function entry(empId: number, date: string, target: number, actual: number): DailyEntry {
  return {
    entryId: `E-${empId}-${date}`,
    periodId: PERIOD,
    date,
    empId,
    pointId: 'PT-GRINDING',
    target,
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

/** Two measured people on 20 and 10, so the department average is a round 15. */
function stateWithMarks(): AppState {
  let state = buildBaseState()

  // Everyone has to be approved before they reach the roll-up at all.
  state = applyWrite(state, { kind: 'employee.approveAdd', empIds: state.employees.map((e) => e.empId), comment: '' }, md).state

  // Keep three people; the rest would only add noise.
  state = { ...state, employees: state.employees.filter((e) => [1295, 2901, 2902].includes(e.empId)) }

  state = {
    ...state,
    entries: [
      entry(1295, '2026-09-16', 4, 4), // 20
      entry(2901, '2026-09-16', 4, 2), // 10
    ],
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
        wcm5s: 13.5,
      },
    },
    exec,
  ).state

  return applyWrite(
    state,
    {
      kind: 'attendance.setMany',
      periodId: PERIOD,
      rows: [
        { empId: 1295, daysAbsent: 2 },
        { empId: 2901, daysAbsent: 0 },
        { empId: 2902, daysAbsent: 0 },
      ],
    },
    exec,
  ).state
}

let state: AppState
beforeEach(() => {
  state = stateWithMarks()
})

const rowFor = (s: AppState, empId: number) => periodKpis(s, PERIOD).find((row) => row.employee.empId === empId)!

// ---------------------------------------------------------------------------

describe('department marks reach every employee in the department', () => {
  it('converts the waste percentage through the table', () => {
    expect(rowFor(state, 1295).marks.waste).toBe(15)
  })

  it('converts the variance percentage through the table', () => {
    expect(rowFor(state, 1295).marks.variance).toBe(10)
  })

  it('passes quality, EHS and WCM through as entered', () => {
    const marks = rowFor(state, 1295).marks
    expect(marks.quality).toBe(15)
    expect(marks.ehs).toBe(15)
    expect(marks.wcm5s).toBe(13.5)
  })

  it('gives everybody in the department the same five figures', () => {
    const a = rowFor(state, 1295).marks
    const b = rowFor(state, 2901).marks
    expect([a.waste, a.variance, a.quality, a.ehs, a.wcm5s]).toEqual([b.waste, b.variance, b.quality, b.ehs, b.wcm5s])
  })

  it('prefers variance marks entered directly over the percentage', () => {
    const direct = applyWrite(
      state,
      { kind: 'deptMarks.set', periodId: PERIOD, departmentId: DEFAULT_DEPARTMENT_ID, patch: { varianceMarksDirect: 4 } },
      exec,
    ).state
    expect(rowFor(direct, 1295).marks.variance).toBe(4)
  })
})

describe('attendance', () => {
  it('turns days absent into marks', () => {
    expect(rowFor(state, 1295).marks.attendance).toBeCloseTo(attendanceMarks(2)!, 12)
    expect(rowFor(state, 2901).marks.attendance).toBe(10)
  })

  it('blocks sign-off while it is blank', () => {
    const blank = applyWrite(state, { kind: 'attendance.setMany', periodId: PERIOD, rows: [{ empId: 1295, daysAbsent: null }] }, exec).state
    expect(rowFor(blank, 1295).blockers.join(' ')).toContain('Days absent')
    expect(rowFor(blank, 1295).total).toBeNull()
  })

  it('treats 0 as entered, not as blank', () => {
    expect(rowFor(state, 2901).blockers.join(' ')).not.toContain('Days absent')
    expect(rowFor(state, 2901).marks.attendance).toBe(10)
  })
})

describe('people with no production rows', () => {
  it('BLOCKS when they are not flagged — a forgotten month must not pay out', () => {
    const row = rowFor(state, 2902)
    expect(row.ownProduction).toBeNull()
    expect(row.usedDepartmentAverage).toBe(false)
    expect(row.blockers.join(' ')).toContain('not flagged as unmeasured')
    expect(row.total).toBeNull()
  })

  it('takes the department average once flagged', () => {
    const flagged = applyWrite(
      state,
      { kind: 'employee.setOutputNotMeasured', empIds: [2902], value: true, reason: 'No Point — stores duty' },
      exec,
    ).state

    const row = rowFor(flagged, 2902)
    expect(row.usedDepartmentAverage).toBe(true)
    // 1295 scored 20 and 2901 scored 10, so the average is 15.
    expect(row.marks.production).toBe(15)
    expect(row.blockers).toEqual([])
  })

  it('is never counted into the average it borrows', () => {
    const flagged = applyWrite(
      state,
      { kind: 'employee.setOutputNotMeasured', empIds: [2902], value: true, reason: 'No Point' },
      exec,
    ).state
    // Still 15: including the borrower would drag it towards itself.
    expect(rowFor(flagged, 2902).marks.production).toBe(15)
    expect(rowFor(flagged, 1295).marks.production).toBe(20)
  })

  it('says so when the whole department is unmeasured, rather than inventing a score', () => {
    const none: AppState = { ...state, entries: [] }
    const flagged = applyWrite(
      none,
      { kind: 'employee.setOutputNotMeasured', empIds: [1295, 2901, 2902], value: true, reason: 'test' },
      exec,
    ).state
    const row = rowFor(flagged, 2902)
    expect(row.marks.production).toBeNull()
    expect(row.blockers.join(' ')).toContain('nobody in the department was measured')
  })

  it('is off for everybody until somebody sets it', () => {
    expect(buildBaseState().employees.every((employee) => employee.outputNotMeasured === false)).toBe(true)
  })

  it('audits the flag with the reason', () => {
    const result = applyWrite(state, { kind: 'employee.setOutputNotMeasured', empIds: [2902], value: true, reason: 'Stores duty' }, exec)
    expect(result.logs).toHaveLength(1)
    expect(result.logs[0].reason).toBe('Stores duty')
    expect(result.logs[0].newValue).toBe('true')
  })
})

describe('the total', () => {
  it('reaches the brief’s worked figure for employee 1295', () => {
    // Production here is a clean 20 rather than the brief's 19.695455, so the total is
    // 20 + 15 + 10 + 15 + 15 + 13.5 + 9.230769 — the arithmetic, not the example's inputs.
    const row = rowFor(state, 1295)
    expect(row.total).toBeCloseTo(20 + 15 + 10 + 15 + 15 + 13.5 + attendanceMarks(2)!, 10)
  })

  it('is null while any KPI is missing', () => {
    const noQuality = applyWrite(
      state,
      { kind: 'deptMarks.set', periodId: PERIOD, departmentId: DEFAULT_DEPARTMENT_ID, patch: { quality: null } },
      exec,
    ).state
    expect(rowFor(noQuality, 1295).total).toBeNull()
    expect(rowFor(noQuality, 1295).missing).toContain('quality')
  })

  it('never produces NaN, whatever is missing', () => {
    const bare = buildBaseState()
    for (const row of periodKpis(bare, PERIOD)) {
      expect(row.total === null || Number.isFinite(row.total)).toBe(true)
    }
  })
})

describe('per-employee overrides', () => {
  it('replaces one KPI for one person, leaving the rest of the department alone', () => {
    const overridden = applyWrite(
      state,
      { kind: 'kpiOverride.set', periodId: PERIOD, empId: 1295, kpi: 'wcm5s', value: 15, reason: 'Led the 5S audit' },
      exec,
    ).state

    expect(rowFor(overridden, 1295).marks.wcm5s).toBe(15)
    expect(rowFor(overridden, 2901).marks.wcm5s).toBe(13.5)
  })

  it('carries the reason into the audit', () => {
    const result = applyWrite(
      state,
      { kind: 'kpiOverride.set', periodId: PERIOD, empId: 1295, kpi: 'ehs', value: 10, reason: 'Near-miss not reported' },
      exec,
    )
    expect(result.logs[0].reason).toBe('Near-miss not reported')
  })

  it('can fill a KPI the department never set', () => {
    const noQuality = applyWrite(
      state,
      { kind: 'deptMarks.set', periodId: PERIOD, departmentId: DEFAULT_DEPARTMENT_ID, patch: { quality: null } },
      exec,
    ).state
    const fixed = applyWrite(
      noQuality,
      { kind: 'kpiOverride.set', periodId: PERIOD, empId: 1295, kpi: 'quality', value: 12, reason: 'Assessed separately' },
      exec,
    ).state
    expect(rowFor(fixed, 1295).marks.quality).toBe(12)
  })

  it('is removable, and the department figure comes back', () => {
    const overridden = applyWrite(
      state,
      { kind: 'kpiOverride.set', periodId: PERIOD, empId: 1295, kpi: 'wcm5s', value: 15, reason: 'test' },
      exec,
    )
    const cleared = applyWrite(overridden.state, { kind: 'kpiOverride.clear', overrideId: overridden.state.kpiOverrides[0].overrideId }, exec).state
    expect(rowFor(cleared, 1295).marks.wcm5s).toBe(13.5)
  })
})

describe('what stands between the period and sign-off', () => {
  it('names the people and the reasons', () => {
    const blockers = periodBlockers(state, PERIOD)
    expect(blockers.map((b) => b.empId)).toEqual([2902])
  })

  it('is empty once everything is supplied', () => {
    const flagged = applyWrite(state, { kind: 'employee.setOutputNotMeasured', empIds: [2902], value: true, reason: 'test' }, exec).state
    expect(periodBlockers(flagged, PERIOD)).toEqual([])
  })
})

// ---------------------------------------------------------------------------

describe('departments that submit one total instead', () => {
  const MAINT = 'DEP-MAINT'

  function withMaintenance(): AppState {
    const base = stateWithMarks()
    return applyWrite(base, { kind: 'employee.setDepartment', empIds: [2902], departmentId: MAINT }, exec).state
  }

  it('does not ask them for the KPI breakdown', () => {
    const moved = withMaintenance()
    const row = rowFor(moved, 2902)
    expect(row.mode).toBe('submittedTotal')
    expect(row.marks.waste).toBeNull()
    expect(row.marks.attendance).toBeNull()
    expect(row.missing).toEqual([])
  })

  it('blocks until the total is entered, and says only that', () => {
    const moved = withMaintenance()
    expect(rowFor(moved, 2902).blockers).toEqual(['Total out of 100 not entered.'])
  })

  it('reaches a total from the submitted figure', () => {
    const moved = withMaintenance()
    const scored = applyWrite(moved, { kind: 'submittedTotal.setMany', periodId: PERIOD, rows: [{ empId: 2902, total: 92 }] }, exec).state
    const row = rowFor(scored, 2902)
    expect(row.total).toBe(92)
    expect(row.blockers).toEqual([])
  })

  it('takes the figures the workbook used last period', () => {
    let moved = withMaintenance()
    for (const total of [92, 95, 90, 90, 91, 81]) {
      const scored = applyWrite(moved, { kind: 'submittedTotal.setMany', periodId: PERIOD, rows: [{ empId: 2902, total }] }, exec).state
      expect(rowFor(scored, 2902).total).toBe(total)
      moved = scored
    }
  })

  it('refuses a total outside 0 to 100 rather than paying on it', () => {
    const moved = withMaintenance()
    for (const total of [-1, 101, 1000]) {
      const scored = applyWrite(moved, { kind: 'submittedTotal.setMany', periodId: PERIOD, rows: [{ empId: 2902, total }] }, exec).state
      expect(rowFor(scored, 2902).total, String(total)).toBeNull()
    }
  })

  it('counts 0 as a real total, because it is one', () => {
    const moved = withMaintenance()
    const scored = applyWrite(moved, { kind: 'submittedTotal.setMany', periodId: PERIOD, rows: [{ empId: 2902, total: 0 }] }, exec).state
    expect(rowFor(scored, 2902).total).toBe(0)
    expect(rowFor(scored, 2902).blockers).toEqual([])
  })

  it('leaves the computed department untouched by its existence', () => {
    const before = rowFor(stateWithMarks(), 1295).total
    const after = rowFor(withMaintenance(), 1295).total
    expect(after).toBe(before)
  })

  it('is kept out of the production average it is not part of', () => {
    // 2902 has no rows. Moving them to a submitted-total department must not change the
    // Production average, which is still 1295 on 20 and 2901 on 10.
    const moved = withMaintenance()
    const flagged = applyWrite(moved, { kind: 'employee.setOutputNotMeasured', empIds: [2901], value: false, reason: 'test' }, exec).state
    expect(rowFor(flagged, 1295).marks.production).toBe(20)
  })

  it('audits the move between departments', () => {
    const result = applyWrite(stateWithMarks(), { kind: 'employee.setDepartment', empIds: [2902], departmentId: MAINT }, exec)
    expect(result.logs).toHaveLength(1)
    expect(result.logs[0].oldValue).toBe('Production')
    expect(result.logs[0].newValue).toBe('Maintenance')
  })

  it('both modes end at the same kind of total, so everything after them is single-path', () => {
    const moved = withMaintenance()
    const scored = applyWrite(moved, { kind: 'submittedTotal.setMany', periodId: PERIOD, rows: [{ empId: 2902, total: 92 }] }, exec).state
    const flagged = applyWrite(scored, { kind: 'employee.setOutputNotMeasured', empIds: [2902], value: false, reason: 'test' }, exec).state

    for (const row of periodKpis(flagged, PERIOD)) {
      expect(row.total === null || (Number.isFinite(row.total) && row.total >= 0 && row.total <= 100), String(row.employee.empId)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------

describe('the month-end checklist actually blocks', () => {
  const period = () => buildBaseState().periods.find((p) => p.periodId === PERIOD)!
  const TODAY = '2026-10-14'

  it('is not green while somebody has no production rows and no flag', () => {
    const items = monthChecklist(state, period(), TODAY)
    const item = items.find((i) => i.label === 'Everybody has a Production Score')!
    expect(item.ok).toBe(false)
    expect(item.detail).toContain('2902')
    expect(checklistComplete(items)).toBe(false)
  })

  it('goes green once they are flagged', () => {
    const flagged = applyWrite(state, { kind: 'employee.setOutputNotMeasured', empIds: [2902], value: true, reason: 'No Point' }, exec).state
    const item = monthChecklist(flagged, period(), TODAY).find((i) => i.label === 'Everybody has a Production Score')!
    expect(item.ok).toBe(true)
  })

  it('is not green while days absent is blank for anybody', () => {
    const blank = applyWrite(state, { kind: 'attendance.setMany', periodId: PERIOD, rows: [{ empId: 1295, daysAbsent: null }] }, exec).state
    const item = monthChecklist(blank, period(), TODAY).find((i) => i.label === 'Days absent entered')!
    expect(item.ok).toBe(false)
    expect(item.detail).toContain('1295')
  })

  it('counts a zero as entered', () => {
    const item = monthChecklist(state, period(), TODAY).find((i) => i.label === 'Days absent entered')!
    // 1295 is on 2 days and the others on 0; none is blank.
    expect(item.ok).toBe(true)
  })

  it('is not green while a department has no marks', () => {
    const cleared = applyWrite(
      state,
      { kind: 'deptMarks.set', periodId: PERIOD, departmentId: DEFAULT_DEPARTMENT_ID, patch: { quality: null } },
      exec,
    ).state
    const item = monthChecklist(cleared, period(), TODAY).find((i) => i.label === 'Department marks entered')!
    expect(item.ok).toBe(false)
  })

  it('asks for submitted totals only when a department actually submits one', () => {
    const withoutAny = monthChecklist(state, period(), TODAY)
    expect(withoutAny.some((i) => i.label === 'Submitted totals entered')).toBe(false)

    const moved = applyWrite(state, { kind: 'employee.setDepartment', empIds: [2902], departmentId: 'DEP-MAINT' }, exec).state
    const withOne = monthChecklist(moved, period(), TODAY)
    expect(withOne.find((i) => i.label === 'Submitted totals entered')!.ok).toBe(false)
  })

  it('still says something sensible when nobody is on the list', () => {
    const empty: AppState = { ...state, employees: [] }
    expect(checklistComplete(monthChecklist(empty, period(), TODAY))).toBe(true)
  })
})
