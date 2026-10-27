/**
 * Sign-in.
 *
 * One form, no other way in. The password is checked against SuccessFactors by this app's
 * own server; nothing is stored, and there is no demo door beside it.
 *
 * Built against the form and accessibility rules rather than a visual style: a visible
 * label on each field (not a placeholder standing in for one), the error beside the field
 * that caused it and announced to a screen reader, focus moved to that field, a disabled
 * button with a spinner while the network is busy, and autocomplete attributes so a
 * password manager can do its job. Restrained on purpose — this is a door, not a brochure.
 */

import { useEffect, useRef, useState } from 'react'
import { signInWithSap, type AuthOutcome } from '../data/authClient'
import { useApp } from '../store/AppStore'
import { userForSapUsername } from '../store/selectors'
import { Icon } from '../components/ui'

type Problem = { outcome: AuthOutcome | 'unlinked'; message: string; field: 'username' | 'password' | null }

export default function Login() {
  const { state, signIn } = useApp()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)

  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    usernameRef.current?.focus()
    return () => abort.current?.abort()
  }, [])

  // After a failure, put the cursor where the fix is — not back at the top of the form.
  useEffect(() => {
    if (!problem) return
    if (problem.field === 'password') passwordRef.current?.focus()
    else if (problem.field === 'username') usernameRef.current?.focus()
  }, [problem])

  const submit = async () => {
    if (busy || !username.trim() || !password) return
    setBusy(true)
    setProblem(null)

    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller

    const result = await signInWithSap(username, password, controller.signal)

    setPassword('')
    setBusy(false)

    if (!result.ok) {
      setProblem({
        outcome: result.outcome,
        message: result.message,
        field: result.outcome === 'rejected' ? 'password' : null,
      })
      return
    }

    const account = userForSapUsername(state, result.username)
    if (!account) {
      setProblem({
        outcome: 'unlinked',
        message: `${result.username} signed in, but it is not linked to a role in this app. Ask the Super Admin to link it on People → Users.`,
        field: 'username',
      })
      return
    }

    signIn(account.userId)
  }

  const disabled = busy || !username.trim() || !password

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink-100 px-4 py-10">
      <main className="w-full max-w-sm">
        {/* --- Identity ------------------------------------------------------ */}
        <div className="mb-7 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-brand-600 text-sm font-bold tracking-wide text-white">
            DIC
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">Production Incentive</h1>
          <p className="mt-1 text-sm text-ink-500">DIC Pakistan Limited</p>
        </div>

        {/* --- The form ------------------------------------------------------ */}
        <div className="card overflow-hidden">
          {/* A single accent edge; enough to read as corporate without decorating. */}
          <div className="h-1 bg-brand-600" aria-hidden="true" />

          <form
            className="p-6"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <h2 className="text-sm font-semibold text-ink-900">Sign in</h2>
            <p className="mt-1 text-xs text-ink-500">Use the same credentials as SuccessFactors.</p>

            <div className="mt-5">
              <label className="label" htmlFor="login-username">
                Employee number
              </label>
              <input
                ref={usernameRef}
                id="login-username"
                name="username"
                className={`input mt-1.5 py-2.5 ${problem?.field === 'username' ? 'input-error' : ''}`}
                value={username}
                autoComplete="username"
                inputMode="numeric"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
                aria-invalid={problem?.field === 'username'}
                aria-describedby={problem ? 'login-problem' : undefined}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>

            <div className="mt-4">
              <label className="label" htmlFor="login-password">
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  ref={passwordRef}
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  className={`input py-2.5 pr-11 ${problem?.field === 'password' ? 'input-error' : ''}`}
                  value={password}
                  autoComplete="current-password"
                  disabled={busy}
                  aria-invalid={problem?.field === 'password'}
                  aria-describedby={problem ? 'login-problem' : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-ink-400
                    transition-colors hover:text-ink-700 disabled:cursor-not-allowed"
                  onClick={() => setShowPassword((shown) => !shown)}
                  disabled={busy}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  tabIndex={-1}
                >
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Announced to a screen reader without stealing focus from the field. */}
            <div aria-live="polite">
              {problem && (
                <p
                  id="login-problem"
                  role="alert"
                  className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                    problem.outcome === 'rejected'
                      ? 'border-bad-100 bg-bad-50 text-bad-700'
                      : 'border-warn-100 bg-warn-50 text-warn-700'
                  }`}
                >
                  <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{problem.message}</span>
                </p>
              )}
            </div>

            <button type="submit" className="btn btn-primary mt-5 w-full py-2.5" disabled={disabled}>
              {busy ? (
                <>
                  <span
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    aria-hidden="true"
                  />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-ink-400">
          Production / Output and six further KPIs · 16th to the 15th
        </p>
      </main>
    </div>
  )
}
