/**
 * The API server — bundled to `backend/server.js` by `npm run build`.
 *
 * Plain Node, no Vite. It answers `/api/*` and nothing else; IIS sends everything else to
 * the frontend server on the next port.
 *
 *   GET  /api/health      liveness
 *   GET  /api/sap/status  whether a sync is possible, and over what range. No secrets.
 *   GET  /api/sap/roster  the roster from SuccessFactors
 *   POST /api/auth/login  a password checked against SAP, throttled
 *
 * The SuccessFactors key never leaves this process. The browser calls these endpoints and
 * gets back finished answers — see SECURITY.md.
 */

import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import tls from 'node:tls'
import { callerAddress, LoginThrottle, throttleKeys } from './loginThrottle'
import { verifyCredentials } from './sapAuth'
import { credentialsAreComplete, fetchRoster, SapError } from './sapRoster'

const PORT = Number(process.env.PORT) || 6007
/** Loopback only: IIS is the only thing that should reach this. */
const HOST = process.env.HOST || '127.0.0.1'

/** A sign-in is two short strings. Anything larger is not one. */
const MAX_BODY = 4096

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * `.env.local` is read by hand because this runs without Vite, which is what normally
 * loads it. Same file, same names, so there is one place to put the credentials.
 */
function loadEnvFile(): void {
  const file = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(file)) return

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const at = trimmed.indexOf('=')
    if (at < 1) continue

    const key = trimmed.slice(0, at).trim()
    let value = trimmed.slice(at + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    // A real environment variable always wins over the file.
    if (process.env[key] === undefined) process.env[key] = value.replace(/\\n/g, '\n')
  }
}

/**
 * Trust anchors for the connection to SuccessFactors.
 *
 * The corporate network re-signs HTTPS with an internal root that Node does not ship, so
 * the OS store is read and merged with Node's own. Without this every call fails with
 * "self-signed certificate in certificate chain".
 */
function buildCaBundle(): string[] {
  const certificates: string[] = []
  const getCACertificates = (tls as unknown as { getCACertificates?: (type: string) => string[] }).getCACertificates

  for (const source of ['default', 'system'] as const) {
    try {
      const found = getCACertificates?.(source)
      if (Array.isArray(found)) certificates.push(...found)
    } catch {
      /* older Node, or a store it cannot read */
    }
  }

  const extra = process.env.NODE_EXTRA_CA_CERTS
  if (extra && fs.existsSync(extra)) {
    try {
      certificates.push(fs.readFileSync(extra, 'utf8'))
    } catch {
      /* unreadable file is not worth failing startup over */
    }
  }

  const certsDir = path.resolve(process.cwd(), 'certs')
  if (fs.existsSync(certsDir)) {
    for (const file of fs.readdirSync(certsDir)) {
      if (!/\.(pem|crt|cer)$/i.test(file)) continue
      try {
        certificates.push(fs.readFileSync(path.join(certsDir, file), 'utf8'))
      } catch {
        /* skip */
      }
    }
  }

  return certificates
}

// ---------------------------------------------------------------------------

loadEnvFile()

const credentials = {
  apiServer: process.env.SF_API_SERVER || 'https://api44.sapsf.com',
  clientId: process.env.SF_CLIENT_ID || '',
  companyId: process.env.SF_COMPANY_ID || '',
  userId: process.env.SF_USER_ID || '',
  privateKey: process.env.SF_PRIVATE_KEY || '',
}

const range = {
  fromUserId: process.env.SF_FROM_USER_ID || '40000000',
  toUserId: process.env.SF_TO_USER_ID || '40009999',
}

const insecureTls = process.env.SF_INSECURE_TLS === 'true'
const caBundle = buildCaBundle()
const agent = insecureTls
  ? new https.Agent({ rejectUnauthorized: false, keepAlive: true })
  : new https.Agent({ ca: caBundle.length > 0 ? caBundle : undefined, keepAlive: true })

const configured = credentialsAreComplete(credentials)
const throttle = new LoginThrottle()

/** One sync at a time: three open tabs should cost one round of OAuth, not three. */
let inFlight: Promise<unknown[]> | null = null

function send(response: http.ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(payload))
}

function readBody(request: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      if (body.length > limit) reject(new Error('Request too large'))
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

const server = http.createServer((request, response) => {
  const route = (request.url ?? '/').split('?')[0].replace(/\/$/, '') || '/'
  const method = request.method ?? 'GET'

  void (async () => {
    switch (route) {
      case '/api/health':
        send(response, 200, { ok: true, service: 'dic-incentive-backend', at: new Date().toISOString() })
        return

      case '/api/sap/status':
        // Says only whether a sync is possible and over what range. Which account signs
        // it, and with what key, is none of the browser's business.
        send(response, 200, {
          configured,
          signInAvailable: true,
          apiServer: credentials.apiServer,
          range,
          reason: configured ? '' : 'SAP credentials are not configured on the server. Set SF_* in .env.local and restart.',
        })
        return

      case '/api/auth/login': {
        if (method !== 'POST') {
          send(response, 405, { ok: false, outcome: 'unavailable', message: 'POST only.' })
          return
        }

        let parsed: { username?: string; password?: string }
        try {
          parsed = JSON.parse((await readBody(request, MAX_BODY)) || '{}')
        } catch {
          send(response, 400, { ok: false, outcome: 'rejected', message: 'Sign-in request was not readable.' })
          return
        }

        const username = parsed.username ?? ''
        const keys = throttleKeys(username, callerAddress(request.socket?.remoteAddress, request.headers['x-forwarded-for']))

        /*
         * Refuse before SAP is ever called. The tenant has its own lockout policy, so an
         * unthrottled app would let anybody lock real staff out of SuccessFactors itself
         * by hammering an employee number.
         */
        throttle.prune()
        const verdict = throttle.check(keys)
        if (!verdict.allowed) {
          console.warn(`  Sign-in throttled for ${keys.join(' ')} — ${verdict.retryAfterSeconds}s remaining`)
          response.setHeader('Retry-After', String(verdict.retryAfterSeconds))
          send(response, 429, { ok: false, outcome: 'rejected', message: verdict.message })
          return
        }

        const result = await verifyCredentials(username, parsed.password ?? '', credentials.apiServer, agent)

        if (result.outcome !== 'ok') {
          // Only a wrong credential counts. A tenant outage must not lock anybody out.
          if (result.outcome === 'rejected') throttle.recordFailure(keys)
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
        return
      }

      case '/api/sap/roster': {
        if (!configured) {
          send(response, 503, {
            ok: false,
            stage: 'assertion',
            message: 'SAP credentials are not configured on the server.',
            detail: 'Set SF_CLIENT_ID, SF_COMPANY_ID, SF_USER_ID and SF_PRIVATE_KEY in .env.local, then restart.',
          })
          return
        }

        try {
          if (!inFlight) {
            inFlight = fetchRoster(credentials, range, agent, (progress) => {
              if (progress.stage !== 'users' || progress.count % 500 === 0) {
                console.log(`  SAP sync: ${progress.message}`)
              }
            }).finally(() => {
              inFlight = null
            })
          }
          send(response, 200, { ok: true, users: await inFlight })
        } catch (error) {
          const stage = error instanceof SapError ? error.stage : 'assertion'
          const message = error instanceof Error ? error.message : String(error)
          const detail = error instanceof SapError ? error.detail : ''
          console.error(`\n  SAP sync failed at the ${stage} step: ${message}\n  ${detail}\n`)
          send(response, 502, { ok: false, stage, message, detail })
        }
        return
      }

      default:
        send(response, 404, { ok: false, message: `No such endpoint: ${route}` })
    }
  })().catch((error: unknown) => {
    console.error(`  Error handling ${route}: ${String(error)}`)
    if (!response.headersSent) send(response, 500, { ok: false, message: 'Internal error.' })
  })
})

server.listen(PORT, HOST, () => {
  console.log(
    `\n  DIC Production Incentive — API` +
      `\n  Listening → http://${HOST}:${PORT}/api` +
      `\n  SAP       → ${credentials.apiServer} ${configured ? '(configured)' : '(NOT configured — sync unavailable)'}` +
      `\n  TLS       → ${insecureTls ? 'VERIFICATION DISABLED by SF_INSECURE_TLS' : `${caBundle.length} trusted CA certificates`}\n`,
  )
})

// PM2 on Windows asks a process to quit by sending a message, not a signal.
process.on('message', (message) => {
  if (message === 'shutdown') server.close(() => process.exit(0))
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
