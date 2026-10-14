import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCHEDULE,
  describeSchedule,
  dueAt,
  INITIAL_SYNC_STATE,
  isDue,
  nextRun,
  RETRY_AFTER_MS,
  rosterChangeIsSafe,
  type SyncState,
} from './syncSchedule'

const SAT_02_00 = { ...DEFAULT_SCHEDULE }
const at = (iso: string) => new Date(iso)

/**
 * The schedule works in the plant's local time, so assertions compare local dates.
 * `toISOString` would shift a 02:00 Saturday in PKT back to Friday in UTC.
 */
const localDate = (date: Date | null) =>
  date === null
    ? null
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const state = (partial: Partial<SyncState> = {}): SyncState => ({ ...INITIAL_SYNC_STATE, ...partial })

describe('finding the next Saturday slot', () => {
  it('moves forward to Saturday from midweek', () => {
    // Wednesday 7 Oct 2026
    expect(localDate(nextRun(at('2026-10-07T09:00:00'), SAT_02_00))).toBe('2026-10-10')
  })

  it('uses the configured time of day', () => {
    const next = nextRun(at('2026-10-07T09:00:00'), SAT_02_00)
    expect(next.getHours()).toBe(2)
    expect(next.getMinutes()).toBe(0)
  })

  it('stays on today when the slot has not passed yet', () => {
    // Saturday 10 Oct, 00:30 — the 02:00 slot is still ahead.
    const next = nextRun(at('2026-10-10T00:30:00'), SAT_02_00)
    expect(localDate(next)).toBe('2026-10-10')
  })

  it('jumps a full week when the slot has already passed today', () => {
    // Saturday 10 Oct, 09:00 — past 02:00, so the next one is the 17th.
    const next = nextRun(at('2026-10-10T09:00:00'), SAT_02_00)
    expect(localDate(next)).toBe('2026-10-17')
    expect(next.getDay()).toBe(6)
  })

  it('cannot fire twice for the same Saturday', () => {
    // A run exactly on the slot pushes the next one a week out.
    const next = nextRun(at('2026-10-10T02:00:00'), SAT_02_00)
    expect(localDate(next)).toBe('2026-10-17')
  })

  it('honours a different day and time', () => {
    const monday9 = { enabled: true, weekday: 1, hour: 9, minute: 30 }
    const next = nextRun(at('2026-10-07T09:00:00'), monday9)
    expect(localDate(next)).toBe('2026-10-12')
    expect(next.getDay()).toBe(1)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(30)
  })
})

describe('deciding whether to sync', () => {
  it('syncs straight away when it has never run — this is the first launch', () => {
    expect(isDue(state(), at('2026-10-07T09:00:00'))).toBe(true)
  })

  it('does nothing when the schedule is switched off', () => {
    expect(isDue(state({ schedule: { ...SAT_02_00, enabled: false } }), at('2026-10-07T09:00:00'))).toBe(false)
  })

  it('waits while the week is still running', () => {
    const last = '2026-10-10T02:00:00'
    expect(isDue(state({ lastRunAt: last, lastStatus: 'ok' }), at('2026-10-13T09:00:00'))).toBe(false)
  })

  it('fires once the next Saturday arrives', () => {
    const last = '2026-10-10T02:00:00'
    expect(isDue(state({ lastRunAt: last, lastStatus: 'ok' }), at('2026-10-17T02:00:00'))).toBe(true)
  })

  it('catches up when nobody opened the app on Saturday', () => {
    // Last sync two weeks ago; it is now Monday. The missed slot still counts.
    const last = '2026-10-03T02:00:00'
    expect(isDue(state({ lastRunAt: last, lastStatus: 'ok' }), at('2026-10-19T08:00:00'))).toBe(true)
  })

  it('recovers from a stored timestamp that makes no sense', () => {
    expect(isDue(state({ lastRunAt: 'not-a-date' }), at('2026-10-07T09:00:00'))).toBe(true)
  })
})

describe('backing off after a failure', () => {
  const failed = state({ lastStatus: 'failed', lastAttemptAt: '2026-10-07T09:00:00', lastRunAt: null })

  it('does not retry immediately — a bad token would hammer the tenant', () => {
    expect(isDue(failed, at('2026-10-07T09:10:00'))).toBe(false)
  })

  it('tries again after the backoff', () => {
    const later = new Date(new Date('2026-10-07T09:00:00').getTime() + RETRY_AFTER_MS + 1000)
    expect(isDue(failed, later)).toBe(true)
  })

  it('does not back off after a success', () => {
    const ok = state({ lastStatus: 'ok', lastAttemptAt: '2026-10-10T02:00:00', lastRunAt: '2026-10-10T02:00:00' })
    expect(isDue(ok, at('2026-10-17T03:00:00'))).toBe(true)
  })
})

describe('what the screen shows', () => {
  it('says the roster is due now before the first sync', () => {
    const now = at('2026-10-07T09:00:00')
    expect(dueAt(state(), now)).toEqual(now)
  })

  it('names the next Saturday once it has run', () => {
    const next = dueAt(state({ lastRunAt: '2026-10-10T02:00:00', lastStatus: 'ok' }), at('2026-10-13T09:00:00'))
    expect(localDate(next)).toBe('2026-10-17')
  })

  it('shows nothing due when it is switched off', () => {
    expect(dueAt(state({ schedule: { ...SAT_02_00, enabled: false } }), at('2026-10-07T09:00:00'))).toBeNull()
  })

  it('describes the schedule in words', () => {
    expect(describeSchedule(SAT_02_00)).toBe('Every Saturday at 02:00')
    expect(describeSchedule({ enabled: true, weekday: 1, hour: 9, minute: 30 })).toBe('Every Monday at 09:30')
    expect(describeSchedule({ ...SAT_02_00, enabled: false })).toBe('Off')
  })
})

describe('refusing a roster that collapsed', () => {
  it('rejects an empty result rather than wiping everyone', () => {
    expect(rosterChangeIsSafe(300, 0).safe).toBe(false)
  })

  it('rejects a result that lost more than half the plant', () => {
    const check = rosterChangeIsSafe(300, 100)
    expect(check.safe).toBe(false)
    expect(check.reason).toContain('less than half')
  })

  it('accepts ordinary movement', () => {
    expect(rosterChangeIsSafe(300, 298).safe).toBe(true)
    expect(rosterChangeIsSafe(300, 340).safe).toBe(true)
  })

  it('accepts the very first import, when there is nothing to compare against', () => {
    expect(rosterChangeIsSafe(0, 12).safe).toBe(true)
  })
})
