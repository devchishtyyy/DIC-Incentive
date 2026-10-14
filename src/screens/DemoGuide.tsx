/**
 * The tester's map. Section 8 of the build brief requires every seeded scenario to be
 * reachable from the UI without editing code — this screen links straight to each one,
 * and lists the acceptance tests with where to check them.
 */

import { Link } from 'react-router-dom'
import { Badge, InfoNote, PageHeader } from '../components/ui'
import { SCENARIOS } from '../data/seed'
import { ROLE_LABELS, ROLE_SHORT, type RoleId } from '../domain/types'
import { useApp } from '../store/AppStore'

const ACCEPTANCE = [
  { n: 1, test: 'Target 4, actual 4.75', expected: '118.8%, score 20.00', where: 'Daily Entry — Hamza Siddiqui (4103), 30 Sep', to: '/daily-entry?date=2026-09-30' },
  { n: 2, test: 'Target 3, actual 2.5', expected: '83.3%, score 16.67', where: 'Unit test, and any 3-target row', to: '/scorecard' },
  { n: 3, test: 'Target 5, actual 3', expected: '60.0%, score 12.00', where: 'Unit test, and any 5-target row', to: '/scorecard' },
  { n: 4, test: 'Target 0 or blank', expected: 'Save blocked, no NaN or Infinity', where: 'Daily Entry — clear a target and try to save', to: '/daily-entry' },
  { n: 5, test: 'Two points in one day, 20 and 10', expected: 'Day score 15.00', where: 'Usman Tariq (4104), 20 Aug', to: '/employees/4104' },
  { n: 6, test: 'Day scores 20, 20, 10', expected: 'Monthly score 16.67', where: 'Unit test (npm test)', to: '/scorecard' },
  { n: 7, test: 'Office Executive edits a target', expected: 'Control disabled with a tooltip', where: 'Daily Entry and Targets as Office Exec', to: '/targets' },
  { n: 8, test: 'Admin adds someone to the incentive list', expected: 'They arrive Pending MD approval, out of the roll-up', where: 'People → SAP directory as Admin, then as MD', to: '/people?tab=directory' },
  { n: 9, test: 'Ops approves before HOD signs', expected: 'Approve disabled with the reason', where: 'Month-end Review on the Aug–Sep period', to: '/month-end?period=2026-08' },
  { n: 10, test: 'Month locked', expected: 'Read-only; only reopen unlocks it', where: 'Switch the period to Jun–Jul', to: '/month-end?period=2026-06' },
  { n: 11, test: 'Any change to actual, target or override', expected: 'One audit row, old and new value, user, time', where: 'Edit a row, then open the Audit Log', to: '/audit' },
  { n: 12, test: 'Scorecard Total Avg Score', expected: 'Average of employee-day scores over scored days', where: 'Monthly Scorecard last column', to: '/scorecard' },
  { n: 13, test: 'Export of an approved period', expected: 'Matches the scorecard row for row', where: 'Export as Finance on the Jun–Jul period', to: '/export' },
  { n: 14, test: 'Duplicate row warning', expected: 'Warns and blocks submit until merged or confirmed', where: 'Daily Entry — Zeeshan Haider (4105), 28 Sep', to: '/daily-entry?date=2026-09-28' },
]

const ROLE_HINTS: Array<{ role: RoleId; hint: string }> = [
  { role: 'OFFICE_EXEC', hint: 'Enter Output Batches, confirm warnings, submit each day and submit the month.' },
  { role: 'HOD', hint: 'Change a Daily Target with a reason, award full marks, sign off or return the month.' },
  { role: 'OPS_MANAGER', hint: 'Approve the month once the HOD has signed, return it, or reopen a locked month.' },
  { role: 'FINANCE', hint: 'Export an approved period to CSV or Excel. Read-only everywhere else.' },
  { role: 'EHS_REP', hint: 'Read-only on the scorecard. No Phase 1 action, and no access to the audit log or export.' },
  { role: 'MD_CEO', hint: 'Approve an addition to the incentive list, review a full-marks award, reopen a locked month.' },
  { role: 'ADMIN', hint: 'Sync the SAP directory, pick who joins the incentive list, maintain points and settings.' },
]

export default function DemoGuide() {
  const { state, user, signIn } = useApp()

  return (
    <>
      <PageHeader
        title="Demo Guide"
        subtitle="Every seeded scenario and acceptance test, with a link to where it can be seen."
      />

      <div className="mb-4">
        <InfoNote>
          Fixed seed, so the numbers are the same everywhere. Names and Emp IDs are invented. Today is pinned to 1 October 2026.
        </InfoNote>
      </div>

      {/* --- Role switcher shortcuts ----------------------------------------- */}
      <div className="card card-pad mb-5">
        <h2 className="text-sm font-semibold text-ink-800">Test each role</h2>
        <p className="mt-1 text-xs text-ink-500">
          You are signed in as <strong>{user.name}</strong> ({ROLE_LABELS[user.role]}). Click a role to switch straight to that account.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ROLE_HINTS.map(({ role, hint }) => {
            const candidate = state.users.find((u) => u.role === role)
            if (!candidate) return null
            const active = user.role === role
            return (
              <button
                key={role}
                type="button"
                onClick={() => signIn(candidate.userId)}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  active ? 'border-brand-600 bg-brand-50' : 'border-ink-200 hover:bg-ink-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink-900">{ROLE_SHORT[role]}</span>
                  {active && <Badge tone="brand">current</Badge>}
                </div>
                <div className="text-xs text-ink-500">{candidate.name}</div>
                <p className="mt-1 text-xs text-ink-600">{hint}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* --- Seeded scenarios -------------------------------------------------- */}
      <div className="card mb-5 overflow-hidden">
        <div className="border-b border-ink-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink-800">Seeded scenarios</h2>
          <p className="mt-0.5 text-xs text-ink-500">The thirteen cases from section 8 of the build brief.</p>
        </div>
        <ol className="divide-y divide-ink-200">
          {SCENARIOS.map((scenario) => (
            <li key={scenario.n} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-100 font-mono text-xs font-semibold text-ink-700">
                {scenario.n}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-ink-900">{scenario.title}</h3>
                <p className="mt-0.5 text-sm text-ink-600">{scenario.detail}</p>
                <p className="mt-0.5 text-xs text-ink-400">{scenario.where}</p>
              </div>
              <Link to={scenario.to} className="btn btn-default btn-sm">
                Open
              </Link>
            </li>
          ))}
        </ol>
      </div>

      {/* --- Acceptance tests --------------------------------------------------- */}
      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink-800">Acceptance tests</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Section 9 of the build brief. Tests 1 to 6 and 14 also run as unit tests against the calculation module — <code className="font-mono">npm test</code>.
          </p>
        </div>
        <div className="overflow-x-auto scroll-slim">
          <table className="w-full min-w-[52rem] border-collapse">
            <thead>
              <tr>
                <th scope="col" className="th w-10">#</th>
                <th scope="col" className="th w-56">Test</th>
                <th scope="col" className="th">Expected result</th>
                <th scope="col" className="th">Where to check it</th>
                <th scope="col" className="th w-24 text-right">Go</th>
              </tr>
            </thead>
            <tbody>
              {ACCEPTANCE.map((item) => (
                <tr key={item.n}>
                  <td className="td num text-ink-500">{item.n}</td>
                  <td className="td font-medium">{item.test}</td>
                  <td className="td text-ink-700">{item.expected}</td>
                  <td className="td text-ink-600">{item.where}</td>
                  <td className="td text-right">
                    <Link to={item.to} className="btn btn-default btn-sm">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
