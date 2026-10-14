/**
 * What leaves the app for Finance.
 *
 * The two things worth pinning: the column order, because Finance reconciles against the
 * workbook column by column, and that a missing figure exports **blank, never 0**. A zero
 * in the Earned column is a payment decision; a blank is an admission that nobody has
 * supplied the number yet, and the two must not be confused in a payroll file.
 */

import { describe, expect, it } from 'vitest'
import { toHundredths } from './calc'
import { employeeKpiRows, EMPLOYEE_KPI_COLUMNS, exportFilename, scoreCardRows } from './exportRows'
import { DEFAULT_DEPARTMENT_ID } from '../data/masters'
import { buildBaseState } from '../data/seed'
import type { AppState, DailyEntry } from './types'
import { periodKpis, periodPay } from '../store/selectors'
import { applyWrite } from '../store/writes'

const exec = { actorUserId: 'U-EXEC', now: '2026-10-14T09:00:00.000Z' }
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

/** 1295 complete, 2901 missing attendance — so one row is payable and one is not. */
function fixture(): AppState {
  let state = buildBaseState()
  state = applyWrite(state, { kind: 'employee.approveAdd', empIds: state.employees.map((e) => e.empId), comment: '' }, md).state
  state = { ...state, employees: state.employees.filter((e) => [1295, 2901].includes(e.empId)) }
  state = {
    ...state,
    employees: state.employees.map((e) => ({ ...e, grade: 'Technical Executive Level (TE2) (GRD.TE.2)', site: 'Kasur' as const })),
    entries: [entry(1295, 4), entry(2901, 2)],
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
  return applyWrite(state, { kind: 'attendance.setMany', periodId: PERIOD, rows: [{ empId: 1295, daysAbsent: 0 }] }, exec).state
}

const state = fixture()
const pay = periodPay(state, PERIOD)
const departmentName = () => 'Production'
const rows = employeeKpiRows(pay, departmentName)

// ---------------------------------------------------------------------------

describe('the Employee KPI sheet', () => {
  it('uses the workbook’s column order', () => {
    expect(rows[0]).toEqual([
      'Emp Code',
      'Employee Name',
      'Grade',
      'Department',
      'Production Score /20',
      'Waste Score /15',
      'Variance /10',
      'Quality /15',
      'EHS /15',
      'WCM&5S /15',
      'Attendance /10',
      'Total Score',
      'Approved Incentive',
      'Earned Incentive',
    ])
  })

  it('has one row per employee, plus a header and a grand total', () => {
    expect(rows).toHaveLength(pay.length + 2)
  })

  it('carries the figures the screen shows', () => {
    const row = rows.find((candidate) => candidate[0] === 1295)!
    expect(row[4]).toBe(20) // production
    expect(row[5]).toBe(15) // waste
    expect(row[6]).toBe(10) // variance
    expect(row[10]).toBe(10) // attendance
    expect(row[12]).toBe(24750) // approved
    expect(row[13]).toBe(24750) // earned, 100 out of 100
  })

  it('EXPORTS A MISSING FIGURE AS BLANK, NEVER AS ZERO', () => {
    const row = rows.find((candidate) => candidate[0] === 2901)!
    expect(row[10]).toBe('') // attendance never entered
    expect(row[11]).toBe('') // so no total
    expect(row[13]).toBe('') // and no Earned — not 0
  })

  it('still gives an Approved amount for an incomplete row, because the grade is known', () => {
    const row = rows.find((candidate) => candidate[0] === 2901)!
    expect(row[12]).toBe(24750)
  })

  it('totals the rounded Earned column, so the sheet adds up to itself', () => {
    const total = rows[rows.length - 1]
    const earned = rows.slice(1, -1).map((row) => row[13]).filter((value): value is number => typeof value === 'number')
    expect(total[13]).toBe(earned.reduce((sum, value) => sum + value, 0))
  })

  it('labels the grand total row', () => {
    expect(rows[rows.length - 1][0]).toBe('TOTAL')
    expect(rows[rows.length - 1][1]).toBe(`${pay.length} employees`)
  })

  it('names somebody who has not been synced rather than leaving the cell empty', () => {
    const unnamed: AppState = { ...state, employees: state.employees.map((e) => ({ ...e, name: '' })) }
    const out = employeeKpiRows(periodPay(unnamed, PERIOD), departmentName)
    expect(out[1][1]).toBe('Emp 1295')
  })

  it('exports the column count the header promises, on every row', () => {
    for (const row of rows) expect(row).toHaveLength(EMPLOYEE_KPI_COLUMNS.length)
  })
})

describe('the Score Card', () => {
  const kpis = periodKpis(state, PERIOD)
  const dates = ['2026-09-16', '2026-09-17']
  const card = scoreCardRows(kpis, dates, (empId, date) => (date === '2026-09-16' && empId === 1295 ? 20 : null), 15)

  it('puts the days across the top with a period average at the end', () => {
    expect(card[0][0]).toBe('Emp Code')
    expect(card[0]).toHaveLength(2 + dates.length + 1)
    expect(card[0][card[0].length - 1]).toBe('Period Avg /20')
  })

  it('leaves a day with no score blank rather than zero', () => {
    const row = card.find((candidate) => candidate[0] === 1295)!
    expect(row[2]).toBe(20)
    expect(row[3]).toBe('')
  })

  it('ends with the department average row', () => {
    const last = card[card.length - 1]
    expect(last[0]).toBe('DEPARTMENT AVERAGE')
    expect(last[last.length - 1]).toBe(15)
  })

  it('keeps every row the same width as the header', () => {
    for (const row of card) expect(row).toHaveLength(card[0].length)
  })
})

describe('filenames', () => {
  it('names the period', () => {
    expect(exportFilename('DIC-employee-kpi', { periodId: '2026-09', label: '', startDate: '', endDate: '', status: 'Open' })).toBe(
      'DIC-employee-kpi-2026-09',
    )
  })
})
