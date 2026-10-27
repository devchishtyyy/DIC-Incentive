/**
 * The sign-in throttle.
 *
 * The property worth protecting is not really "slow down guessing" — it is that a guessing
 * attack must never reach SuccessFactors, because the tenant has its own lockout policy and
 * tripping it would leave real staff unable to sign in to SAP at all. The app would be the
 * instrument of a denial of service against the company's HR system.
 *
 * So: a refusal here must be decided locally, must not depend on SAP being reachable, and
 * must not punish somebody for SAP being down.
 */

import { describe, expect, it } from 'vitest'
import { callerAddress, DEFAULT_THROTTLE, LoginThrottle, throttleKeys } from './loginThrottle'

const NOW = 1_800_000_000_000

describe('counting attempts', () => {
  it('lets the first attempt through', () => {
    const throttle = new LoginThrottle()
    expect(throttle.check(['user:1234'], NOW).allowed).toBe(true)
  })

  it('allows up to the limit, then shuts', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures - 1; i += 1) {
      throttle.recordFailure(['user:1234'], NOW)
      expect(throttle.check(['user:1234'], NOW).allowed, `after ${i + 1}`).toBe(true)
    }
    throttle.recordFailure(['user:1234'], NOW)
    expect(throttle.check(['user:1234'], NOW).allowed).toBe(false)
  })

  it('says how long to wait, without saying whether the account exists', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures; i += 1) throttle.recordFailure(['user:1234'], NOW)

    const verdict = throttle.check(['user:1234'], NOW)
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0)
    expect(verdict.message).toContain('Too many sign-in attempts')
    expect(verdict.message.toLowerCase()).not.toContain('user')
    expect(verdict.message).not.toContain('1234')
  })

  it('opens again once the lockout passes', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures; i += 1) throttle.recordFailure(['user:1234'], NOW)

    expect(throttle.check(['user:1234'], NOW + DEFAULT_THROTTLE.lockoutMs - 1).allowed).toBe(false)
    expect(throttle.check(['user:1234'], NOW + DEFAULT_THROTTLE.lockoutMs + 1).allowed).toBe(true)
  })

  it('rolls the window, so an occasional typo never accumulates into a lockout', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < 10; i += 1) {
      // One failure per window — a person mistyping once a day.
      throttle.recordFailure(['user:1234'], NOW + i * (DEFAULT_THROTTLE.windowMs + 1000))
      expect(throttle.check(['user:1234'], NOW + i * (DEFAULT_THROTTLE.windowMs + 1000)).allowed, `day ${i}`).toBe(true)
    }
  })

  it('forgives everything once a sign-in works', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures - 1; i += 1) throttle.recordFailure(['user:1234'], NOW)
    throttle.recordSuccess(['user:1234'])

    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures - 1; i += 1) {
      throttle.recordFailure(['user:1234'], NOW)
      expect(throttle.check(['user:1234'], NOW).allowed).toBe(true)
    }
  })
})

describe('counting against both the account and the caller', () => {
  it('stops one machine working through a list of employee numbers', () => {
    const throttle = new LoginThrottle()
    // Five different usernames, same caller.
    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures; i += 1) {
      throttle.recordFailure(throttleKeys(`1000000${i}`, '10.0.0.5'), NOW)
    }
    // A sixth, never tried before, is refused on the caller's budget.
    expect(throttle.check(throttleKeys('19999999', '10.0.0.5'), NOW).allowed).toBe(false)
  })

  it('stops many machines grinding one account', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures; i += 1) {
      throttle.recordFailure(throttleKeys('10001234', `10.0.0.${i}`), NOW)
    }
    // A fresh address is refused on the account's budget.
    expect(throttle.check(throttleKeys('10001234', '10.0.0.99'), NOW).allowed).toBe(false)
  })

  it('leaves an unrelated person on an unrelated machine alone', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures; i += 1) {
      throttle.recordFailure(throttleKeys('10001234', '10.0.0.5'), NOW)
    }
    expect(throttle.check(throttleKeys('19999999', '10.0.0.6'), NOW).allowed).toBe(true)
  })

  it('reports the longest remaining wait when several keys are shut', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures; i += 1) throttle.recordFailure(['addr:10.0.0.5'], NOW)
    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures; i += 1) throttle.recordFailure(['user:1234'], NOW + 60_000)

    const verdict = throttle.check(['addr:10.0.0.5', 'user:1234'], NOW + 60_000)
    expect(verdict.retryAfterSeconds).toBe(Math.ceil(DEFAULT_THROTTLE.lockoutMs / 1000))
  })
})

describe('the keys an attempt counts against', () => {
  it('treats a username as one account however it is typed', () => {
    expect(throttleKeys('10001234', '1.2.3.4')).toEqual(throttleKeys('10001234@packagesli', '1.2.3.4'))
    expect(throttleKeys('10001234@PACKAGESLI', '1.2.3.4')).toEqual(throttleKeys(' 10001234 ', '1.2.3.4'))
  })

  it('still counts against the caller when no username was given', () => {
    expect(throttleKeys('', '1.2.3.4')).toEqual(['addr:1.2.3.4'])
  })

  it('still counts against the account when the address is unknown', () => {
    expect(throttleKeys('10001234', undefined)).toEqual(['user:10001234'])
  })

  it('counts against nothing when there is nothing to count', () => {
    expect(throttleKeys('', undefined)).toEqual([])
    // An empty key list can never be refused, which is correct: there is nothing to
    // attribute the attempt to, and SAP will reject it on its own merits.
    expect(new LoginThrottle().check([], NOW).allowed).toBe(true)
  })
})

describe('not growing without bound', () => {
  it('drops entries nobody has touched since the window closed', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < 500; i += 1) throttle.recordFailure([`user:${i}`], NOW)
    expect(throttle.size()).toBe(500)

    throttle.prune(NOW + DEFAULT_THROTTLE.windowMs + 1)
    expect(throttle.size()).toBe(0)
  })

  it('NEVER PRUNES SOMEBODY OUT OF A LOCKOUT THEY ARE STILL SERVING', () => {
    // The default window and lockout are both fifteen minutes, so they expire together and
    // the question never arises. Make the lockout outlast the window and it does: pruning
    // on the window alone would hand an attacker a fresh five guesses early.
    const throttle = new LoginThrottle({ maxFailures: 3, windowMs: 60_000, lockoutMs: 10 * 60_000 })
    for (let i = 0; i < 3; i += 1) throttle.recordFailure(['user:1234'], NOW)

    const afterWindow = NOW + 60_000 + 1
    throttle.prune(afterWindow)
    expect(throttle.size()).toBe(1)
    expect(throttle.check(['user:1234'], afterWindow).allowed).toBe(false)

    // And is released once the lockout itself is done.
    const afterLockout = NOW + 10 * 60_000 + 1
    expect(throttle.check(['user:1234'], afterLockout).allowed).toBe(true)
    throttle.prune(afterLockout)
    expect(throttle.size()).toBe(0)
  })
})

describe('the settings are the ones intended', () => {
  it('allows five tries in fifteen minutes, then waits fifteen', () => {
    expect(DEFAULT_THROTTLE.maxFailures).toBe(5)
    expect(DEFAULT_THROTTLE.windowMs).toBe(15 * 60 * 1000)
    expect(DEFAULT_THROTTLE.lockoutMs).toBe(15 * 60 * 1000)
  })
})

describe('who the throttle counts behind IIS', () => {
  it('counts the real client, not the proxy', () => {
    // Every connection from IIS looks like 127.0.0.1; without this the whole company
    // would share one budget and five bad passwords would lock out the site.
    expect(callerAddress('127.0.0.1', '10.20.30.40')).toBe('10.20.30.40')
    expect(callerAddress('::1', '10.20.30.40')).toBe('10.20.30.40')
    expect(callerAddress('::ffff:127.0.0.1', '10.20.30.40')).toBe('10.20.30.40')
  })

  it('takes the original client from a chain of proxies', () => {
    expect(callerAddress('127.0.0.1', '10.20.30.40, 172.16.0.1, 192.168.1.1')).toBe('10.20.30.40')
  })

  it('IGNORES THE HEADER FROM A CALLER THAT IS NOT THE PROXY', () => {
    // Otherwise anybody reaching the port directly could invent a fresh address on every
    // attempt and never be throttled at all.
    expect(callerAddress('203.0.113.9', '10.20.30.40')).toBe('203.0.113.9')
  })

  it('falls back to the socket when there is no header', () => {
    expect(callerAddress('127.0.0.1', undefined)).toBe('127.0.0.1')
    expect(callerAddress('127.0.0.1', '')).toBe('127.0.0.1')
    expect(callerAddress('127.0.0.1', '   ')).toBe('127.0.0.1')
  })

  it('copes with a repeated header, which arrives as an array', () => {
    expect(callerAddress('127.0.0.1', ['10.20.30.40', '10.0.0.1'])).toBe('10.20.30.40')
  })

  it('keeps two people behind the same proxy in separate budgets', () => {
    const throttle = new LoginThrottle()
    const a = throttleKeys('10001111', callerAddress('127.0.0.1', '10.20.30.40'))
    const b = throttleKeys('10002222', callerAddress('127.0.0.1', '10.20.30.99'))

    for (let i = 0; i < DEFAULT_THROTTLE.maxFailures; i += 1) throttle.recordFailure(a, NOW)

    expect(throttle.check(a, NOW).allowed).toBe(false)
    expect(throttle.check(b, NOW).allowed).toBe(true)
  })
})
