/**
 * Checking a password against SuccessFactors.
 *
 * The behaviour below was verified against the real tenant on 27 Oct 2026 with the account
 * DIC supplied, and these tests pin what was observed:
 *
 *   correct password + @packagesli  → 200
 *   wrong password                  → 401
 *   WITHOUT the @packagesli suffix  → 401   ← the reason the app adds it
 *   unknown user / no credentials   → 401
 *
 * The thing most worth pinning is the last line of `outcomeFor`: anything that is not a
 * clear 200-with-OData is *not* a sign-in. A captive portal or a corporate proxy answering
 * 200 with a login page would otherwise let everybody in.
 */

import { describe, expect, it } from 'vitest'
import { authProbeUrl, COMPANY_SUFFIX, looksLikeOData, outcomeFor, qualifyUsername } from './sapAuth'

describe('qualifying the username', () => {
  it('adds the tenant suffix, which is what SAP needs', () => {
    expect(qualifyUsername('10001234')).toBe('10001234@packagesli')
  })

  it('leaves one that already has it alone, so typing it out is not punished', () => {
    expect(qualifyUsername('10001234@packagesli')).toBe('10001234@packagesli')
  })

  it('does not double up on a different suffix somebody pasted', () => {
    expect(qualifyUsername('someone@elsewhere')).toBe('someone@elsewhere')
  })

  it('trims what a barcode scanner or a careless paste leaves behind', () => {
    expect(qualifyUsername('  10001234\n')).toBe('10001234@packagesli')
  })

  it('gives nothing back for nothing, rather than a bare suffix', () => {
    expect(qualifyUsername('')).toBe('')
    expect(qualifyUsername('   ')).toBe('')
  })

  it('uses the company the tenant is actually on', () => {
    expect(COMPANY_SUFFIX).toBe('packagesli')
  })
})

describe('the probe URL', () => {
  it('reads one row, because the status code is the whole answer', () => {
    const url = new URL(authProbeUrl('https://api44.sapsf.com'))
    expect(url.pathname).toBe('/odata/v2/Background_Community')
    expect(url.searchParams.get('$top')).toBe('1')
    expect(url.searchParams.get('$format')).toBe('json')
  })

  it('follows a different API server', () => {
    expect(authProbeUrl('https://api10.sapsf.com')).toContain('api10.sapsf.com')
  })

  it('tolerates a trailing slash and falls back sensibly', () => {
    expect(authProbeUrl('https://api4.sapsf.com/')).toContain('https://api4.sapsf.com/odata')
    expect(authProbeUrl('')).toContain('api44.sapsf.com')
  })
})

describe('reading the answer', () => {
  const ODATA = '{"d":{"results":[]}}'

  it('accepts the real reply — 200 with an empty OData envelope', () => {
    // This is verbatim what the tenant returned for the supplied account: 30 bytes, no rows.
    expect(outcomeFor(200, ODATA).outcome).toBe('ok')
  })

  it('accepts a 200 that happens to carry rows', () => {
    expect(outcomeFor(200, '{"d":{"results":[{"userId":"x"}]}}').outcome).toBe('ok')
  })

  it('REFUSES a 200 that is not SAP data', () => {
    // A captive portal or a proxy sign-in page. Letting this through would be a way in
    // for anybody who could get a network to answer cheerfully.
    expect(outcomeFor(200, '<html><body>Please sign in</body></html>').outcome).toBe('unavailable')
    expect(outcomeFor(200, '{"status":"ok"}').outcome).toBe('unavailable')
    expect(outcomeFor(200, '').outcome).toBe('unavailable')
  })

  it('treats 401 as a plain wrong-credentials answer', () => {
    const result = outcomeFor(401, '')
    expect(result.outcome).toBe('rejected')
    expect(result.message).toContain('not right')
  })

  it('does not say WHICH of the two was wrong', () => {
    // Confirming a username exists is worth something to somebody guessing passwords.
    const message = outcomeFor(401, '').message.toLowerCase()
    expect(message).toContain('username or password')
  })

  it('separates 403 from a sign-in failure, and does not wave it through', () => {
    const result = outcomeFor(403, '')
    expect(result.outcome).toBe('forbidden')
    expect(result.outcome).not.toBe('ok')
    expect(result.message).toContain('permission')
  })

  it('calls a server fault a server fault, so nobody retypes their password at it', () => {
    expect(outcomeFor(500, '').outcome).toBe('unavailable')
    expect(outcomeFor(503, '').message).toContain('not answering')
  })

  it('refuses anything else rather than guessing', () => {
    for (const status of [0, 302, 404, 418]) {
      expect(outcomeFor(status, ODATA).outcome, String(status)).toBe('unavailable')
    }
  })
})

describe('spotting the OData envelope', () => {
  it('wants the d wrapper', () => {
    expect(looksLikeOData('{"d":{"results":[]}}')).toBe(true)
    expect(looksLikeOData('{"d":null}')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(looksLikeOData('{}')).toBe(false)
    expect(looksLikeOData('[]')).toBe(false)
    expect(looksLikeOData('null')).toBe(false)
    expect(looksLikeOData('not json')).toBe(false)
    expect(looksLikeOData('<!doctype html>')).toBe(false)
  })
})
