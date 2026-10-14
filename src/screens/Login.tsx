/**
 * Sign-in for the prototype.
 *
 * There is no real authentication in Phase 1, so instead of a username and password this
 * is a list of test accounts — one per role. Picking one sets the role for the whole app,
 * and the permission matrix does the rest.
 */

import { ROLE_LABELS, type RoleId, type User } from '../domain/types'
import { useApp } from '../store/AppStore'
import { Icon } from '../components/ui'

const WHAT_THEY_DO: Record<RoleId, string> = {
  OFFICE_EXEC: 'Enter the daily Output Batches and submit the month',
  HOD: 'Set targets, review and sign off your own area',
  OPS_MANAGER: 'Approve the month, or send it back to the HODs',
  FINANCE: 'Export an approved month for the salary run',
  EHS_REP: 'Read-only view of the scorecard',
  MD_CEO: 'Approve new employees and extraordinary awards',
  ADMIN: 'Maintain employees, points, areas and settings',
}

const GROUPS: Array<{ title: string; roles: RoleId[] }> = [
  { title: 'Daily work', roles: ['OFFICE_EXEC', 'HOD'] },
  { title: 'Review and approval', roles: ['OPS_MANAGER', 'MD_CEO', 'FINANCE'] },
  { title: 'Everyone else', roles: ['EHS_REP', 'ADMIN'] },
]

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
}

export default function Login() {
  const { state, signIn } = useApp()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ink-100 px-4 py-10">
      <main className="w-full max-w-3xl">
        <header className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">DIC</div>
          <div>
            <h1 className="text-lg font-semibold text-ink-900">Production Incentive</h1>
            <p className="text-sm text-ink-500">Production incentive · all seven KPIs</p>
          </div>
        </header>

        <div className="card">
          <div className="border-b border-ink-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-900">Choose a test account</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              No password — this prototype has no real login. Each account sees a different part of the app.
            </p>
          </div>

          <div className="divide-y divide-ink-200">
            {GROUPS.map((group) => {
              const accounts = group.roles.flatMap((role) => state.users.filter((user) => user.role === role))
              if (accounts.length === 0) return null

              return (
                <section key={group.title} className="px-5 py-4">
                  <h3 className="label mb-2">{group.title}</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {accounts.map((user) => (
                      <li key={user.userId}>
                        <AccountButton user={user} onPick={() => signIn(user.userId)} />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-ink-500">
          Dummy data — no real DIC staff appear anywhere. Today is fixed at 1 October 2026 for the demo.
        </p>
      </main>
    </div>
  )
}

function AccountButton({ user, onPick }: { user: User; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex w-full items-center gap-3 rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-left
        transition-colors hover:border-brand-400 hover:bg-brand-50"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600 group-hover:bg-white">
        {initials(user.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-900">{user.name}</span>
        <span className="block truncate text-xs text-ink-500">{ROLE_LABELS[user.role]}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-400">{WHAT_THEY_DO[user.role]}</span>
      </span>
      <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-brand-600" />
    </button>
  )
}
