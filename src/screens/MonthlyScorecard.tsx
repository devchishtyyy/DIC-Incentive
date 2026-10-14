/**
 * Screen 4 — Monthly Scorecard.
 *
 * The Excel grid, reproduced: employees down, dates across, each cell the employee-day
 * score, last column the Total Avg Score. Sticky header and first columns, colour scale,
 * and a click on any cell opens that employee-day's rows.
 */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ScoreLegend, ScorecardCell } from '../components/ScoreCell'
import { Badge, EmptyState, Icon, Modal, PageHeader, Tooltip } from '../components/ui'
import { formatDate, formatDayShort, formatWeekday } from '../domain/dates'
import { downloadCsv } from '../domain/exporters'
import { formatBatches, formatPercent, formatScore } from '../domain/format'
import { entryPercent, entryScore, round } from '../domain/calc'
import { useApp } from '../store/AppStore'
import { displayName, pointById, scorecard, selectEntries } from '../store/selectors'

export default function MonthlyScorecard() {
  const { state, period, allow } = useApp()
  const [params, setParams] = useSearchParams()
  const [cell, setCell] = useState<{ empId: number; date: string } | null>(null)

  const pointFilter = params.get('point') ?? ''
  const setPointFilter = (value: string) => {
    const copy = new URLSearchParams(params)
    if (value) copy.set('point', value)
    else copy.delete('point')
    setParams(copy, { replace: true })
  }

  const { dates, rows } = useMemo(
    () => scorecard(state, period.periodId, pointFilter || undefined),
    [state, period.periodId, pointFilter],
  )

  const pointOptions = useMemo(
    () => state.points.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [state.points],
  )

  const totals = rows.map((row) => row.total).filter((t): t is number => t !== null)
  const average = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : null

  const exportCsv = () => {
    const header = ['Emp Code', 'Employee Name', 'Pay Grade', ...dates.map((date) => formatDate(date)), 'Days Scored', 'Total Avg Score']
    const body = rows.map((row) => [
      row.employee.empId,
      displayName(row.employee),
      row.employee.grade,
      ...dates.map((date) => {
        const score = row.byDate.get(date)
        return score === undefined ? '' : round(score, 2)
      }),
      row.daysScored,
      row.total === null ? '' : round(row.total, 2),
    ])
    downloadCsv(`DIC-scorecard-${period.periodId}.csv`, [header, ...body])
  }

  const viewDecision = allow('scorecard.view')
  if (!viewDecision.allowed) {
    return (
      <>
        <PageHeader title="Monthly Scorecard" />
        <div className="card">
          <EmptyState title="No access" body={viewDecision.reason} />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Monthly Scorecard"
        subtitle={`${period.label} · ${rows.length} employees · ${dates.length} working days`}
        actions={
          <>
            <label className="flex items-center gap-1.5 text-xs text-ink-500">
              Point
              <select className="input w-auto py-1 text-sm" value={pointFilter} onChange={(event) => setPointFilter(event.target.value)}>
                <option value="">All points</option>
                {pointOptions.map((point) => (
                  <option key={point.pointId} value={point.pointId}>
                    {point.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-default" onClick={exportCsv} disabled={rows.length === 0}>
              <Icon name="download" className="h-3.5 w-3.5" /> Export to CSV
            </button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ScoreLegend />
        <div className="flex items-center gap-3 text-sm">
          <span className="text-ink-500">Average</span>
          <span className="font-mono text-lg font-semibold tabular-nums">{formatScore(average)}</span>
          <span className="text-ink-400">/ {state.settings.scoreCap}</span>
        </div>
      </div>

      {pointFilter && (
        <div className="mb-3 text-xs text-ink-600">
          Filtered to <strong>{pointById(state, pointFilter)?.name}</strong> — totals count only that point.{' '}
          <button type="button" className="link" onClick={() => setPointFilter('')}>
            Clear the filter
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title="Nobody in the roll-up for this period"
            body="Employees appear once the Admin has added them and the MD has approved them onto the incentive list."
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto scroll-slim">
            <table className="border-collapse text-xs">
              <caption className="sr-only">
                Monthly scorecard for {period.label}. Employees down, dates across, Total Avg Score in the last column.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="th sticky top-0 left-0 z-30 w-16 bg-ink-50">Emp ID</th>
                  <th scope="col" className="th sticky top-0 left-16 z-30 w-44 bg-ink-50">Employee</th>
                  {dates.map((date) => (
                    <th key={date} scope="col" className="th sticky top-0 z-20 min-w-[3.25rem] bg-ink-50 text-center whitespace-nowrap">
                      <span className="block leading-tight">{formatDayShort(date)}</span>
                      <span className="block text-[10px] font-normal text-ink-400">{formatWeekday(date)}</span>
                    </th>
                  ))}
                  <th scope="col" className="th sticky top-0 right-0 z-30 min-w-[5.5rem] bg-ink-50 text-right">Total Avg Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employee.empId} className="group">
                    <th scope="row" className="td sticky left-0 z-10 bg-white font-mono font-normal tabular-nums group-hover:bg-ink-50">
                      {row.employee.empId}
                    </th>
                    <td className="td sticky left-16 z-10 bg-white group-hover:bg-ink-50">
                      <Link to={`/employees/${row.employee.empId}`} className="link font-medium">
                        {displayName(row.employee)}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-ink-500">
                        <span>{row.employee.grade}</span>
                        {row.employee.status === 'Probation' && <Badge tone="warn">Probation</Badge>}
                        {row.employee.status === 'Left' && <Badge tone="neutral">Left</Badge>}
                        {row.overridden && <Badge tone="brand">Override</Badge>}
                      </div>
                    </td>
                    {dates.map((date) => (
                      <td key={date} className="border-b border-ink-100 p-0">
                        <ScorecardCell
                          score={row.byDate.get(date) ?? null}
                          entryCount={row.entriesByDate.get(date) ?? 0}
                          label={`${displayName(row.employee)}, ${formatDate(date)}`}
                          onClick={() => setCell({ empId: row.employee.empId, date })}
                        />
                      </td>
                    ))}
                    <td className="td sticky right-0 z-10 bg-white text-right group-hover:bg-ink-50">
                      <Tooltip label={row.overridden ? 'A HOD full-marks override replaces the computed average for this month.' : `${row.daysScored} days scored`}>
                        <span className="font-mono font-semibold tabular-nums">{formatScore(row.total)}</span>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-ink-500">
        A blank cell is no entry that day — never a zero. The Total Avg Score averages over days that have a score.
      </p>

      <CellDrilldown cell={cell} onClose={() => setCell(null)} />
    </>
  )
}

// ---------------------------------------------------------------------------

function CellDrilldown({ cell, onClose }: { cell: { empId: number; date: string } | null; onClose: () => void }) {
  const { state, period } = useApp()
  if (!cell) return null

  const employee = state.employees.find((e) => e.empId === cell.empId)
  const entries = selectEntries(state, { periodId: period.periodId, date: cell.date, empId: cell.empId })

  return (
    <Modal
      open
      title={`${cell.empId} ${displayName(employee, cell.empId)} — ${formatDate(cell.date)}`}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Link to={`/employees/${cell.empId}`} className="btn btn-default" onClick={onClose}>
            Open employee
          </Link>
          <Link to={`/daily-entry?date=${cell.date}`} className="btn btn-primary" onClick={onClose}>
            Open Daily Entry for this day
          </Link>
        </>
      }
    >
      {entries.length === 0 ? (
        <p className="text-sm text-ink-600">No rows on this date, so no score. The day is not counted as a zero.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th">Point</th>
              <th className="th text-right">Target</th>
              <th className="th text-right">Output</th>
              <th className="th text-right">%age</th>
              <th className="th text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.entryId}>
                <td className="td">{pointById(state, entry.pointId)?.name ?? <span className="text-bad-600">(blank)</span>}</td>
                <td className="td num">{entry.target ?? '—'}</td>
                <td className="td num">{formatBatches(entry.actualBatches)}</td>
                <td className="td num">{formatPercent(entryPercent(entry))}</td>
                <td className="td num font-semibold">{formatScore(entryScore(entry, state.settings))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="td font-semibold" colSpan={4}>
                Day score — plain average of {entries.length} row{entries.length > 1 ? 's' : ''}
              </td>
              <td className="td num font-semibold">
                {formatScore(
                  (() => {
                    const scores = entries.map((entry) => entryScore(entry, state.settings)).filter((s): s is number => s !== null)
                    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
                  })(),
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </Modal>
  )
}
