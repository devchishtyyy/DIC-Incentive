/**
 * Dates are stored as real ISO dates (`YYYY-MM-DD`) and displayed as `dd.mm.yyyy`
 * to match what the office already reads. Nothing in the app parses a display string.
 */

import type { IsoDate } from './types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** UTC-anchored so the same ISO date is the same day in every timezone. */
export function toUtc(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function toIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10)
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return toIso(new Date(toUtc(iso).getTime() + days * MS_PER_DAY))
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / MS_PER_DAY)
}

/** Every calendar date from `start` to `end`, inclusive. */
export function dateRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) out.push(cursor)
  return out
}

/** 0 = Sunday. */
export function dayOfWeek(iso: IsoDate): number {
  return toUtc(iso).getUTCDay()
}

export function isSunday(iso: IsoDate): boolean {
  return dayOfWeek(iso) === 0
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The office format: 17.08.2026 */
export function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/** Compact header format: 17 Aug */
export function formatDayShort(iso: IsoDate): string {
  const date = toUtc(iso)
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]}`
}

export function formatWeekday(iso: IsoDate): string {
  return WEEKDAYS[dayOfWeek(iso)]
}

/** 17.08.2026 14:05 */
export function formatDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return '—'
  const date = new Date(isoDateTime)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * The submission deadline for a period: the 20th of the month in which the period ends
 * (policy section 10 — marks are due before the salary run).
 */
export function deadlineForPeriod(endDate: IsoDate, deadlineDay: number): IsoDate {
  const end = toUtc(endDate)
  const day = end.getUTCDate()
  // A period ending on or after the 20th is due on the 20th of the following month.
  const monthOffset = day >= deadlineDay ? 1 : 0
  const due = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + monthOffset, deadlineDay))
  return toIso(due)
}
