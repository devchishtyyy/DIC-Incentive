/**
 * The SuccessFactors flow, server side.
 *
 * What these pin, in order of how much damage each would do unnoticed:
 *
 *   1. Nothing in `src/` imports this module — the signing key must not be reachable from
 *      anything Vite bundles for a browser.
 *   2. `token_url` is the tenant's own URL. SAP signs it into the assertion as `Recipient`
 *      and /oauth/token rejects an assertion that does not name it, so getting this wrong
 *      produces a flat "Invalid SAML assertion" with no hint why.
 *   3. `__next` paging. Stopping early loses everyone past the first 1000 and the roster
 *      just looks smaller than it is.
 *   4. Bodies survive whole. An assertion runs to kilobytes; truncating one anywhere makes
 *      the token exchange fail for reasons nobody can see.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildUserQuery,
  clearTokenCache,
  credentialsAreComplete,
  fetchRoster,
  fetchUsers,
  forDisplay,
  requestAssertion,
  requestToken,
  SapError,
  tokenUrlFor,
  type SapCredentials,
} from './sapRoster'

const CREDENTIALS: SapCredentials = {
  apiServer: 'https://api44.sapsf.com',
  clientId: 'CLIENT',
  companyId: 'COMPANY',
  userId: 'ECAdmin',
  privateKey: 'KEY-MATERIAL',
}

const RANGE = { fromUserId: '40000000', toUserId: '40009999' }
const agent = new https.Agent()

/**
 * Stands in for `node:https`, serving a canned sequence of responses and recording what
 * was asked for. The module calls `https.request`, so that is what gets replaced.
 */
function stubHttps(pages: Array<{ status?: number; body: unknown }>) {
  const urls: string[] = []
  const bodies: string[] = []
  let index = 0

  vi.spyOn(https, 'request').mockImplementation(((options: Record<string, unknown>, callback: (res: unknown) => void) => {
    urls.push(`https://${String(options.hostname)}${String(options.path)}`)

    const page = pages[Math.min(index, pages.length - 1)]
    index += 1
    const text = typeof page.body === 'string' ? page.body : JSON.stringify(page.body)

    const listeners: Record<string, Array<(chunk?: unknown) => void>> = {}
    const response = {
      statusCode: page.status ?? 200,
      on(event: string, handler: (chunk?: unknown) => void) {
        ;(listeners[event] ??= []).push(handler)
        return response
      },
    }

    queueMicrotask(() => {
      callback(response)
      for (const handler of listeners.data ?? []) handler(Buffer.from(text, 'utf8'))
      for (const handler of listeners.end ?? []) handler()
    })

    return {
      on() {
        return this
      },
      write(chunk: string) {
        bodies.push(chunk)
      },
      end() {},
    }
  }) as unknown as typeof https.request)

  return { urls, bodies }
}

beforeEach(() => clearTokenCache())
afterEach(() => vi.restoreAllMocks())

// ---------------------------------------------------------------------------

describe('the signing key cannot reach the browser', () => {
  const srcDir = path.resolve(__dirname, '..', 'src')

  function walk(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) out.push(...walk(full))
      else if (/\.(ts|tsx)$/.test(name)) out.push(full)
    }
    return out
  }

  const sources = walk(srcDir).map((file) => ({ file, text: readFileSync(file, 'utf8') }))

  it('is never imported by anything under src/', () => {
    const offenders = sources.filter(({ text }) => /from ['"].*server\/sapRoster['"]/.test(text) || /from ['"].*server\/sapPlugin['"]/.test(text))
    expect(offenders.map((o) => path.basename(o.file))).toEqual([])
  })

  it('never reads or sends a signing key', () => {
    // Naming the variable in help text is fine; touching its value is not. These are the
    // shapes that would mean the key is actually flowing through client code.
    const offenders = sources.filter(
      ({ file, text }) =>
        !file.endsWith('.test.ts') &&
        !file.endsWith('.test.tsx') &&
        /private_key\s*:|privateKey|__SAP_CREDENTIALS__|client_id\s*:/.test(text),
    )
    expect(offenders.map((o) => path.basename(o.file))).toEqual([])
  })

  it('does not read a VITE_-prefixed SAP variable anywhere, since those are inlined into the bundle', () => {
    const offenders = sources.filter(({ text }) => /import\.meta\.env\.VITE_SF/.test(text))
    expect(offenders.map((o) => path.basename(o.file))).toEqual([])
  })
})

describe('the assertion names the tenant, not this server', () => {
  it('builds the tenant token URL', () => {
    expect(tokenUrlFor({ apiServer: 'https://api44.sapsf.com' })).toBe('https://api44.sapsf.com/oauth/token')
  })

  it('follows a different API server', () => {
    expect(tokenUrlFor({ apiServer: 'https://api10.sapsf.com' })).toBe('https://api10.sapsf.com/oauth/token')
  })

  it('tolerates a trailing slash', () => {
    expect(tokenUrlFor({ apiServer: 'https://api4.sapsf.com/' })).toBe('https://api4.sapsf.com/oauth/token')
  })

  it('falls back to the default tenant when none is configured', () => {
    expect(tokenUrlFor({ apiServer: '' })).toBe('https://api44.sapsf.com/oauth/token')
  })

  it('posts that URL to /oauth/idp, and never a localhost one', async () => {
    const { urls, bodies } = stubHttps([{ body: 'ASSERTION' }])
    await requestAssertion(CREDENTIALS, agent)

    expect(urls[0]).toBe('https://api44.sapsf.com/oauth/idp')
    const sent = new URLSearchParams(bodies[0])
    expect(sent.get('token_url')).toBe('https://api44.sapsf.com/oauth/token')
    expect(sent.get('token_url')).not.toContain('localhost')
  })

  it('passes the client id, user and key through unchanged', async () => {
    const { bodies } = stubHttps([{ body: 'ASSERTION' }])
    await requestAssertion(CREDENTIALS, agent)

    const sent = new URLSearchParams(bodies[0])
    expect(sent.get('client_id')).toBe('CLIENT')
    expect(sent.get('user_id')).toBe('ECAdmin')
    expect(sent.get('private_key')).toBe('KEY-MATERIAL')
  })
})

describe('the token exchange', () => {
  it('returns the access token', async () => {
    stubHttps([{ body: { access_token: 'TOKEN', expires_in: 86400 } }])
    const result = await requestToken(CREDENTIALS, 'ASSERTION', agent, 0)
    expect(result.token).toBe('TOKEN')
  })

  it('expires a minute early rather than mid-page', async () => {
    stubHttps([{ body: { access_token: 'TOKEN', expires_in: 600 } }])
    const result = await requestToken(CREDENTIALS, 'ASSERTION', agent, 0)
    expect(result.expiresAt).toBe((600 - 60) * 1000)
  })

  it('assumes a day when SAP does not say', async () => {
    stubHttps([{ body: { access_token: 'TOKEN' } }])
    const result = await requestToken(CREDENTIALS, 'ASSERTION', agent, 0)
    expect(result.expiresAt).toBe((24 * 60 * 60 - 60) * 1000)
  })

  it('surfaces the reason SAP gave', async () => {
    stubHttps([{ status: 400, body: '{"errorMessage":"Invalid SAML assertion"}' }])
    await expect(requestToken(CREDENTIALS, 'A', agent)).rejects.toThrow(/HTTP 400/)
  })

  it('explains itself when there is no token in the answer', async () => {
    stubHttps([{ body: { error: 'invalid_client' } }])
    await expect(requestToken(CREDENTIALS, 'A', agent)).rejects.toThrow(/invalid_client/)
  })

  it('does not pretend a non-JSON body is a token', async () => {
    stubHttps([{ body: '<html>gateway</html>' }])
    await expect(requestToken(CREDENTIALS, 'A', agent)).rejects.toThrow(/not JSON/)
  })
})

describe('the OData query', () => {
  const url = buildUserQuery(CREDENTIALS, RANGE)

  it('goes straight to the tenant — there is no proxy any more', () => {
    expect(url.startsWith('https://api44.sapsf.com/odata/v2/User?')).toBe(true)
  })

  it('asks for active users in the range, URL-encoded', () => {
    const filter = new URL(url).searchParams.get('$filter')
    expect(filter).toBe("userId ge '40000000' and userId le '40009999' and status eq 't'")
  })

  it('asks for JSON', () => {
    expect(url).toContain('%24format=json')
  })
})

describe('paging through the roster', () => {
  it('follows __next until the pages run out', async () => {
    const { urls } = stubHttps([
      { body: { d: { results: [{ userId: '1' }], __next: 'https://api44.sapsf.com/odata/v2/User?$skiptoken=1000' } } },
      { body: { d: { results: [{ userId: '2' }] } } },
    ])

    const users = await fetchUsers(CREDENTIALS, 'TOKEN', RANGE, agent)
    expect(users).toHaveLength(2)
    expect(urls[1]).toContain('skiptoken=1000')
  })

  it('stops after one page when there is no __next', async () => {
    stubHttps([{ body: { d: { results: [{ userId: '1' }] } } }])
    expect(await fetchUsers(CREDENTIALS, 'TOKEN', RANGE, agent)).toHaveLength(1)
  })

  it('reports progress as the pages come in', async () => {
    stubHttps([
      { body: { d: { results: [{ userId: '1' }], __next: 'https://api44.sapsf.com/odata/v2/User?$skiptoken=1' } } },
      { body: { d: { results: [{ userId: '2' }] } } },
    ])

    const seen: number[] = []
    await fetchUsers(CREDENTIALS, 'TOKEN', RANGE, agent, (progress) => seen.push(progress.count))
    expect(seen).toEqual([1, 2])
  })

  it('copes with an empty result rather than looping', async () => {
    stubHttps([{ body: { d: { results: [] } } }])
    expect(await fetchUsers(CREDENTIALS, 'TOKEN', RANGE, agent)).toHaveLength(0)
  })

  it('names the stage when the tenant refuses', async () => {
    stubHttps([{ status: 403, body: 'Forbidden' }])
    await expect(fetchUsers(CREDENTIALS, 'TOKEN', RANGE, agent)).rejects.toMatchObject({ stage: 'users' })
  })
})

describe('the whole flow', () => {
  it('runs assertion, token and users in that order', async () => {
    const { urls } = stubHttps([
      { body: 'ASSERTION' },
      { body: { access_token: 'TOKEN', expires_in: 86400 } },
      { body: { d: { results: [{ userId: '40001295' }] } } },
    ])

    const users = await fetchRoster(CREDENTIALS, RANGE, agent)
    expect(users).toHaveLength(1)
    expect(urls.map((url) => new URL(url).pathname)).toEqual(['/oauth/idp', '/oauth/token', '/odata/v2/User'])
  })

  it('reuses a cached token on the next sync instead of re-authenticating', async () => {
    stubHttps([
      { body: 'ASSERTION' },
      { body: { access_token: 'TOKEN', expires_in: 86400 } },
      { body: { d: { results: [] } } },
    ])
    await fetchRoster(CREDENTIALS, RANGE, agent)
    vi.restoreAllMocks()

    const { urls } = stubHttps([{ body: { d: { results: [] } } }])
    await fetchRoster(CREDENTIALS, RANGE, agent)
    expect(urls.map((url) => new URL(url).pathname)).toEqual(['/odata/v2/User'])
  })
})

describe('large bodies survive intact', () => {
  const huge = 'A'.repeat(6500)

  it('returns a multi-kilobyte assertion whole', async () => {
    stubHttps([{ body: huge }])
    expect(await requestAssertion(CREDENTIALS, agent)).toHaveLength(6500)
  })

  it('sends the whole assertion on to the token exchange', async () => {
    const { bodies } = stubHttps([{ body: { access_token: 'T' } }])
    await requestToken(CREDENTIALS, huge, agent)
    expect(new URLSearchParams(bodies[0]).get('assertion')).toHaveLength(6500)
  })

  it('still shortens an error body so a notice can hold it', () => {
    expect(forDisplay(huge).length).toBeLessThanOrEqual(601)
  })
})

describe('knowing whether a sync is possible', () => {
  it('needs all four values', () => {
    expect(credentialsAreComplete(CREDENTIALS)).toBe(true)
    expect(credentialsAreComplete({ ...CREDENTIALS, privateKey: '' })).toBe(false)
    expect(credentialsAreComplete({})).toBe(false)
  })

  it('reports a transport failure in terms of the fix', () => {
    stubHttps([])
    vi.spyOn(https, 'request').mockImplementation((() => {
      throw new Error('self-signed certificate in certificate chain')
    }) as unknown as typeof https.request)

    return expect(requestAssertion(CREDENTIALS, agent)).rejects.toMatchObject({
      detail: expect.stringContaining('certificate store'),
    }) as unknown as Promise<void>
  })
})

describe('SapError', () => {
  it('carries the stage so a screen can say where it broke', () => {
    const error = new SapError('nope', 'token', 'detail')
    expect(error.stage).toBe('token')
    expect(error.detail).toBe('detail')
  })
})
