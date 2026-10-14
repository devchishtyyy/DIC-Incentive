/**
 * The incentive period: the 16th of one month to the 15th of the next.
 *
 * It is not a calendar month, and that is the whole point of this module. The period is
 * where "÷ 26" comes from — 16th to 15th spans 30 or 31 days, Sundays are off, and what
 * is left is 26 working days. Attendance divides by that 26, so a period that quietly
 * became a calendar month would pay everybody the wrong amount.
 *
 * The start day is a setting (default 16) rather than a constant, because DIC has used
 * the 17th at least once. Generating periods from it means changing the setting changes
 * every period consistently, instead of leaving a hand-maintained list to drift.
 *
 * Everything here is pure: given a year, a month and a start day, the answer never
 * depends on today's date or on app state.
 */

import { addDays, toIso, toUtc } from './dates'
import type { IsoDate, MonthPeriod, PeriodStatus } from './types'

/**
 * A start day above 28 cannot be honoured in February, so it is not offered.
 * Clamping here rather than at the input means no caller can produce a period that
 * silently skips a day or lands on the 1st of the wrong month.
 */
export const MIN_START_DAY = 1
export const MAX_START_DAY = 28

export function clampStartDay(day: number): number {
  if (!Number.isFinite(day)) return 16
  return Math.min(MAX_START_DAY, Math.max(MIN_START_DAY, Math.trunc(day)))
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-09` → `{ year: 2026, month: 9 }`. Month is 1-based, as it reads. */
export function parsePeriodId(periodId: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(periodId)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

export function makePeriodId(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * The period identified by its *start* month: `2026-09` with a start day of 16 runs
 * 16 Sep to 15 Oct 2026. The end is one day before the next period begins, so the two
 * can never overlap or leave a gap however the start day moves.
 */
export function periodBounds(year: number, month: number, startDay: number): { startDate: IsoDate; endDate: IsoDate } {
  const day = clampStartDay(startDay)
  const startDate = toIso(new Date(Date.UTC(year, month - 1, day)))
  const nextStart = toIso(new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, day)))
  return { startDate, endDate: addDays(nextStart, -1) }
}

/** `16 Sep – 15 Oct 2026`, or `16 Dec 2026 – 15 Jan 2027` when it crosses a new year. */
export function periodLabel(startDate: IsoDate, endDate: IsoDate): string {
  const from = toUtc(startDate)
  const to = toUtc(endDate)
  const fromPart = `${from.getUTCDate()} ${MONTH_NAMES[from.getUTCMonth()]}`
  const toPart = `${to.getUTCDate()} ${MONTH_NAMES[to.getUTCMonth()]} ${to.getUTCFullYear()}`
  return from.getUTCFullYear() === to.getUTCFullYear()
    ? `${fromPart} – ${toPart}`
    : `${fromPart} ${from.getUTCFullYear()} – ${toPart}`
}

export function buildPeriod(periodId: string, startDay: number, status: PeriodStatus = 'Open'): MonthPeriod | null {
  const parsed = parsePeriodId(periodId)
  if (!parsed) return null
  const { startDate, endDate } = periodBounds(parsed.year, parsed.month, startDay)
  return { periodId, label: periodLabel(startDate, endDate), startDate, endDate, status }
}

/**
 * Which period a date falls in.
 *
 * On or after the start day it belongs to the period beginning this month; before it, to
 * the one that began last month. 15 Oct 2026 is therefore in `2026-09`, not `2026-10` —
 * the case that catches people out, and the reason this is a function rather than
 * `date.slice(0, 7)` written at each call site.
 */
export function periodIdFor(date: IsoDate, startDay: number): string {
  const day = clampStartDay(startDay)
  const at = toUtc(date)
  const year = at.getUTCFullYear()
  const month = at.getUTCMonth() + 1

  if (at.getUTCDate() >= day) return makePeriodId(year, month)
  return month === 1 ? makePeriodId(year - 1, 12) : makePeriodId(year, month - 1)
}

/** Steps a period id by whole periods: `2026-12` + 1 → `2027-01`. */
export function shiftPeriodId(periodId: string, by: number): string {
  const parsed = parsePeriodId(periodId)
  if (!parsed) return periodId
  const zeroBased = parsed.year * 12 + (parsed.month - 1) + by
  return makePeriodId(Math.floor(zeroBased / 12), (((zeroBased % 12) + 12) % 12) + 1)
}

/** `count` consecutive periods ending with `lastPeriodId`, oldest first. */
export function periodsEndingAt(lastPeriodId: string, count: number, startDay: number): MonthPeriod[] {
  const out: MonthPeriod[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const period = buildPeriod(shiftPeriodId(lastPeriodId, -offset), startDay)
    if (period) out.push(period)
  }
  return out
}

/**
 * Rebuilds existing periods against a new start day, keeping their ids and statuses.
 *
 * Used when the setting changes: the dates move, but a Locked period stays Locked and
 * keeps its id, so entries, approvals and the audit trail still point at it.
 */
export function restatePeriods(periods: readonly MonthPeriod[], startDay: number): MonthPeriod[] {
  return periods.map((period) => buildPeriod(period.periodId, startDay, period.status) ?? period)
}
