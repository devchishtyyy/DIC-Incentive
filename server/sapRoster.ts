/**
 * The SuccessFactors connection. Server side, and only server side.
 *
 * The private key registered against the OAuth client can mint an assertion for *any* user
 * in the tenant, so it must never travel to a browser. Nothing in this file is imported by
 * `src/` — it runs inside the dev server (and inside `npm run sap:roster`), reads the key
 * from the environment, and hands the browser nothing but the finished list of users.
 *
 * The flow SAP documents, in order:
 *
 *   1. POST /oauth/idp     → SuccessFactors signs a SAML assertion with the private key.
 *                            Valid ten minutes.
 *   2. POST /oauth/token   → exchange that assertion for an access token. Valid 24 hours.
 *   3. GET  /odata/v2/User → read the roster with the token as a bearer, following
 *                            `__next` until the pages run out.
 *
 * Step 2's answer is cached here until it expires, so a restart or a second sync in the
 * same day costs one request instead of three.
 */

import https from 'node:https'
import { URL, URLSearchParams } from 'node:url'

export type FetchStage = 'assertion' | 'token' | 'users' | 'done'

export interface SapCredentials {
  /** e.g. https://api44.sapsf.com — Admin Center → API Server. */
  apiServer: string
  clientId: string
  companyId: string
  /** The SuccessFactors user the token acts as — usually an integration admin. */
  userId: string
  privateKey: string
}

export interface RosterRange {
  fromUserId: string
  toUserId: string
}

export interface Progress {
  stage: FetchStage
  message: string
  count: number
}

export class SapError extends Error {
  constructor(
    message: string,
    readonly stage: FetchStage,
    readonly detail: string = '',
  ) {
    super(message)
    this.name = 'SapError'
  }
}

export type SapUser = Record<string, unknown>

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface HttpResult {
  status: number
  body: string
}

/**
 * One request, over `node:https` rather than global `fetch`.
 *
 * Node's fetch is undici, which ignores an `agent` — and a custom CA list is exactly what a
 * corporate TLS-inspecting proxy needs. Going through `node:https` keeps the certificate
 * handling in one obvious place.
 */
function request(url: string, init: { method: string; headers: Record<string, string>; body?: string; agent: https.Agent }): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const call = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: init.method,
        headers: init.headers,
        agent: init.agent,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        // The whole body, always: an assertion runs to kilobytes and a page of users to
        // far more, so truncating anywhere here would quietly corrupt both.
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )

    call.on('error', reject)
    if (init.body) call.write(init.body)
    call.end()
  })
}

/** Error text is for a person to read, so it is cut to something a notice can hold. */
export function forDisplay(body: string): string {
  const trimmed = body.trim()
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed
}

/** A TLS failure has one cause on a corporate network, and one fix. */
export function describeTransportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/self[- ]signed|unable to verify|CERT_|certificate/i.test(message)) {
    return `${message} — your network re-signs HTTPS with an internal certificate authority. The dev server reads the Windows certificate store on startup; see certs/README.md if it still fails.`
  }
  return message
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export function baseUrl(credentials: Pick<SapCredentials, 'apiServer'>): string {
  return (credentials.apiServer || 'https://api44.sapsf.com').replace(/\/+$/, '')
}

/**
 * The tenant's own token endpoint.
 *
 * This is not a transport detail — SAP signs it into the assertion as `Recipient`, and
 * /oauth/token checks that value names itself. Send anything else and the assertion comes
 * back "invalid".
 */
export function tokenUrlFor(credentials: Pick<SapCredentials, 'apiServer'>): string {
  return `${baseUrl(credentials)}/oauth/token`
}

/** The OData query for one Emp ID range of active users. */
export function buildUserQuery(credentials: Pick<SapCredentials, 'apiServer'>, range: RosterRange): string {
  const filter = `userId ge '${range.fromUserId}' and userId le '${range.toUserId}' and status eq 't'`
  const params = new URLSearchParams({ $filter: filter, $format: 'json' })
  return `${baseUrl(credentials)}/odata/v2/User?${params.toString()}`
}

export function credentialsAreComplete(credentials: Partial<SapCredentials>): boolean {
  return Boolean(credentials.clientId && credentials.companyId && credentials.userId && credentials.privateKey)
}

// ---------------------------------------------------------------------------
// 1. Assertion
// ---------------------------------------------------------------------------

export async function requestAssertion(credentials: SapCredentials, agent: https.Agent): Promise<string> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    user_id: credentials.userId,
    token_url: tokenUrlFor(credentials),
    private_key: credentials.privateKey,
  }).toString()

  let result: HttpResult
  try {
    result = await request(`${baseUrl(credentials)}/oauth/idp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(Buffer.byteLength(body)) },
      body,
      agent,
    })
  } catch (error) {
    throw new SapError('Could not reach SuccessFactors.', 'assertion', describeTransportError(error))
  }

  if (result.status < 200 || result.status >= 300) {
    throw new SapError(`SuccessFactors refused to sign the assertion (HTTP ${result.status}).`, 'assertion', forDisplay(result.body))
  }
  if (!result.body.trim()) {
    throw new SapError('SuccessFactors returned an empty assertion.', 'assertion', 'Check the client ID and the private key.')
  }
  // The endpoint answers with the base64 assertion as plain text.
  return result.body.trim()
}

// ---------------------------------------------------------------------------
// 2. Token
// ---------------------------------------------------------------------------

export interface AccessToken {
  token: string
  /** Epoch ms. SAP reports `expires_in` seconds; 24 hours is the usual answer. */
  expiresAt: number
}

export async function requestToken(credentials: SapCredentials, assertion: string, agent: https.Agent, now = Date.now()): Promise<AccessToken> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    company_id: credentials.companyId,
    grant_type: 'urn:ietf:params:oauth:grant-type:saml2-bearer',
    assertion,
  }).toString()

  let result: HttpResult
  try {
    result = await request(`${baseUrl(credentials)}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(Buffer.byteLength(body)) },
      body,
      agent,
    })
  } catch (error) {
    throw new SapError('Could not reach the token endpoint.', 'token', describeTransportError(error))
  }

  if (result.status < 200 || result.status >= 300) {
    throw new SapError(`The token exchange failed (HTTP ${result.status}).`, 'token', forDisplay(result.body))
  }

  let parsed: { access_token?: string; expires_in?: number | string; error?: string; error_description?: string }
  try {
    parsed = JSON.parse(result.body)
  } catch {
    throw new SapError('The token response was not JSON.', 'token', forDisplay(result.body))
  }

  if (!parsed.access_token) {
    throw new SapError(
      parsed.error_description || parsed.error || 'No access token in the response.',
      'token',
      'The assertion is generated fresh each time, so a failure here usually means the company ID or the client ID is wrong.',
    )
  }

  const seconds = Number(parsed.expires_in)
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds : 24 * 60 * 60
  // Expire a minute early rather than discover it mid-page.
  return { token: parsed.access_token, expiresAt: now + (lifetime - 60) * 1000 }
}

// ---------------------------------------------------------------------------
// 3. The roster
// ---------------------------------------------------------------------------

export async function fetchUsers(
  credentials: SapCredentials,
  token: string,
  range: RosterRange,
  agent: https.Agent,
  onProgress?: (progress: Progress) => void,
): Promise<SapUser[]> {
  const users: SapUser[] = []
  let url: string | null = buildUserQuery(credentials, range)
  let pages = 0

  while (url) {
    let result: HttpResult
    try {
      result = await request(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, agent })
    } catch (error) {
      throw new SapError('Could not read the User entity.', 'users', describeTransportError(error))
    }

    if (result.status < 200 || result.status >= 300) {
      throw new SapError(`Reading the User entity failed (HTTP ${result.status}).`, 'users', forDisplay(result.body))
    }

    let full: { d?: { results?: SapUser[]; __next?: string } }
    try {
      full = JSON.parse(result.body)
    } catch {
      throw new SapError('The User response was not JSON.', 'users', forDisplay(result.body))
    }

    users.push(...(full.d?.results ?? []))
    pages += 1
    onProgress?.({ stage: 'users', message: `Read ${users.length} users over ${pages} page(s)…`, count: users.length })

    // OData v2 pages at 1000 by default; without following this the roster stops short.
    url = full.d?.__next ?? null
  }

  return users
}

// ---------------------------------------------------------------------------
// The whole flow, with the token cached
// ---------------------------------------------------------------------------

let cached: AccessToken | null = null

/** Exposed for tests and for a forced re-authentication. */
export function clearTokenCache(): void {
  cached = null
}

export async function accessToken(credentials: SapCredentials, agent: https.Agent, onProgress?: (progress: Progress) => void): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token

  onProgress?.({ stage: 'assertion', message: 'Asking SuccessFactors to sign a SAML assertion…', count: 0 })
  const assertion = await requestAssertion(credentials, agent)

  onProgress?.({ stage: 'token', message: 'Exchanging the assertion for an access token…', count: 0 })
  cached = await requestToken(credentials, assertion, agent)
  return cached.token
}

export async function fetchRoster(
  credentials: SapCredentials,
  range: RosterRange,
  agent: https.Agent,
  onProgress?: (progress: Progress) => void,
): Promise<SapUser[]> {
  const token = await accessToken(credentials, agent, onProgress)

  onProgress?.({ stage: 'users', message: 'Reading the roster…', count: 0 })
  let users: SapUser[]
  try {
    users = await fetchUsers(credentials, token, range, agent, onProgress)
  } catch (error) {
    // A token that SAP has revoked looks exactly like a bad one. Retry once from scratch
    // rather than making somebody restart the dev server.
    if (error instanceof SapError && error.stage === 'users' && /HTTP 401|HTTP 403/.test(error.message)) {
      clearTokenCache()
      users = await fetchUsers(credentials, await accessToken(credentials, agent, onProgress), range, agent, onProgress)
    } else {
      throw error
    }
  }

  onProgress?.({ stage: 'done', message: `Read ${users.length} users.`, count: users.length })
  return users
}
