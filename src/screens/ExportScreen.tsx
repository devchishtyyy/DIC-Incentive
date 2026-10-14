/**
 * Screen 7 — Export to Finance.
 *
 * Two sheets: the Employee KPI sheet, which is what Finance reconciles and pays from, and
 * the Score Card, which is the daily working behind the Production column.
 *
 * Both are built from the same selectors the screens read, so an export can never disagree
 * with what somebody just looked at. An approved period exports its frozen figures; an
 * unapproved one can still be exported as a draft, clearly labelled, because the month-end
 * conversation usually starts before the sign-off does.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { calcEmployeeDay, departmentAverage } from '../domain/calc'
import { formatRupees, formatScore } from '../domain/format'
import { downloadCsv, downloadXlsx, type CellValue } from '../domain/exporters'
import { employeeKpiRows, EMPLOYEE_KPI_COLUMNS, exportFilename, scoreCardRows } from '../domain/exportRows'
import type { IsoDate } from '../domain/types'
import { useApp } from '../store/AppStore'
import { periodKpis, periodPay, periodPayTotal, periodWorkingDays, selectEntries } from '../store/selectors'
import { EmptyState, GuardedButton, Icon, InfoNote, PageHeader, PeriodBadge, WarnNote } from '../components/ui'

export default function ExportScreen() {
  const { state, period, allow } = useApp()

  const pay = useMemo(() => periodPay(state, period.periodId), [state, period.periodId])
  const kpis = useMemo(() => periodKpis(state, period.periodId), [state, period.periodId])
  const dates = useMemo(() => periodWorkingDays(state, period), [state, period])

  const departmentName = (departmentId: string) =>
    state.departments.find((d) => d.departmentId === departmentId)?.name ?? departmentId

  const kpiData = useMemo(() => employeeKpiRows(pay, departmentName), [pay, state.departments])

  const dayScoreFor = useMemo(() => {
    const entries = selectEntries(state, { periodId: period.periodId })
    const byKey = new Map<string, number | null>()
    for (const entry of entries) {
      const key = `${entry.empId}|${entry.date}`
      if (!byKey.has(key)) {
        byKey.set(key, calcEmployeeDay(entries.filter((e) => e.empId === entry.empId && e.date === entry.date), state.settings))
      }
    }
    return (empId: number, date: IsoDate) => byKey.get(`${empId}|${date}`) ?? null
  }, [state, period.periodId])

  const departmentMean = useMemo(
    () => departmentAverage(kpis.filter((row) => !row.usedDepartmentAverage).map((row) => row.marks.production)),
    [kpis],
  )

  const scoreCardData = useMemo(
    () => scoreCardRows(kpis, dates, dayScoreFor, departmentMean),
    [kpis, dates, dayScoreFor, departmentMean],
  )

  const downloadDecision = allow('export.download')
  const approved = period.status === 'Locked'
  const payable = periodPayTotal(state, period.periodId)
  const incomplete = pay.filter((row) => row.total === null).length

  return (
    <>
      <PageHeader
        title="Export to Finance"
        subtitle={`${period.label} · ${pay.length} employees · ${formatRupees(payable)} payable`}
        actions={<PeriodBadge status={period.status} />}
      />

      {!approved && (
        <div className="mb-4">
          <WarnNote>
            This period is <strong>{period.status}</strong>, not approved. Anything exported now is a draft and the figures
            can still move. Finance should wait for the Operations Manager to approve and lock it.
          </WarnNote>
        </div>
      )}

      {incomplete > 0 && (
        <div className="mb-4">
          <WarnNote>
            {incomplete} {incomplete === 1 ? 'employee has' : 'employees have'} no total yet, so no Earned amount. They
            export with blank cells rather than zeros — see <Link to="/month-end" className="link">Review &amp; sign-off</Link> for
            what is missing.
          </WarnNote>
        </div>
      )}

      {approved && (
        <div className="mb-4">
          <InfoNote>
            These are the figures frozen when the month was locked, including the rate version in force at the time. A
            later rate change does not alter them.
          </InfoNote>
        </div>
      )}

      {/* --- The two sheets --------------------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SheetCard
          title="Employee KPI sheet"
          body="The seven KPIs, the total, Approved and Earned, with a grand total row. This is what Finance pays from."
          columns={`${EMPLOYEE_KPI_COLUMNS.length} columns · ${pay.length} rows`}
          decision={downloadDecision}
          onCsv={() => downloadCsv(`${exportFilename('DIC-employee-kpi', period)}.csv`, kpiData)}
          onXlsx={() => downloadXlsx(`${exportFilename('DIC-employee-kpi', period)}.xlsx`, 'Employee KPI', kpiData)}
        />
        <SheetCard
          title="Score Card"
          body="Employees down, working days across, with a period average column and a department average row — the daily working behind the Production column."
          columns={`${dates.length} working days · ${kpis.length} rows`}
          decision={downloadDecision}
          onCsv={() => downloadCsv(`${exportFilename('DIC-score-card', period)}.csv`, scoreCardData)}
          onXlsx={() => downloadXlsx(`${exportFilename('DIC-score-card', period)}.xlsx`, 'Score Card', scoreCardData)}
        />
      </div>

      {/* --- Preview ---------------------------------------------------------- */}
      <section className="card mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink-900">Employee KPI sheet — preview</h2>
          <span className="text-xs text-ink-500">Exactly what downloads, row for row.</span>
        </div>

        {pay.length === 0 ? (
          <EmptyState title="Nobody on the incentive list" body="Approved employees appear here once the MD has added them." />
        ) : (
          <div className="max-h-[32rem] overflow-auto scroll-slim">
            <table className="w-full min-w-[72rem] border-collapse">
              <thead>
                <tr>
                  {EMPLOYEE_KPI_COLUMNS.map((column, index) => (
                    <th key={column} scope="col" className={`th sticky top-0 bg-ink-50 ${index >= 4 ? 'text-right' : ''}`}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pay.map((row) => (
                  <tr key={row.employee.empId}>
                    <td className="td num text-ink-700">{row.employee.empId}</td>
                    <td className="td font-medium">{row.employee.name.trim() || `Emp ${row.employee.empId}`}</td>
                    <td className="td text-xs text-ink-600">{row.employee.grade || '—'}</td>
                    <td className="td text-xs text-ink-600">{departmentName(row.employee.departmentId)}</td>
                    <Mark value={row.marks.production} />
                    <Mark value={row.marks.waste} />
                    <Mark value={row.marks.variance} />
                    <Mark value={row.marks.quality} />
                    <Mark value={row.marks.ehs} />
                    <Mark value={row.marks.wcm5s} />
                    <Mark value={row.marks.attendance} />
                    <td className="td num font-semibold">{row.total === null ? '—' : formatScore(row.total)}</td>
                    <td className="td num text-ink-700">{row.approved === null ? '—' : formatRupees(row.approved)}</td>
                    <td className="td num font-semibold">{row.earned === null ? '—' : formatRupees(row.earned)}</td>
                  </tr>
                ))}
                <tr className="bg-ink-50 font-semibold">
                  <td className="td">TOTAL</td>
                  <td className="td text-xs text-ink-600">{pay.length} employees</td>
                  <td className="td" colSpan={10} />
                  <td className="td num">{formatRupees(pay.reduce((sum, row) => sum + (row.approved ?? 0), 0))}</td>
                  <td className="td num">{formatRupees(payable)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-3 text-xs text-ink-500">
        A blank cell is a figure nobody has supplied. It is never exported as a zero, because a zero is a measurement and
        a blank is not.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------

function Mark({ value }: { value: number | null }) {
  return <td className="td num text-ink-700">{value === null ? '—' : formatScore(value)}</td>
}

function SheetCard({
  title,
  body,
  columns,
  decision,
  onCsv,
  onXlsx,
}: {
  title: string
  body: string
  columns: string
  decision: { allowed: boolean; reason: string }
  onCsv: () => void
  onXlsx: () => void
}) {
  return (
    <section className="card card-pad">
      <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
      <p className="mt-1 text-xs text-ink-600">{body}</p>
      <p className="mt-1 text-[11px] text-ink-400">{columns}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <GuardedButton decision={decision} variant="primary" onClick={onXlsx}>
          <Icon name="download" className="h-3.5 w-3.5" /> Excel
        </GuardedButton>
        <GuardedButton decision={decision} variant="default" onClick={onCsv}>
          <Icon name="download" className="h-3.5 w-3.5" /> CSV
        </GuardedButton>
      </div>
    </section>
  )
}

/** Kept so a future caller has the type to hand. */
export type { CellValue }
