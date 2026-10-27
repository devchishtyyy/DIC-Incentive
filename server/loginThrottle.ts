/**
 * Slowing down password guessing.
 *
 * Without this, `/api/auth/login` will forward an unlimited number of guesses to
 * SuccessFactors. Two things go wrong, and the second is worse than the first:
 *
 *   1. Somebody can brute-force a weak password at network speed.
 *   2. Somebody can get **real staff locked out of SAP itself** by hammering their
 *      employee number until the tenant's own lockout policy trips. The app would be the
 *      instrument of a denial of service against the company's HR system.
 *
 * So a refusal here is not only a guard on the app — it stops the request ever reaching
 * SAP, which is what protects the account behind it.
 *
 * Counted per username *and* per caller. Per-username alone lets one machine work through
 * a list of employee numbers; per-caller alone lets a botnet grind one account.
 *
 * In memory, so it resets when the dev server restarts. That is honest for a single-server
 * prototype and is called out in the README — a real deployment wants this in a store the
 * whole fleet shares.
 */

export interface ThrottleConfig {
  /** Failures before the gate shuts. */
  maxFailures: number
  /** How long failures are remembered, in ms. */
  windowMs: number
  /** How long the gate stays shut once tripped, in ms. */
  lockoutMs: number
}

export const DEFAULT_THROTTLE: ThrottleConfig = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}

interface Attempt {
  failures: number
  /** When the count started, so the window can roll. */
  firstAt: number
  lockedUntil: number
}

export interface ThrottleVerdict {
  allowed: boolean
  /** Seconds until another attempt is allowed. Zero when allowed. */
  retryAfterSeconds: number
  message: string
}

const ALLOWED: ThrottleVerdict = { allowed: true, retryAfterSeconds: 0, message: '' }

export class LoginThrottle {
  private readonly attempts = new Map<string, Attempt>()

  constructor(private readonly config: ThrottleConfig = DEFAULT_THROTTLE) {}

  /**
   * Whether this attempt may proceed. Checks every key — username and caller — and the
   * strictest answer wins.
   */
  check(keys: readonly string[], now = Date.now()): ThrottleVerdict {
    let worst: ThrottleVerdict = ALLOWED

    for (const key of keys) {
      const attempt = this.attempts.get(key)
      if (!attempt) continue

      if (attempt.lockedUntil > now) {
        const seconds = Math.ceil((attempt.lockedUntil - now) / 1000)
        if (seconds > worst.retryAfterSeconds) {
          worst = {
            allowed: false,
            retryAfterSeconds: seconds,
            // Deliberately says nothing about whether the username exists.
            message: `Too many sign-in attempts. Try again in ${Math.ceil(seconds / 60)} minute${seconds > 60 ? 's' : ''}.`,
          }
        }
      }
    }

    return worst
  }

  /** Records a failed attempt against every key, and shuts the gate if one goes over. */
  recordFailure(keys: readonly string[], now = Date.now()): void {
    for (const key of keys) {
      const existing = this.attempts.get(key)

      // A window that has rolled over starts the count again.
      const attempt: Attempt =
        existing && now - existing.firstAt < this.config.windowMs
          ? existing
          : { failures: 0, firstAt: now, lockedUntil: 0 }

      attempt.failures += 1
      if (attempt.failures >= this.config.maxFailures) {
        attempt.lockedUntil = now + this.config.lockoutMs
      }
      this.attempts.set(key, attempt)
    }
  }

  /** A sign-in that worked clears the slate, so one typo does not haunt somebody all day. */
  recordSuccess(keys: readonly string[]): void {
    for (const key of keys) this.attempts.delete(key)
  }

  /** Drops entries nobody has touched in a while, so the map cannot grow without bound. */
  prune(now = Date.now()): void {
    for (const [key, attempt] of this.attempts) {
      const stale = now - attempt.firstAt > this.config.windowMs && attempt.lockedUntil < now
      if (stale) this.attempts.delete(key)
    }
  }

  /** For tests and diagnostics. */
  size(): number {
    return this.attempts.size
  }
}

/**
 * The keys one attempt counts against.
 *
 * The username is lowercased and stripped of its tenant suffix so `10001234`,
 * `10001234@packagesli` and `10001234@PACKAGESLI` are one account and not three budgets.
 */
export function throttleKeys(username: string, remoteAddress: string | undefined): string[] {
  const bare = username.trim().toLowerCase().split('@')[0]
  const keys: string[] = []
  if (bare) keys.push(`user:${bare}`)
  if (remoteAddress) keys.push(`addr:${remoteAddress}`)
  return keys
}
