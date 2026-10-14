/**
 * How the app asks for the roster.
 *
 * It asks its own server, and that is the whole of it:
 *
 *     GET /api/sap/roster  →  { ok: true, users: [...] }
 *
 * No client ID, no company ID, no signing key, no bearer token. The SAML assertion, the
 * token exchange and the paged OData read all happen in Node — see `server/sapRoster.ts`.
 * A credential that reaches the browser has been given away, so none of them do.
 *
 * This file therefore has nothing to keep secret and nothing to configure.
 */

import type { SapUser } from './sapImport'

export type FetchStage = 'assertion' | 'token' | 'users' | 'done'

export interface FetchProgress {
  stage: FetchStage
  message: string
  /** Users read so far, so a long fetch shows movement. */
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

export interface SapStatus {
  configured: boolean
  apiServer: string
  range: { fromUserId: string; toUserId: string }
  reason: string
}

const ROSTER_URL = '/api/sap/roster'
const STATUS_URL = '/api/sap/status'

/**
 * A built bundle served off a file share has no server behind it, so the endpoint answers
 * with the index page instead of JSON. Saying that plainly beats a parse error.
 */
const NO_SERVER =
  'The roster API did not answer. The live sync needs `npm run dev` — a built copy served from a file share has no server to hold the credentials, so use the file import instead.'

function isHtml(text: string): boolean {
  return /^\s*<(!doctype|html)/i.test(text)
}

/** Whether a live sync is possible at all. Reports no secrets — only yes or no, and why not. */
export async function fetchStatus(signal?: AbortSignal): Promise<SapStatus> {
  const unavailable: SapStatus = { configured: false, apiServer: '', range: { fromUserId: '', toUserId: '' }, reason: NO_SERVER }

  try {
    const response = await fetch(STATUS_URL, { signal })
    const text = await response.text()
    if (!response.ok || isHtml(text)) return unavailable
    return JSON.parse(text) as SapStatus
  } catch {
    return unavailable
  }
}

/**
 * The roster, as the server read it from SuccessFactors.
 *
 * `onProgress` exists so the screens can keep their wording; the real steps happen server
 * side in one request, so the stages are reported around it rather than during it.
 */
export async function fetchRoster(onProgress?: (progress: FetchProgress) => void, signal?: AbortSignal): Promise<SapUser[]> {
  onProgress?.({ stage: 'assertion', message: 'Signing in to SuccessFactors…', count: 0 })

  let response: Response
  try {
    response = await fetch(ROSTER_URL, { headers: { Accept: 'application/json' }, signal })
  } catch (error) {
    throw new SapError('Could not reach the roster API.', 'assertion', String(error))
  }

  const text = await response.text()
  if (isHtml(text)) throw new SapError(NO_SERVER, 'assertion')

  let payload: { ok?: boolean; users?: SapUser[]; stage?: FetchStage; message?: string; detail?: string }
  try {
    payload = JSON.parse(text)
  } catch {
    throw new SapError(`The roster API answered with something that was not JSON (HTTP ${response.status}).`, 'assertion', text.slice(0, 600))
  }

  if (!response.ok || !payload.ok) {
    throw new SapError(payload.message ?? `The roster sync failed (HTTP ${response.status}).`, payload.stage ?? 'assertion', payload.detail ?? '')
  }

  const users = payload.users ?? []
  onProgress?.({ stage: 'done', message: `Read ${users.length} users.`, count: users.length })
  return users
}
