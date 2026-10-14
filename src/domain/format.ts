/**
 * Display formatting. Scores to 2 decimals, percentages to 1, batches to 2 —
 * and rounding happens only here. Totals always use the unrounded value.
 */

import { DECIMALS } from '../config/policy'
import { round } from './calc'

export const EMPTY = '—'

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  return round(value, DECIMALS.score).toFixed(DECIMALS.score)
}

/** Takes a fraction (1.1875) and shows it as a percentage (118.8%). */
export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return EMPTY
  return `${round(fraction * 100, DECIMALS.percent).toFixed(DECIMALS.percent)}%`
}

export function formatBatches(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  return round(value, DECIMALS.batches).toFixed(DECIMALS.batches).replace(/\.00$/, '')
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  return round(value, decimals).toFixed(decimals)
}

export function formatRupees(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  return `Rs ${Math.round(value).toLocaleString('en-PK')}`
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
