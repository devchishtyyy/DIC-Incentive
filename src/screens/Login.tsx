/**
 * Sign-in.
 *
 * The password is checked against SuccessFactors: the server posts it to the tenant with
 * Basic auth and reports back yes or no. Nothing is stored — no token, no password, and
 * nothing in localStorage beyond which account is signed in.
 *
 * A verified sign-in says *who* somebody is. It does not say what they may do, because the
 * endpoint used to check it cannot answer that. So the role comes from this app: the Admin
 * links a SAP username to an account, and somebody verified but unlinked is told plainly
 * rather than given a role by guesswork.
 *
 * The test accounts below remain because the app has no other way in until those links
 * exist, and because a demo needs to show every role. They are a prototype convenience and
 * the screen says so.
 */

import { useEffect, useRef, useState } from 'react'
import { signInWithSap, type AuthOutcome } from '../data/authClient'
import { ROLE_LABELS, type RoleId, type User } from '../domain/types'
import { useApp } from '../store/AppStore'
import { userForSapUsername } from '../store/selectors'
import { Icon } from '../components/ui'

const WHAT_THEY_DO: Record<RoleId, string> = {
  OFFICE_EXEC: 'Enter the daily Output Batches and submit the month',
  HOD: 'Set targets, review and sign off the month',
  OPS_MANAGER: 'Approve the month, or send it back to the HOD',
  FINANCE: 'Export an approved month for the salary run',
  EHS_REP: 'Read-only view of the scorecard',
  MD_CEO: 'Approve new employees, rates and extraordinary awards',
  ADMIN: 'Maintain employees, points, departments and settings',
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

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ outcome: AuthOutcome | 'unlinked'; message: string } | null>(null)
  const [showTestAccounts, setShowTestAccounts] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    usernameRef.current?.focus()
    return () => abort.current?.abort()
  }, [])

  const submit = async () => {
    if (busy || !username.trim() || !password) return
    setBusy(true)
    setProblem(null)

    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller

    const result = await signInWithSap(username, password, controller.signal)

    // Whatever happened, the password has served its purpose.
    setPassword('')
    setBusy(false)

    if (!result.ok) {
      setProblem({ outcome: result.outcome, message: result.message })
      return
    }

    const account = userForSapUsername(state, result.username)
    if (!account) {
      setProblem({
        outcome: 'unlinked',
        message: `${result.username} is a valid SuccessFactors sign-in, but nobody has linked it to an account in this app yet. The System Admin can do that on People → Users.`,
      })
      return
    }

    signIn(account.userId)
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ink-100 px-4 py-10">
      <main className="w-full max-w-md">
        <header className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">DIC</div>
          <div>
            <h1 className="text-lg font-semibold text-ink-900">Production Incentive</h1>
            <p className="text-sm text-ink-500">Sign in with your SuccessFactors account</p>
          </div>
        </header>

        {/* --- The real sign-in --------------------------------------------- */}
        <form
          className="card card-pad"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="label" htmlFor="login-username">
            Employee number
          </label>
          <input
            ref={usernameRef}
            id="login-username"
            className="input mt-1"
            value={username}
            autoComplete="username"
            inputMode="numeric"
            placeholder="e.g. 10001234"
            disabled={busy}
            onChange={(event) => setUsername(event.target.value)}
          />
          <p className="mt-1 text-xs text-ink-500">
            Just the number — <span className="font-mono">@packagesli</span> is added for you.
          </p>

          <label className="label mt-3" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            className="input mt-1"
            value={password}
            autoComplete="current-password"
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />

          {problem && (
            <div
              role="alert"
              className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                problem.outcome === 'rejected'
                  ? 'border-bad-100 bg-bad-50 text-bad-700'
                  : 'border-warn-100 bg-warn-50 text-warn-700'
              }`}
            >
              {problem.message}
            </div>
          )}

          <button type="submit" className="btn btn-primary mt-4 w-full" disabled={busy || !username.trim() || !password}>
            {busy ? 'Checking with SuccessFactors…' : 'Sign in'}
          </button>

          <p className="mt-3 text-center text-[11px] text-ink-400">
            Your password goes to SuccessFactors to be checked and is not stored anywhere by this app.
          </p>
        </form>

        {/* --- Test accounts ------------------------------------------------- */}
        <div className="card mt-4 overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3 text-left"
            onClick={() => setShowTestAccounts((open) => !open)}
            aria-expanded={showTestAccounts}
          >
            <Icon name="people" className="h-4 w-4 text-ink-400" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-ink-800">Sign in as a test account</span>
              <span className="block text-xs text-ink-500">No password. For the demo, and until SAP sign-ins are linked to roles.</span>
            </span>
            <Icon name="chevron" className={`h-3.5 w-3.5 text-ink-400 transition-transform ${showTestAccounts ? 'rotate-90' : ''}`} />
          </button>

          {showTestAccounts && (
            <div className="divide-y divide-ink-200 border-t border-ink-200">
              {GROUPS.map((group) => {
                const accounts = group.roles.flatMap((role) => state.users.filter((user) => user.role === role))
                if (accounts.length === 0) return null

                return (
                  <section key={group.title} className="px-4 py-3">
                    <h3 className="label mb-2">{group.title}</h3>
                    <ul className="grid gap-2">
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
          )}
        </div>
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
