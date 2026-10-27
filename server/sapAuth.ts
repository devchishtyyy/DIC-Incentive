/**
 * Checking a password against SuccessFactors.
 *
 * SAP has no "verify this password" endpoint, so the check is a cheap authenticated read:
 * if `GET /odata/v2/Background_Community` answers 200 with Basic auth, the credentials are
 * good. Verified against the tenant — correct password 200; wrong password, unknown user,
 * missing `@packagesli` suffix and no credentials at all each 401.
 *
 * The entity returns an empty result set for an ordinary user, and that is the point: the
 * check needs the status code, not the data. It is deliberately an entity nobody has a
 * reason to hold rows in, so the probe reads as little as possible about anybody.
 *
 * **The password lives in memory for the length of one request and is never stored, never
 * logged and never written to the audit trail.** It does not reach the browser's own
 * storage either: the browser posts it here and forgets it. Nothing in `src/` imports this
 * file, and `sapRoster.test.ts` asserts that.
 */

import https from 'node:https'
import { URL } from 'node:url'

/** The tenant suffix every SuccessFactors username carries. */
export const COMPANY_SUFFIX = 'packagesli'

export type AuthOutcome = 'ok' | 'rejected' | 'forbidden' | 'unavailable'

export interface AuthResult {
  outcome: AuthOutcome
  /** The username as it was sent, suffix included. Safe to log; the password is not. */
  username: string
  message: string
}

/**
 * `10009671` → `10009671@packagesli`.
 *
 * The suffix is not optional: without it SAP answers 401, which is why the app adds it
 * rather than asking forty people on a factory floor to type it. Somebody who types the
 * full thing out of habit is not punished for it.
 */
export function qualifyUsername(raw: string, suffix = COMPANY_SUFFIX): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return trimmed.includes('@') ? trimmed : `${trimmed}@${suffix}`
}

/** The probe URL. `$top=1` because the status code is the whole answer. */
export function authProbeUrl(apiServer: string): string {
  const base = (apiServer || 'https://api44.sapsf.com').replace(/\/+$/, '')
  return `${base}/odata/v2/Background_Community?$top=1&$format=json`
}

interface Probe {
  status: number
  body: string
}

function request(url: string, authorization: string, agent: https.Agent): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const call = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { Authorization: authorization, Accept: 'application/json' },
        agent,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    call.on('error', reject)
    call.end()
  })
}

/**
 * True when the body is the OData envelope rather than, say, a corporate proxy's sign-in
 * page returning a cheerful 200. A 200 that is not OData is not an authentication.
 */
export function looksLikeOData(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { d?: unknown }
    return typeof parsed === 'object' && parsed !== null && 'd' in parsed
  } catch {
    return false
  }
}

export function outcomeFor(status: number, body: string): { outcome: AuthOutcome; message: string } {
  if (status === 200) {
    return looksLikeOData(body)
      ? { outcome: 'ok', message: '' }
      : {
          outcome: 'unavailable',
          message: 'SuccessFactors answered, but not with SAP data. Something on the network is intercepting the request.',
        }
  }
  if (status === 401) return { outcome: 'rejected', message: 'That username or password is not right.' }
  if (status === 403) {
    // Valid credentials, no permission on the probe entity. Not a sign-in failure, but not
    // something to wave through either — somebody has to look at the API permission role.
    return {
      outcome: 'forbidden',
      message: 'Your sign-in is valid, but the account is not allowed to read the check used here. Ask IT about its API permission role.',
    }
  }
  if (status >= 500) return { outcome: 'unavailable', message: `SuccessFactors is not answering (HTTP ${status}). Try again shortly.` }
  return { outcome: 'unavailable', message: `Unexpected reply from SuccessFactors (HTTP ${status}).` }
}

/**
 * Verifies one sign-in.
 *
 * Returns an outcome, never a token and never the password. The caller decides what a
 * verified username is allowed to do — SAP is asked "is this person who they say", not
 * "what may they do", because this endpoint cannot answer the second question.
 */
export async function verifyCredentials(
  rawUsername: string,
  password: string,
  apiServer: string,
  agent: https.Agent,
): Promise<AuthResult> {
  const username = qualifyUsername(rawUsername)

  if (!username || !password) {
    return { outcome: 'rejected', username, message: 'Enter both a username and a password.' }
  }

  const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`

  let probe: Probe
  try {
    probe = await request(authProbeUrl(apiServer), authorization, agent)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const trust = /self[- ]signed|unable to verify|CERT_|certificate/i.test(detail)
    return {
      outcome: 'unavailable',
      username,
      message: trust
        ? 'Could not reach SuccessFactors: the network re-signs HTTPS with a certificate this server does not trust. See certs/README.md.'
        : `Could not reach SuccessFactors. ${detail}`,
    }
  }

  const { outcome, message } = outcomeFor(probe.status, probe.body)
  return { outcome, username, message }
}
