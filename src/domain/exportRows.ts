/**
 * The two sheets that leave the app.
 *
 * Both are built here, from the same selectors the screens read, so an export can never
 * disagree with what somebody just looked at — the first invariant. The column order is
 * the Employee KPI sheet's, because Finance reconciles against it column by column.
 */

import type { CellValue } from './exporters'
import { round } from './calc'
import { formatDate } from './dates'
import type { PeriodKpiRow, PeriodPayRow } from '../store/selectors'
import type { IsoDate, MonthPeriod } from './types'

/** Blank, not zero — a missing figure must not read as a measured nought. */
function cell(value: number | null | undefined, decimals = 2): CellValue {
  return value === null || value === undefined || !Number.isFinite(value) ? '' : round(value, decimals)
}

export const EMPLOYEE_KPI_COLUMNS = [
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
] as const

/**
 * The Employee KPI sheet, plus a grand total row.
 *
 * The grand total is the sum of the **rounded** Earned column, which is what the rows
 * themselves add up to and what payroll pays. Rounding once at the bottom instead would
 * leave the total a rupee or two away from its own column.
 */
export function employeeKpiRows(rows: PeriodPayRow[], departmentName: (id: string) => string): CellValue[][] {
  const body = rows.map((row) => [
    row.employee.empId,
    row.employee.name.trim() || `Emp ${row.employee.empId}`,
    row.employee.grade || '',
    departmentName(row.employee.departmentId),
    cell(row.marks.production),
    cell(row.marks.waste),
    cell(row.marks.variance),
    cell(row.marks.quality),
    cell(row.marks.ehs),
    cell(row.marks.wcm5s),
    cell(row.marks.attendance),
    cell(row.total),
    cell(row.approved, 0),
    cell(row.earned, 0),
  ])

  const earnedTotal = rows.reduce((sum, row) => sum + (row.earned ?? 0), 0)
  const approvedTotal = rows.reduce((sum, row) => sum + (row.approved ?? 0), 0)

  const total: CellValue[] = [
    'TOTAL',
    `${rows.length} employees`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    approvedTotal,
    earnedTotal,
  ]

  return [[...EMPLOYEE_KPI_COLUMNS], ...body, total]
}

/**
 * The Score Card: employees down, working days across, with a period average column and a
 * department average row — the shape of the workbook sheet it replaces.
 */
export function scoreCardRows(
  rows: PeriodKpiRow[],
  dates: IsoDate[],
  dayScore: (empId: number, date: IsoDate) => number | null,
  departmentAverageScore: number | null,
): CellValue[][] {
  const header: CellValue[] = ['Emp Code', 'Employee Name', ...dates.map((date) => formatDate(date)), 'Period Avg /20']

  const body = rows.map((row) => [
    row.employee.empId,
    row.employee.name.trim() || `Emp ${row.employee.empId}`,
    ...dates.map((date) => cell(dayScore(row.employee.empId, date))),
    cell(row.marks.production),
  ])

  const average: CellValue[] = [
    'DEPARTMENT AVERAGE',
    '',
    ...dates.map(() => ''),
    cell(departmentAverageScore),
  ]

  return [header, ...body, average]
}

export function exportFilename(stem: string, period: MonthPeriod): string {
  return `${stem}-${period.periodId}`
}
