/**
 * Signing in.
 *
 * The browser posts a username and a password to this app's own server and gets back yes
 * or no. SuccessFactors is never called from here, and no credential is kept: the password
 * is in a React state field for as long as the form is open and is gone the moment the
 * answer comes back. Nothing is written to localStorage.
 *
 * The `@packagesli` suffix is added on the server, not here — somebody on a factory floor
 * types their employee number and nothing else.
 */

export type AuthOutcome = 'ok' | 'rejected' | 'forbidden' | 'unavailable'

export interface SignInResult {
  ok: boolean
  outcome: AuthOutcome
  /** The qualified username SAP accepted, when it did. */
  username: string
  message: string
}

const LOGIN_URL = '/api/auth/login'

const NO_SERVER =
  'Sign-in needs `npm run dev`. A built copy served from a file share has no server to check the password against, so use a test account below.'

export async function signInWithSap(username: string, password: string, signal?: AbortSignal): Promise<SignInResult> {
  let response: Response
  try {
    response = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal,
    })
  } catch (error) {
    return { ok: false, outcome: 'unavailable', username: '', message: `Could not reach the sign-in service. ${String(error)}` }
  }

  const text = await response.text()

  // A dev server that is not running answers with the index page, not JSON.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    return { ok: false, outcome: 'unavailable', username: '', message: NO_SERVER }
  }

  let payload: Partial<SignInResult>
  try {
    payload = JSON.parse(text) as Partial<SignInResult>
  } catch {
    return { ok: false, outcome: 'unavailable', username: '', message: NO_SERVER }
  }

  if (!response.ok || !payload.ok) {
    return {
      ok: false,
      outcome: payload.outcome ?? 'unavailable',
      username: payload.username ?? '',
      message: payload.message ?? 'Sign-in failed.',
    }
  }

  return { ok: true, outcome: 'ok', username: payload.username ?? '', message: '' }
}
