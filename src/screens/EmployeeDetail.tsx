/**
 * Screen 5 — Employee Detail.
 *
 * The employee card, the daily score trend for the period, every entry, the month
 * average, and the other six KPIs as greyed Phase 2 placeholders with their weights.
 */

import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PHASE_2_KPIS } from '../config/policy'
import { ScoreCell } from '../components/ScoreCell'
import { TrendChart, type TrendPoint } from '../components/TrendChart'
import { Badge, ConfirmDialog, EmptyState, GuardedButton, Icon, InfoNote, PageHeader, Stat, Tooltip, type ConfirmConfig } from '../components/ui'
import { calcEmployeeDay, entryPercent, entryScore } from '../domain/calc'
import { formatDate } from '../domain/dates'
import { formatBatches, formatPercent, formatScore } from '../domain/format'
import { useApp } from '../store/AppStore'
import { displayName, periodWorkingDays, pointById, scorecard, selectEntries, userName } from '../store/selectors'

export default function EmployeeDetail() {
  const { empId } = useParams()
  const navigate = useNavigate()
  const { state, period, allow, write } = useApp()
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)

  const id = Number(empId)
  const employee = state.employees.find((e) => e.empId === id)

  const entries = useMemo(() => selectEntries(state, { periodId: period.periodId, empId: id }), [state, period.periodId, id])
  const dates = useMemo(() => periodWorkingDays(state, period), [state, period])

  const dayScores = useMemo(() => {
    const map = new Map<string, { score: number | null; count: number }>()
    for (const date of dates) {
      const rows = entries.filter((entry) => entry.date === date)
      if (rows.length === 0) continue
      map.set(date, { score: calcEmployeeDay(rows, state.settings), count: rows.length })
    }
    return map
  }, [dates, entries, state.settings])

  const trend: TrendPoint[] = dates.map((date) => ({
    date,
    score: dayScores.get(date)?.score ?? null,
    entryCount: dayScores.get(date)?.count ?? 0,
  }))

  const row = useMemo(
    () => (employee ? scorecard(state, period.periodId).rows.find((r) => r.employee.empId === id) : undefined),
    [state, period.periodId, employee, id],
  )

  const override = state.monthOverrides.find((o) => o.periodId === period.periodId && o.empId === id)

  if (!employee) {
    return (
      <>
        <PageHeader title="Employee not found" />
        <div className="card">
          <EmptyState title={`No employee with Emp ID ${empId}`} body="The Emp ID is the key — names are display only and are never used to look anyone up." action={<Link to="/scorecard" className="btn btn-primary">Back to the scorecard</Link>} />
        </div>
      </>
    )
  }

  const overrideDecision = allow('override.grant')
  const scoredDays = trend.filter((point) => point.score !== null).length

  return (
    <>
      <PageHeader
        title={displayName(employee)}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono tabular-nums">Emp ID {employee.empId}</span>
            <span>·</span>
            <span>{employee.grade}</span>
            <span>·</span>
            <span>{employee.role}</span>
            <span>·</span>
            <span>{employee.site}</span>
            {employee.status !== 'Active' && <Badge tone="warn">{employee.status}</Badge>}
            {employee.incentiveListStatus !== 'Approved' && <Badge tone="warn">Pending MD approval</Badge>}
          </span>
        }
        actions={
          <>
            <button type="button" className="btn btn-default" onClick={() => navigate(-1)}>
              Back
            </button>
            <GuardedButton
              decision={overrideDecision}
              variant="default"
              onClick={() =>
                setConfirm({
                  title: `Award full marks to ${displayName(employee)} for ${period.label}?`,
                  body: (
                    <p>
                      Policy section 10 lets the HOD award full marks for extraordinary performance. The month's Production Score becomes{' '}
                      {state.settings.scoreCap}, replacing the computed average of {formatScore(row?.total ?? null)}. The MD reviews every award and the
                      reason is audited.
                    </p>
                  ),
                  confirmLabel: 'Award full marks',
                  commentRequired: true,
                  commentLabel: 'Reason for the award',
                  onConfirm: (reason) => write({ kind: 'month.override', periodId: period.periodId, empId: employee.empId, score: state.settings.scoreCap, reason }),
                })
              }
            >
              Full marks override
            </GuardedButton>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={`Production Score /${state.settings.scoreCap}`}
          value={formatScore(row?.total ?? null)}
          hint={override ? 'HOD full-marks override' : `average of ${scoredDays} scored day(s)`}
          tone={row?.total == null ? 'neutral' : row.total >= state.settings.bandHigh ? 'good' : row.total >= state.settings.bandLow ? 'warn' : 'bad'}
        />
        <Stat label="Days scored" value={`${scoredDays} / ${dates.length}`} hint="working days in the period" />
        <Stat label="Entries" value={entries.length} hint={`${(entries.length / Math.max(1, scoredDays)).toFixed(2)} rows per scored day`} />
        <Stat
          label="Service"
          value={<span className="text-base">{formatDate(employee.joinDate)}</span>}
          hint={employee.leaveDate ? `left ${formatDate(employee.leaveDate)}` : 'still in service'}
        />
      </div>

      {override && (
        <div className="mb-4">
          <InfoNote>
            <strong>Full marks awarded by {userName(state, override.grantedBy)}.</strong> “{override.reason}”{' '}
            {override.mdReviewed ? 'The MD has reviewed this award.' : 'Waiting for MD review.'}
          </InfoNote>
        </div>
      )}

      {row && row.flags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {row.flags.map((flag) => (
            <Badge key={flag} tone="warn">
              {flag}
            </Badge>
          ))}
        </div>
      )}

      {/* --- Trend ------------------------------------------------------------ */}
      <div className="card mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink-800">Daily score through {period.label}</h2>
          <span className="text-xs text-ink-500">dashed lines mark the {state.settings.bandLow} and {state.settings.bandHigh} score bands</span>
        </div>
        <div className="p-3">
          <TrendChart points={trend} title={`Daily Production score for ${employee.name}`} />
        </div>
      </div>

      {/* --- Entries ----------------------------------------------------------- */}
      <div className="card mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink-800">Every entry in this period</h2>
          <span className="text-xs text-ink-500">{entries.length} rows</span>
        </div>

        {entries.length === 0 ? (
          <EmptyState
            title="No entries in this period"
            body="A missing day is never counted as a zero — the Production Score averages over days that have a score."
          />
        ) : (
          <div className="max-h-[50vh] overflow-auto scroll-slim">
            <table className="w-full min-w-[46rem] border-collapse">
              <thead>
                <tr>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-28">Date</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50">Point</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-24 text-right">Target</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-24 text-right">Output</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-24 text-right">%age</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-24 text-right">Score</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-28 text-right">Day score</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-24">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const firstOfDay = index === 0 || entries[index - 1].date !== entry.date
                  const dayRowCount = entries.filter((e) => e.date === entry.date).length
                  return (
                    <tr key={entry.entryId}>
                      <td className="td">{firstOfDay ? formatDate(entry.date) : ''}</td>
                      <td className="td">
                        {pointById(state, entry.pointId)?.name ?? <span className="text-bad-600">(blank point)</span>}
                        {entry.scoreOverride !== null && (
                          <Tooltip label={entry.overrideReason ?? 'HOD override'}>
                            <Badge tone="brand" className="ml-1.5">
                              Override
                            </Badge>
                          </Tooltip>
                        )}
                      </td>
                      <td className="td num">{entry.target ?? '—'}</td>
                      <td className="td num">{formatBatches(entry.actualBatches)}</td>
                      <td className="td num text-ink-600">{formatPercent(entryPercent(entry))}</td>
                      <td className="td num">
                        <ScoreCell score={entryScore(entry, state.settings)} overridden={entry.scoreOverride !== null} />
                      </td>
                      <td className="td num">
                        {firstOfDay ? (
                          <Tooltip label={dayRowCount > 1 ? `Plain average of ${dayRowCount} rows` : 'Single row'}>
                            <span className="font-mono font-semibold tabular-nums">{formatScore(dayScores.get(entry.date)?.score ?? null)}</span>
                          </Tooltip>
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="td">
                        <Link to={`/daily-entry?date=${entry.date}`} className="link text-xs">
                          {entry.status}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- Phase 2 placeholders ----------------------------------------------- */}
      <div className="card card-pad">
        <div className="flex items-center gap-2">
          <Icon name="lock" className="h-4 w-4 text-ink-400" />
          <h2 className="text-sm font-semibold text-ink-800">The other six KPIs — Phase 2</h2>
        </div>
        <p className="mt-1 text-xs text-ink-500">
          Phase 1 scores the Production / Output KPI only. These are stored in the data model but not collected or calculated yet.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {PHASE_2_KPIS.map((kpi) => (
            <div key={kpi.key} className="rounded-md border border-dashed border-ink-300 bg-ink-50 px-3 py-3 text-center opacity-70">
              <div className="text-xs font-medium text-ink-500">{kpi.label}</div>
              <div className="mt-0.5 font-mono text-lg text-ink-400">—</div>
              <div className="text-[10px] text-ink-400">of {kpi.weight}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-ink-200 bg-white px-3 py-2">
            <div className="label">Production (this phase)</div>
            <div className="font-mono text-lg tabular-nums">
              {formatScore(row?.total ?? null)} <span className="text-sm text-ink-400">/ {state.settings.scoreCap}</span>
            </div>
          </div>
          <div className="rounded-md border border-dashed border-ink-300 bg-ink-50 px-3 py-2 opacity-70">
            <div className="label">Total KPI</div>
            <div className="font-mono text-lg text-ink-400">— / 100</div>
          </div>
          <div className="rounded-md border border-dashed border-ink-300 bg-ink-50 px-3 py-2 opacity-70">
            <div className="label">Earned Incentive</div>
            <div className="font-mono text-lg text-ink-400">—</div>
            <div className="text-[10px] text-ink-400">Approved × Total ÷ 100 (Phase 3)</div>
          </div>
        </div>
      </div>

      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
