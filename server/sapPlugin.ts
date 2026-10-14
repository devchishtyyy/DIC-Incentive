/**
 * The app's own roster endpoint.
 *
 * The browser asks this server for the roster and gets a list of people back. It never
 * sees the client ID, the company ID or the signing key, and it never holds a bearer
 * token — the three-step OAuth exchange happens here, in Node, where the key lives.
 *
 *   GET /api/sap/status   → { configured, apiServer, range }   (no secrets, ever)
 *   GET /api/sap/roster   → { ok: true, users: [...] }
 *                         → { ok: false, stage, message, detail }  on failure
 *
 * This replaces the old `/sapi` pass-through proxy, which made the browser run the OAuth
 * flow itself and so required the key to be shipped to it. That was the wrong shape.
 */

import https from 'node:https'
import type { Connect, Plugin } from 'vite'
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

  return {
    name: 'dic-sap-api',
    apply: 'serve',

    configureServer(server) {
      server.middlewares.use('/api/sap/status', (_request, response) => {
        // Deliberately says only whether a sync is possible and over what range. Which
        // account signs it, and with what key, is none of the browser's business.
        send(response, 200, {
          configured,
          apiServer: credentials.apiServer,
          range,
          reason: configured ? '' : 'SAP credentials are not configured on the server. Fill in .env.local and restart the dev server.',
        })
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
