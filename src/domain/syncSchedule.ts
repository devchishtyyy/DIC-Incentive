/**
 * When the weekly roster sync is due.
 *
 * A browser app has no cron, so this is a catch-up schedule rather than a timer: the app
 * records when it last synced, and on every load (and every few minutes while it is open)
 * asks whether the next slot has passed. Miss Saturday because nobody opened the app, and
 * it syncs on Monday morning instead — which is what you want from a roster refresh.
 *
 * Pure functions, no clock of their own, so the behaviour is testable.
 */

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export interface SyncSchedule {
  enabled: boolean
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  hour: number
  minute: number
}

export const DEFAULT_SCHEDULE: SyncSchedule = {
  enabled: true,
  weekday: 6, // Saturday
  hour: 2,
  minute: 0,
}

/** How long to wait before trying again after a failure, so a broken tenant is not hammered. */
export const RETRY_AFTER_MS = 60 * 60 * 1000

export type SyncStatus = 'never' | 'ok' | 'failed'

export interface SyncState {
  schedule: SyncSchedule
  /** Last successful sync. */
  lastRunAt: string | null
  /** Last attempt, successful or not — drives the retry backoff. */
  lastAttemptAt: string | null
  lastStatus: SyncStatus
  lastMessage: string
  lastCount: number
}

export const INITIAL_SYNC_STATE: SyncState = {
  schedule: { ...DEFAULT_SCHEDULE },
  lastRunAt: null,
  lastAttemptAt: null,
  lastStatus: 'never',
  lastMessage: '',
  lastCount: 0,
}

// ---------------------------------------------------------------------------

function atTime(date: Date, schedule: SyncSchedule): Date {
  const copy = new Date(date)
  copy.setHours(schedule.hour, schedule.minute, 0, 0)
  return copy
}

/**
 * The first scheduled slot strictly after `after`.
 *
 * A run that happens exactly at the slot pushes the next one a full week out, so the sync
 * cannot fire twice for the same Saturday.
 */
export function nextRun(after: Date, schedule: SyncSchedule): Date {
  const candidate = atTime(after, schedule)
  let daysAhead = (schedule.weekday - after.getDay() + 7) % 7

  if (daysAhead === 0 && candidate > after) {
    return candidate
  }
  if (daysAhead === 0) {
    daysAhead = 7
  }

  const target = new Date(after)
  target.setDate(target.getDate() + daysAhead)
  return atTime(target, schedule)
}

/**
 * Should a sync run now?
 *
 * Never synced and switched on → yes, immediately. That is what makes the very first
 * launch pull the roster without anyone pressing anything.
 */
export function isDue(state: SyncState, now: Date): boolean {
  if (!state.schedule.enabled) return false

  // Back off after a failure so a bad token does not retry on every render.
  if (state.lastStatus === 'failed' && state.lastAttemptAt) {
    const since = now.getTime() - new Date(state.lastAttemptAt).getTime()
    if (since < RETRY_AFTER_MS) return false
  }

  if (!state.lastRunAt) return true

  const last = new Date(state.lastRunAt)
  if (Number.isNaN(last.getTime())) return true

  return nextRun(last, state.schedule) <= now
}

/** When the next sync will happen, for display. Null when it is switched off. */
export function dueAt(state: SyncState, now: Date): Date | null {
  if (!state.schedule.enabled) return null
  if (!state.lastRunAt) return now
  const last = new Date(state.lastRunAt)
  if (Number.isNaN(last.getTime())) return now
  return nextRun(last, state.schedule)
}

export function describeSchedule(schedule: SyncSchedule): string {
  if (!schedule.enabled) return 'Off'
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
  return `Every ${WEEKDAYS[schedule.weekday]} at ${time}`
}

/**
 * A roster that suddenly collapses is far more likely to be a bad filter or a half-failed
 * page than 90% of the plant leaving, so an unattended sync refuses to apply it.
 */
export function rosterChangeIsSafe(currentCount: number, incomingCount: number): { safe: boolean; reason: string } {
  if (incomingCount === 0) {
    return { safe: false, reason: 'The sync returned no users at all. The roster has been left as it was.' }
  }
  if (currentCount > 0 && incomingCount < currentCount * 0.5) {
    return {
      safe: false,
      reason: `The sync returned ${incomingCount} users against the ${currentCount} already loaded — less than half. The roster has been left as it was; import it by hand if this drop is real.`,
    }
  }
  return { safe: true, reason: '' }
}
