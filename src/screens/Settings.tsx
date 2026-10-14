/**
 * Screen 10 — Settings and Assumptions.
 *
 * The policy constants, the configurable period dates, and the open policy questions from
 * section 6, each showing what the app applies today and what the alternative would be.
 * Admin edits; every role can read.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RosterSyncPanel } from '../components/RosterSyncPanel'
import { ASSUMPTIONS, BASE_INCENTIVE_RATES, PHASE_2_KPIS, type AppSettings } from '../config/policy'
import { Badge, Field, GuardedButton, Icon, InfoNote, PageHeader, Tooltip } from '../components/ui'
import { formatDate } from '../domain/dates'
import { GRADE_BANDS, type GradeBand } from '../domain/rates'
import { formatRupees } from '../domain/format'
import { PERMISSION_MATRIX, type Capability } from '../domain/permissions'
import { ROLE_SHORT, type RoleId } from '../domain/types'
import { useApp } from '../store/AppStore'
import { currentRateTable } from '../store/selectors'

const NUMERIC_SETTINGS: Array<{ key: keyof AppSettings; label: string; hint: string; step?: number }> = [
  { key: 'scoreCap', label: 'Score cap', hint: 'Production / Output is 20 of the 100 incentive marks (policy section 5). A score can never exceed it.' },
  { key: 'periodStartDay', label: 'Period starts on day', hint: 'The incentive period runs from this day to the day before it in the next month. Changing it moves every period. 1 to 28 — above 28 cannot be honoured in February.' },
  { key: 'prorataDivisor', label: 'Working days per period (÷ divisor)', hint: 'A fixed 26, not a count of the period’s actual working days. Attendance is (26 − days absent) ÷ 26 × 10.' },
  { key: 'reviewDeadlineDay', label: 'Review deadline day', hint: 'Monthly marks are due before this day of the month, ahead of the salary run (policy section 10).' },
  { key: 'bandLow', label: 'Scorecard red band below', hint: 'Cells below this score are red on the Monthly Scorecard.' },
  { key: 'bandHigh', label: 'Scorecard green band above', hint: 'Cells above this score are green; between the two they are amber.' },
  { key: 'outlierActualMultiple', label: 'Outlier — output above target ×', hint: 'A soft warning when the Output Batch exceeds this multiple of the Daily Target.', step: 0.5 },
  { key: 'outlierTargetFraction', label: 'Outlier — target below default fraction', hint: 'A soft warning when the day target falls below this fraction of the point default.', step: 0.05 },
  { key: 'underTargetTypoFraction', label: 'Outlier — output below target fraction', hint: 'A soft warning on Daily Entry when output falls below this fraction of target — usually a mistyped target. Warns, never blocks.', step: 0.05 },
  { key: 'underTargetFraction', label: 'Under-target fraction', hint: 'A scored row counts as under-performing below this fraction of target.', step: 0.05 },
]

const CAPABILITY_LABELS: Record<Capability, string> = {
  'entry.edit': 'Enter or edit actual batches',
  'target.edit': 'Enter or change a Daily Target',
  'override.fullMarks': 'Full marks override with reason',
  'entry.view': 'View daily entries',
  'scorecard.view': 'View the monthly scorecard',
  'month.submit': 'Submit the month to the HOD',
  'month.hodSign': 'HOD sign-off per area',
  'month.opsApprove': 'Operations Manager approval',
  'month.reopen': 'Reopen a locked month',
  export: 'Export to Finance',
  'masterdata.manage': 'Manage employees, points, areas, users',
  'employee.approveAdd': 'Approve adding an employee to the incentive list',
  'audit.view': 'View the audit log',
}

const ROLES: RoleId[] = ['OFFICE_EXEC', 'HOD', 'OPS_MANAGER', 'FINANCE', 'EHS_REP', 'MD_CEO', 'ADMIN']

export default function Settings() {
  const { state, allow, write, resetToEmpty, loadDemoData, generateDemoEntries } = useApp()
  const [draft, setDraft] = useState<Partial<AppSettings>>({})

  const editDecision = allow('settings.edit')
  const value = <K extends keyof AppSettings>(key: K): AppSettings[K] => (draft[key] ?? state.settings[key]) as AppSettings[K]
  const dirty = Object.keys(draft).length > 0

  return (
    <>
      <PageHeader
        title="Settings and Assumptions"
        subtitle="Policy constants live in one config file and are mirrored here. Every role can read them; the System Admin changes them."
        actions={
          <>
            <GuardedButton decision={editDecision} variant="default" onClick={() => setDraft({})} blockedReason={dirty ? undefined : 'Nothing has been changed.'}>
              Discard changes
            </GuardedButton>
            <GuardedButton
              decision={editDecision}
              variant="primary"
              blockedReason={dirty ? undefined : 'Nothing has been changed.'}
              onClick={() => {
                write({ kind: 'settings.update', patch: draft })
                setDraft({})
              }}
            >
              Save settings
            </GuardedButton>
          </>
        }
      />

      {!editDecision.allowed && (
        <div className="mb-4">
          <InfoNote>{editDecision.reason}</InfoNote>
        </div>
      )}

      <div className="mb-5">
        <RosterSyncPanel />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* --- Policy constants ---------------------------------------------- */}
        <div className="card card-pad">
          <h2 className="text-sm font-semibold text-ink-800">Policy constants</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {NUMERIC_SETTINGS.map((setting) => (
              <Field key={setting.key} label={setting.label} hint={setting.hint}>
                <input
                  type="number"
                  step={setting.step ?? 1}
                  className="input"
                  value={String(value(setting.key))}
                  disabled={!editDecision.allowed}
                  onChange={(event) => setDraft((current) => ({ ...current, [setting.key]: Number(event.target.value) }))}
                />
              </Field>
            ))}
          </div>
        </div>

        {/* --- Open assumptions ----------------------------------------------- */}
        <div className="card card-pad">
          <h2 className="text-sm font-semibold text-ink-800">Open policy questions</h2>
          <p className="mt-1 text-xs text-ink-500">
            These are not settled yet. The app applies the default; switching one changes every screen, the export and the tests at once, because the
            calculation lives in a single module.
          </p>

          <div className="mt-3 space-y-4">
            {ASSUMPTIONS.map((assumption) => (
              <div key={assumption.id} className="rounded-md border border-ink-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium text-ink-900">{assumption.question}</h3>
                  <Badge tone="neutral">{assumption.source}</Badge>
                </div>

                {assumption.id === 'multiRowWeighting' && (
                  <div className="mt-2 space-y-1.5">
                    {(
                      [
                        ['average', assumption.applied],
                        ['targetWeighted', assumption.alternative],
                      ] as const
                    ).map(([option, label]) => (
                      <label key={option} className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name="multiRowWeighting"
                          className="mt-0.5"
                          checked={value('multiRowWeighting') === option}
                          disabled={!editDecision.allowed}
                          onChange={() => setDraft((current) => ({ ...current, multiRowWeighting: option }))}
                        />
                        <span className="text-ink-700">{label}</span>
                      </label>
                    ))}
                  </div>
                )}

                {assumption.id === 'monthlyDivisor' && (
                  <div className="mt-2 space-y-1.5">
                    {(
                      [
                        ['daysScored', assumption.applied],
                        ['workingDays', assumption.alternative],
                      ] as const
                    ).map(([option, label]) => (
                      <label key={option} className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name="monthlyDivisor"
                          className="mt-0.5"
                          checked={value('monthlyDivisor') === option}
                          disabled={!editDecision.allowed}
                          onChange={() => setDraft((current) => ({ ...current, monthlyDivisor: option }))}
                        />
                        <span className="text-ink-700">{label}</span>
                      </label>
                    ))}
                  </div>
                )}

                {assumption.id === 'rounding' && (
                  <p className="mt-2 text-sm text-ink-700">
                    {assumption.applied} <span className="text-ink-400">Alternative: {assumption.alternative}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* --- Periods --------------------------------------------------------- */}
        <div className="card overflow-hidden">
          <div className="border-b border-ink-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink-800">Incentive periods</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              The period is not a calendar month — the Excel runs 17 August to 15 September. Start and end dates are configurable, never assumed.
            </p>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className="th">Period</th>
                <th scope="col" className="th w-32">Start</th>
                <th scope="col" className="th w-32">End</th>
                <th scope="col" className="th w-32">Status</th>
              </tr>
            </thead>
            <tbody>
              {state.periods.map((period) => (
                <tr key={period.periodId}>
                  <td className="td font-medium">{period.label}</td>
                  <td className="td font-mono tabular-nums">{formatDate(period.startDate)}</td>
                  <td className="td font-mono tabular-nums">{formatDate(period.endDate)}</td>
                  <td className="td">
                    <Badge tone={period.status === 'Locked' ? 'brand' : period.status === 'Open' ? 'neutral' : 'warn'}>{period.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* --- Base incentive table ------------------------------------------- */}
        <div className="card overflow-hidden">
          <div className="border-b border-ink-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink-800">Base incentive amounts — as first read from the signed scan</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              From the signed Incentive Revision 2025/2026 sheet, effective {formatDate(BASE_INCENTIVE_RATES.effectiveFrom)}. Superseded by the editable rate table above, which is what the app actually pays from. Kept for comparison. Not used in any
              calculation. Next revision is due {BASE_INCENTIVE_RATES.nextRevisionDue}, so these stay a table and are never hard-coded.
            </p>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className="th">Site group</th>
                <th scope="col" className="th text-right">Band 1</th>
                <th scope="col" className="th text-right">Band 2</th>
                <th scope="col" className="th text-right">Band 3</th>
              </tr>
            </thead>
            <tbody>
              {BASE_INCENTIVE_RATES.rates.map((rate) => (
                <tr key={rate.siteGroup}>
                  <td className="td">
                    <div className="font-medium">{rate.siteGroup}</div>
                    <div className="text-xs text-ink-500">{rate.sites.join(', ')}</div>
                  </td>
                  <td className="td num">{formatRupees(rate.band1)}</td>
                  <td className="td num">{formatRupees(rate.band2)}</td>
                  <td className="td num">{formatRupees(rate.band3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-ink-200 px-4 py-2 text-xs text-ink-500">{BASE_INCENTIVE_RATES.note}</p>
        </div>
      </div>

      {/* --- Permission matrix ------------------------------------------------- */}
      <div className="card mt-5 overflow-hidden">
        <div className="border-b border-ink-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink-800">Permission matrix</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            E = edit · A = approve or sign off · V = view only · blank = no access. This table is the live matrix the app enforces — every screen and
            button calls the same <code className="font-mono">can(role, action, resource)</code> function.
          </p>
        </div>
        <div className="overflow-x-auto scroll-slim">
          <table className="w-full min-w-[46rem] border-collapse">
            <thead>
              <tr>
                <th scope="col" className="th">Capability</th>
                {ROLES.map((role) => (
                  <th key={role} scope="col" className="th w-24 text-center">
                    {ROLE_SHORT[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(CAPABILITY_LABELS) as Capability[]).map((capability) => (
                <tr key={capability}>
                  <td className="td">{CAPABILITY_LABELS[capability]}</td>
                  {ROLES.map((role) => {
                    const grant = PERMISSION_MATRIX[capability][role]
                    const scoped = role === 'HOD' && grant !== 'none' && ['entry.edit', 'target.edit', 'override.fullMarks', 'entry.view', 'audit.view'].includes(capability)
                    return (
                      <td key={role} className="td text-center">
                        {grant === 'none' ? (
                          <span className="text-ink-300">—</span>
                        ) : (
                          <Tooltip label={scoped ? 'Own Production Area only' : ''}>
                            <Badge tone={grant === 'E' ? 'good' : grant === 'A' ? 'brand' : 'neutral'}>
                              {grant}
                              {scoped ? '*' : ''}
                            </Badge>
                          </Tooltip>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-ink-200 px-4 py-2 text-xs text-ink-500">* A HOD sees and edits only their own Production Area.</p>
      </div>

      <RateTablePanel />

      {/* --- Scope ------------------------------------------------------------- */}
      <div className="card card-pad mt-5">
        <h2 className="text-sm font-semibold text-ink-800">What Phase 1 does not do</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {PHASE_2_KPIS.map((kpi) => (
            <div key={kpi.key} className="rounded-md border border-dashed border-ink-300 bg-ink-50 px-2.5 py-2 text-center opacity-70">
              <div className="text-xs font-medium text-ink-500">{kpi.label}</div>
              <div className="font-mono text-sm text-ink-400">/{kpi.weight}</div>
            </div>
          ))}
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-600">
          <li>SAP Analyst, Maintenance, Technical, Store, Dispatch and Inplant KPIs (policy sections 6 and 8).</li>
          <li>Real login, a real database, payroll integration and the rupee incentive calculation.</li>
          <li>The data model already carries joining dates, leaving dates and the probation flag so the pro-rata rules can be added without a migration.</li>
        </ul>

        <div className="mt-4 border-t border-ink-200 pt-3">
          <h3 className="text-sm font-semibold text-ink-800">Data in this browser</h3>
          <p className="mt-1 text-xs text-ink-500">
            {state.employees.length} employees · {state.entries.length} entries · {state.points.length} points · {state.auditLog.length} audit rows.
          </p>
          <p className="mt-1 text-xs text-ink-500">
            The app ships with master data only. Real staff come from{' '}
            <Link to="/people?tab=import" className="link">
              People → Sync from SAP
            </Link>
            ; the demo below is invented and is never mixed in by accident.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <GuardedButton decision={editDecision} variant="default" onClick={loadDemoData}>
              Load demo data
            </GuardedButton>
            <GuardedButton
              decision={editDecision}
              variant="default"
              onClick={generateDemoEntries}
              blockedReason={state.employees.length === 0 ? 'Import a roster first — there is nobody to generate entries for.' : undefined}
            >
              Generate demo entries for this roster
            </GuardedButton>
            <GuardedButton
              decision={editDecision}
              variant="default"
              onClick={() => write({ kind: 'demo.clearEntries' })}
              blockedReason={state.entries.length === 0 ? 'There are no entries to clear.' : undefined}
            >
              Clear all entries
            </GuardedButton>
            <GuardedButton decision={editDecision} variant="bad" onClick={resetToEmpty}>
              Reset to empty
            </GuardedButton>
          </div>

          <p className="mt-3 text-xs text-ink-500">
            <Link to="/guide" className="link">
              Demo Guide
            </Link>{' '}
            lists every seeded scenario and acceptance test, with a link to where each one can be seen.
          </p>

          <p className="mt-2 text-xs text-ink-500">
            <strong>Load demo data</strong> replaces everything with the 35 invented employees and their history, including the thirteen seeded
            scenarios. <strong>Generate demo entries</strong> keeps the roster you have — real staff included — and invents only the production rows.
          </p>
        </div>
      </div>
    </>
  )
}


// ---------------------------------------------------------------------------

/**
 * The rate table and the grade bands — MD only.
 *
 * Both are data, not code, so a grade nobody anticipated is fixed here rather than in a
 * release. The alias table is the reason an unmatched grade can safely refuse to pay: there
 * is somewhere to go and fix it.
 */
function RateTablePanel() {
  const { state, allow, write } = useApp()
  const decision = allow('rates.edit')
  const table = currentRateTable(state)

  const [draft, setDraft] = useState(() => table.rows.map((row) => ({ ...row })))
  const [aliasCode, setAliasCode] = useState('')
  const [aliasBand, setAliasBand] = useState<GradeBand>('B3')

  useEffect(() => setDraft(table.rows.map((row) => ({ ...row }))), [table])

  const dirty = JSON.stringify(draft) !== JSON.stringify(table.rows)

  const aliasesByBand = GRADE_BANDS.map((band) => ({
    band,
    codes: Object.entries(state.gradeAliases)
      .filter(([, value]) => value === band)
      .map(([code]) => code)
      .sort(),
  }))

  return (
    <div className="card card-pad mt-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink-800">Incentive rates</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            {table.note} In force since {formatDate(table.effectiveFrom)} · version {table.versionId}.
          </p>
        </div>
        <GuardedButton
          decision={decision}
          variant={dirty ? 'primary' : 'default'}
          size="sm"
          blockedReason={!dirty && decision.allowed ? 'Nothing has changed.' : undefined}
          onClick={() => write({ kind: 'rates.setTable', table: { ...table, rows: draft } })}
        >
          Save rates
        </GuardedButton>
      </div>

      <div className="mt-3 overflow-x-auto scroll-slim">
        <table className="w-full min-w-[34rem] border-collapse">
          <thead>
            <tr>
              <th scope="col" className="th">Site</th>
              <th scope="col" className="th">Rate group</th>
              {GRADE_BANDS.map((band) => (
                <th key={band} scope="col" className="th w-28 text-right">{band}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.map((row, index) => (
              <tr key={`${row.siteGroup}|${row.rateGroup}`}>
                <td className="td font-medium text-ink-900">{row.siteGroup}</td>
                <td className="td text-ink-600">{row.rateGroup}</td>
                {GRADE_BANDS.map((band) => (
                  <td key={band} className="td">
                    <input
                      type="number"
                      min="0"
                      step="100"
                      className="input py-1 text-right font-mono tabular-nums"
                      value={row[band]}
                      disabled={!decision.allowed}
                      aria-label={`${row.siteGroup} ${row.rateGroup} ${band}`}
                      onChange={(event) =>
                        setDraft((current) =>
                          current.map((candidate, i) => (i === index ? { ...candidate, [band]: Number(event.target.value) } : candidate)),
                        )
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 border-t border-ink-200 pt-3">
        <h3 className="text-sm font-semibold text-ink-800">Grade bands</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Which band a pay grade falls in. A grade that matches nothing here refuses to pay rather than guessing, so this
          is where an unseen grade gets fixed.
        </p>

        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {aliasesByBand.map(({ band, codes }) => (
            <div key={band} className="rounded-md border border-ink-200 bg-ink-50 p-2.5">
              <div className="text-xs font-semibold text-ink-700">{band}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {codes.map((code) => (
                  <span key={code} className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-ink-700">
                    {code}
                    {decision.allowed && (
                      <button
                        type="button"
                        aria-label={`Remove ${code}`}
                        className="text-ink-300 hover:text-bad-600"
                        onClick={() => {
                          const next = { ...state.gradeAliases }
                          delete next[code]
                          write({ kind: 'rates.setAliases', aliases: next })
                        }}
                      >
                        <Icon name="close" className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {decision.allowed && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Grade code">
              <input
                className="input w-32 font-mono"
                value={aliasCode}
                placeholder="TE5"
                onChange={(event) => setAliasCode(event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Band">
              <select className="input w-24" value={aliasBand} onChange={(event) => setAliasBand(event.target.value as GradeBand)}>
                {GRADE_BANDS.map((band) => (
                  <option key={band} value={band}>{band}</option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              className="btn btn-default"
              disabled={aliasCode.trim() === ''}
              onClick={() => {
                write({ kind: 'rates.setAliases', aliases: { ...state.gradeAliases, [aliasCode.trim()]: aliasBand } })
                setAliasCode('')
              }}
            >
              <Icon name="plus" className="h-3.5 w-3.5" /> Add grade
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
