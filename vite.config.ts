import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import tls from 'node:tls'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sapApiPlugin } from './server/sapPlugin'

/**
 * Trust anchors for the proxy's TLS connection to SuccessFactors.
 *
 * On a corporate network the traffic is usually intercepted and re-signed by an internal
 * root CA. Chrome and Postman accept it because they read the OS certificate store; Node
 * ships its own fixed CA list and does not, which surfaces as:
 *
 *     Error: self-signed certificate in certificate chain
 *
 * So the OS store is read explicitly and merged with Node's own roots. Passing `ca`
 * REPLACES the defaults, hence both halves.
 */
function buildCaBundle(): string[] {
  const certificates: string[] = []
  const getCACertificates = (tls as unknown as { getCACertificates?: (type: string) => string[] }).getCACertificates

  for (const source of ['default', 'system'] as const) {
    try {
      const found = getCACertificates?.(source)
      if (Array.isArray(found)) certificates.push(...found)
    } catch {
      // Older Node without the API, or a store it cannot read — the next source may work.
    }
  }

  // The conventional override, honoured here too since `ca` overrides Node's own handling.
  const extra = process.env.NODE_EXTRA_CA_CERTS
  if (extra && existsSync(extra)) {
    try {
      certificates.push(readFileSync(extra, 'utf8'))
    } catch {
      /* unreadable file is not worth failing startup over */
    }
  }

  // Anything dropped into certs/ — the fallback when the OS store cannot be read.
  const certsDir = path.resolve(process.cwd(), 'certs')
  if (existsSync(certsDir)) {
    for (const file of readdirSync(certsDir)) {
      if (!/\.(pem|crt|cer)$/i.test(file)) continue
      try {
        certificates.push(readFileSync(path.join(certsDir, file), 'utf8'))
      } catch {
        /* skip */
      }
    }
  }

  return certificates
}

export default defineConfig(({ command, mode }) => {
  /*
   * Server-side configuration, read with NO prefix.
   *
   * `VITE_`-prefixed variables are the ones Vite exposes to client code, and the
   * SuccessFactors signing key must never be among them — it can mint an assertion for any
   * user in the tenant. These are plain `SF_*` names, they stay in Node, and the browser
   * talks to /api/sap/* instead. Nothing here can reach a bundle.
   */
  const env = loadEnv(mode, process.cwd(), '')
  const isDev = command === 'serve' && mode !== 'test'

  // Deliberately no VITE_SF_* fallback. A VITE_-prefixed variable is published to the
  // client bundle by Vite's own contract, so reading one here would quietly re-open the
  // hole this whole arrangement closes. The check below shouts if one is still lying about.
  const strayPrefixed = Object.keys(env).filter((key) => key.startsWith('VITE_SF_'))

  const credentials = {
    apiServer: env.SF_API_SERVER || 'https://api44.sapsf.com',
    clientId: env.SF_CLIENT_ID || '',
    companyId: env.SF_COMPANY_ID || '',
    userId: env.SF_USER_ID || '',
    privateKey: env.SF_PRIVATE_KEY || '',
  }

  const range = {
    fromUserId: env.SF_FROM_USER_ID || '40000000',
    toUserId: env.SF_TO_USER_ID || '40009999',
  }

  const caBundle = buildCaBundle()

  // Last resort for a network whose root CA cannot be read at all. Off unless asked for,
  // and it only ever loosens this server's own hop to the SAP tenant.
  const insecureTls = env.SF_INSECURE_TLS === 'true'

  if (strayPrefixed.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `
  WARNING: ${strayPrefixed.join(', ')} is set. Anything named VITE_* is compiled into the browser bundle.` +
        `
  Rename it without the VITE_ prefix — the server reads SF_* and the browser needs none of it.
`,
    )
  }

  if (isDev) {
    const configured = Boolean(credentials.clientId && credentials.companyId && credentials.userId && credentials.privateKey)
    const detail = insecureTls
      ? 'TLS verification DISABLED by SF_INSECURE_TLS — turn this off once the CA is trusted.'
      : `${caBundle.length} trusted CA certificates loaded (Node defaults + OS store).`
    // eslint-disable-next-line no-console
    console.log(
      `
  SAP roster API → ${credentials.apiServer} (server side; no credentials reach the browser)` +
        `
  ${configured ? 'Credentials loaded from .env.local.' : 'NOT CONFIGURED — set SF_* in .env.local.'}` +
        `
  ${detail}
`,
    )
  }

  return {
    // Relative asset paths so dist/ can be served from a subfolder.
    base: './',
    plugins: [react(), tailwindcss(), sapApiPlugin({ credentials, range, caBundle, insecureTls })],

    /*
     * The development server, and only that.
     *
     * On the server the app is two plain Node processes started by PM2 — `backend/server.js`
     * on 6007 and `frontend-server.js` on 6008 — and Vite is not involved at all. Nothing
     * here affects the deployment.
     */
    server: {
      port: Number(env.DIC_PORT) || 5173,
      // Fail rather than quietly move to the next free port: a dev server that is not
      // where you left it wastes more time than a refusal to start does.
      strictPort: true,
      host: '127.0.0.1',
      open: !process.env.DIC_SERVER,
    },

    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
    },
  }
})
