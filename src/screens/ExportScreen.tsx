/**
 * Screen 7 — Export.
 *
 * Approved (Locked) periods only. The column order matches the existing Employee KPI
 * sheet so the Production /20 column can be pasted straight into column D.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PHASE_2_KPIS } from '../config/policy'
import { round } from '../domain/calc'
import { formatDate } from '../domain/dates'
import { downloadCsv, downloadXlsx, type CellValue } from '../domain/exporters'
import { formatScore } from '../domain/format'
import { useApp } from '../store/AppStore'
import { displayName, scorecard } from '../store/selectors'
import { EmptyState, GuardedButton, Icon, InfoNote, PageHeader, PeriodBadge, WarnNote } from '../components/ui'

/** Column order follows the Employee KPI sheet: Production /20 lands in column D. */
const COLUMNS = ['Emp Code', 'Employee Name', 'Pay Grade', 'Days Scored', 'Production Score /20'] as const

export default function ExportScreen() {
  const { state, period, allow } = useApp()

  const { rows } = useMemo(() => scorecard(state, period.periodId), [state, period.periodId])

  const data: CellValue[][] = useMemo(
    () =>
      rows.map((row) => [
        row.employee.empId,
        displayName(row.employee),
        row.employee.grade,
        row.daysScored,
        row.total === null ? '' : round(row.total, 2),
      ]),
    [rows],
  )

  const downloadDecision = allow('export.download')
  const approved = period.status === 'Locked'
  const filenameStem = `DIC-production-score-${period.periodId}`

  return (
    <>
      <PageHeader
        title="Export to Finance"
        subtitle={`${period.label} · ${rows.length} employees · matches the scorecard row for row`}
        actions={
          <>
            <PeriodBadge status={period.status} />
            <GuardedButton
              decision={downloadDecision}
              variant="default"
              onClick={() => downloadCsv(`${filenameStem}.csv`, [[...COLUMNS], ...data])}
            >
              <Icon name="download" className="h-3.5 w-3.5" /> CSV
            </GuardedButton>
            <GuardedButton
              decision={downloadDecision}
              variant="primary"
              onClick={() => downloadXlsx(`${filenameStem}.xlsx`, `Production ${period.periodId}`, [[...COLUMNS], ...data])}
            >
              <Icon name="download" className="h-3.5 w-3.5" /> Excel (.xlsx)
            </GuardedButton>
          </>
        }
      />

      {!approved && (
        <div className="mb-4">
          <WarnNote>
            <p className="font-semibold">{period.label} is {period.status}, not approved.</p>
            <p className="mt-0.5">
              Only an approved and locked month can be exported.{' '}
              <Link to="/month-end" className="link">
                Open the Month-end Review
              </Link>
              .
            </p>
          </WarnNote>
        </div>
      )}

      {!downloadDecision.allowed && approved && (
        <div className="mb-4">
          <InfoNote>{downloadDecision.reason}</InfoNote>
        </div>
      )}

      <div className="card mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink-800">Preview</h2>
          <span className="text-xs text-ink-500">
            Period {formatDate(period.startDate)} to {formatDate(period.endDate)}
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="Nothing to export" body="No employees are in the roll-up for this period and area." />
        ) : (
          <div className="max-h-[55vh] overflow-auto scroll-slim">
            <table className="w-full min-w-[42rem] border-collapse">
              <thead>
                <tr>
                  {COLUMNS.map((column, index) => (
                    <th key={column} scope="col" className={`th sticky top-0 bg-ink-50 ${index >= 4 ? 'text-right' : ''}`}>
                      <span className="block text-[10px] font-normal text-ink-400">Column {String.fromCharCode(65 + index)}</span>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employee.empId}>
                    <td className="td num">{row.employee.empId}</td>
                    <td className="td">{displayName(row.employee)}</td>
                    <td className="td text-ink-600">{row.employee.grade}</td>
                    <td className="td num">{row.daysScored}</td>
                    <td className="td num font-semibold">{formatScore(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card card-pad">
        <h2 className="text-sm font-semibold text-ink-800">What is not in this file yet</h2>
        <p className="mt-1 text-xs text-ink-500">Phase 1 exports the Production column only. The rest arrive in later phases.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {PHASE_2_KPIS.map((kpi) => (
            <div key={kpi.key} className="rounded-md border border-dashed border-ink-300 bg-ink-50 px-2.5 py-2 text-center">
              <div className="text-xs font-medium text-ink-500">{kpi.label}</div>
              <div className="font-mono text-sm text-ink-400">/{kpi.weight}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Earned Incentive = Approved × Total ÷ 100 is Phase 3. Base rates live in <Link to="/settings" className="link">Settings</Link>.
        </p>
      </div>
    </>
  )
}
