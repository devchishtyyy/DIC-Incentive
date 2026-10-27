/**
 * The app's own roster endpoint.
 *
 * The browser asks this server for the roster and gets a list of people back. It never
 * sees the client ID, the company ID or the signing key, and it never holds a bearer
 * token — the three-step OAuth exchange happens here, in Node, where the key lives.
 *
 *   GET  /api/sap/status  → { configured, apiServer, range }   (no secrets, ever)
 *   GET  /api/sap/roster  → { ok: true, users: [...] }
 *                         → { ok: false, stage, message, detail }  on failure
 *   POST /api/auth/login  → { ok: true, username }   password checked against SAP
 *                         → { ok: false, outcome, message }
 *
 * This replaces the old `/sapi` pass-through proxy, which made the browser run the OAuth
 * flow itself and so required the key to be shipped to it. That was the wrong shape.
 */

import https from 'node:https'
import type { Connect, Plugin } from 'vite'
import { callerAddress, LoginThrottle, throttleKeys } from './loginThrottle'
import { verifyCredentials } from './sapAuth'
import {
  credentialsAreComplete,
  fetchRoster,
  SapError,
  type RosterRange,
  type SapCredentials,
} from './sapRoster'

export interface SapPluginOptions {
  credentials: SapCredentials
  range: RosterRange
  caBundle: string[]
  insecureTls: boolean
}

function send(response: Parameters<Connect.NextHandleFunction>[1], status: number, payload: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  // The roster is live data read per request; a cached copy would defeat the point.
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

export function sapApiPlugin(options: SapPluginOptions): Plugin {
  const { credentials, range, caBundle, insecureTls } = options

  const agent = insecureTls
    ? new https.Agent({ rejectUnauthorized: false, keepAlive: true })
    : new https.Agent({ ca: caBundle.length > 0 ? caBundle : undefined, keepAlive: true })

  const configured = credentialsAreComplete(credentials)

  // One sync at a time. Opening the app in three tabs should cost one round of OAuth,
  // not three — they all wait on the same promise.
  let inFlight: Promise<unknown[]> | null = null

  // Guards both the app and the SAP accounts behind it. See loginThrottle.ts.
  const throttle = new LoginThrottle()

  return {
    name: 'dic-sap-api',
    apply: 'serve',

    configureServer(server) {
      server.middlewares.use('/api/sap/status', (_request, response) => {
        // Deliberately says only whether a sync is possible and over what range. Which
        // account signs it, and with what key, is none of the browser's business.
        send(response, 200, {
          configured,
          // Sign-in needs only the tenant address, not the integration key, so it works
          // even on a server with no roster credentials configured.
          signInAvailable: true,
          apiServer: credentials.apiServer,
          range,
          reason: configured ? '' : 'SAP credentials are not configured on the server. Fill in .env.local and restart the dev server.',
        })
      })

      /*
       * Sign-in.
       *
       * The browser posts a username and password and gets back yes or no. It never holds
       * a token, and the password is in memory here for one request: not stored, not
       * logged, not audited. Only the username — which is not a secret — ever appears in
       * the console, and only when a sign-in fails, so a locked-out person can be helped.
       */
      server.middlewares.use('/api/auth/login', async (request, response) => {
        if (request.method !== 'POST') {
          send(response, 405, { ok: false, outcome: 'unavailable', message: 'POST only.' })
          return
        }

        let body = ''
        try {
          await new Promise<void>((resolve, reject) => {
            request.on('data', (chunk: Buffer) => {
              body += chunk.toString('utf8')
              // A sign-in is two short strings; anything larger is not one.
              if (body.length > 4096) reject(new Error('Request too large'))
            })
            request.on('end', () => resolve())
            request.on('error', reject)
          })
        } catch {
          send(response, 400, { ok: false, outcome: 'rejected', message: 'Could not read the sign-in request.' })
          return
        }

        let parsed: { username?: string; password?: string }
        try {
          parsed = JSON.parse(body || '{}')
        } catch {
          send(response, 400, { ok: false, outcome: 'rejected', message: 'Sign-in request was not JSON.' })
          return
        }

        const username = parsed.username ?? ''
        const keys = throttleKeys(username, callerAddress(request.socket?.remoteAddress, request.headers['x-forwarded-for']))

        /*
         * Refuse before SAP is ever called. That is the point: it stops a guessing attack
         * reaching the tenant and tripping the real account's lockout policy, which would
         * leave somebody unable to sign in to SuccessFactors itself.
         */
        throttle.prune()
        const verdict = throttle.check(keys)
        if (!verdict.allowed) {
          // eslint-disable-next-line no-console
          console.warn(`  Sign-in throttled for ${keys.join(' ')} — ${verdict.retryAfterSeconds}s remaining`)
          response.setHeader('Retry-After', String(verdict.retryAfterSeconds))
          send(response, 429, { ok: false, outcome: 'rejected', message: verdict.message })
          return
        }

        const result = await verifyCredentials(username, parsed.password ?? '', credentials.apiServer, agent)

        if (result.outcome !== 'ok') {
          // Only a wrong credential counts against the budget. A tenant that is down, or a
          // network that is broken, must not lock somebody out of their own account.
          if (result.outcome === 'rejected') throttle.recordFailure(keys)

          // eslint-disable-next-line no-console
          console.log(`  Sign-in ${result.outcome} for ${result.username || '(no username)'}`)
          send(response, result.outcome === 'rejected' ? 401 : 502, {
            ok: false,
            outcome: result.outcome,
            message: result.message,
          })
          return
        }

        throttle.recordSuccess(keys)
        send(response, 200, { ok: true, username: result.username })
      })

      server.middlewares.use('/api/sap/roster', async (_request, response) => {
        if (!configured) {
          send(response, 503, {
            ok: false,
            stage: 'assertion',
            message: 'SAP credentials are not configured on the server.',
            detail: 'Set SF_CLIENT_ID, SF_COMPANY_ID, SF_USER_ID and SF_PRIVATE_KEY in .env.local, then restart the dev server.',
          })
          return
        }

        try {
          if (!inFlight) {
            inFlight = fetchRoster(credentials, range, agent, (progress) => {
              if (progress.stage !== 'users' || progress.count % 500 === 0) {
                // eslint-disable-next-line no-console
                console.log(`  SAP sync: ${progress.message}`)
              }
            }).finally(() => {
              inFlight = null
            })
          }

          const users = await inFlight
          send(response, 200, { ok: true, users })
        } catch (error) {
          const stage = error instanceof SapError ? error.stage : 'assertion'
          const message = error instanceof Error ? error.message : String(error)
          const detail = error instanceof SapError ? error.detail : ''
          // eslint-disable-next-line no-console
          console.error(`\n  SAP sync failed at the ${stage} step: ${message}\n  ${detail}\n`)
          send(response, 502, { ok: false, stage, message, detail })
        }
      })
    },
  }
}
