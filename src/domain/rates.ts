/**
 * Turning a score into rupees.
 *
 *   Approved = the rate for (site group × rate group × grade band)
 *   Earned   = Approved × Total ÷ 100, rounded half-up to whole PKR
 *
 * Two things here are deliberately unforgiving, because both failures would be silent and
 * both would be paid:
 *
 *   1. A grade that matches no band gives **null**, never a default band. Defaulting to B1
 *      underpays and defaulting to B3 overpays; a visible "band not set" is the only honest
 *      answer, and the MD-editable alias table is the fix.
 *   2. Every rupee figure is rounded once, at the end. The period total is the sum of the
 *      rounded amounts — what Finance actually pays — not a rounded sum.
 */

import type { Employee, RateGroup, Site } from './types'

export type GradeBand = 'B1' | 'B2' | 'B3'
export type SiteGroup = 'Kasur' | 'Non-Kasur'

export const GRADE_BANDS: readonly GradeBand[] = ['B1', 'B2', 'B3']

export interface RateRow {
  siteGroup: SiteGroup
  rateGroup: RateGroup
  B1: number
  B2: number
  B3: number
}

export interface RateTable {
  versionId: string
  effectiveFrom: string
  note: string
  rows: RateRow[]
}

/** Signed Incentive Revision 2025/2026, effective 1 Jan 2025. */
export const RATE_TABLE_2025: RateTable = {
  versionId: 'RATE-2025',
  effectiveFrom: '2025-01-01',
  note: 'Signed Incentive Revision 2025/2026. Next revision due Dec 2026 – Jan 2027.',
  rows: [
    { siteGroup: 'Kasur', rateGroup: 'Production', B1: 22800, B2: 24100, B3: 24750 },
    { siteGroup: 'Kasur', rateGroup: 'Support', B1: 21200, B2: 22500, B3: 23800 },
    { siteGroup: 'Non-Kasur', rateGroup: 'Production', B1: 16800, B2: 18100, B3: 18750 },
    { siteGroup: 'Non-Kasur', rateGroup: 'Support', B1: 15200, B2: 16500, B3: 17800 },
  ],
}

/** Everywhere that is not Kasur pays the lower column. */
export function siteGroupFor(site: Site): SiteGroup {
  return site === 'Kasur' ? 'Kasur' : 'Non-Kasur'
}

// ---------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------

/**
 * Grade code → band, from the signed sheet:
 *   B1 — up to Grade II and Grade A
 *   B2 — Grade III to Grade V, and Grade P to PIII
 *   B3 — Grade TE to TE4, JE, JE-I
 */
export const DEFAULT_GRADE_ALIASES: Record<string, GradeBand> = {
  // B3
  TE: 'B3', TE1: 'B3', TE2: 'B3', TE3: 'B3', TE4: 'B3', JE: 'B3', 'JE-I': 'B3', 'JE-1': 'B3',
  // B2
  P: 'B2', PI: 'B2', PII: 'B2', PIII: 'B2', III: 'B2', IV: 'B2', V: 'B2',
  // B1
  A: 'B1', I: 'B1', II: 'B1',
}

/**
 * Pulls the grade code out of whatever SuccessFactors sent.
 *
 * Real values look like `Technical Executive Level (TE2) (GRD.TE.2)`. There are two codes
 * in there and **they disagree**: the display code is arabic (`P3`), the `GRD` token is
 * roman (`GRD.PIII`), and it is the roman one that appears on the signed sheet. Matching on
 * the display code would silently fail for nine of the forty-two people on the list, so the
 * `GRD` token is tried first.
 *
 * Returns every candidate, best first, so the caller can try them against the alias table
 * in order.
 */
export function gradeCodeCandidates(grade: string): string[] {
  const out: string[] = []
  const add = (value: string | undefined) => {
    const cleaned = (value ?? '').trim().toUpperCase()
    if (cleaned && !out.includes(cleaned)) out.push(cleaned)
  }

  // `(GRD.TE.2)` → `TE2`; `(GRD.PIII)` → `PIII`.
  const grd = /GRD\.([A-Z0-9.\-]+)/i.exec(grade)
  if (grd) {
    add(grd[1].replace(/\./g, ''))
    add(grd[1])
  }

  // Every parenthesised group, last first — `(TE2)` is nearer the code than the job title.
  const parens = [...grade.matchAll(/\(([^)]+)\)/g)].map((match) => match[1])
  for (const value of parens.reverse()) {
    if (/^GRD/i.test(value.trim())) continue
    add(value.replace(/\./g, ''))
  }

  // Last resort: the string itself, and the word "Grade" stripped off it.
  add(grade.replace(/^GRADE\s+/i, ''))
  add(grade)
  return out
}

/**
 * The band for a grade, or **null** when nothing matches.
 *
 * Null is the point. An unrecognised grade has to stop the money calculation and say so,
 * because any default would be wrong for somebody and nobody would ever notice.
 */
export function bandForGrade(grade: string, aliases: Record<string, GradeBand> = DEFAULT_GRADE_ALIASES): GradeBand | null {
  if (!grade || !grade.trim()) return null

  const table = new Map(Object.entries(aliases).map(([code, band]) => [code.trim().toUpperCase(), band]))
  for (const candidate of gradeCodeCandidates(grade)) {
    const band = table.get(candidate)
    if (band) return band
  }
  return null
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export interface ApprovedLookup {
  approved: number | null
  band: GradeBand | null
  siteGroup: SiteGroup
  rateGroup: RateGroup
  /** Why there is no amount, when there is none. */
  reason: string
}

export function approvedFor(
  employee: Pick<Employee, 'grade' | 'site'>,
  rateGroup: RateGroup,
  table: RateTable,
  aliases: Record<string, GradeBand> = DEFAULT_GRADE_ALIASES,
): ApprovedLookup {
  const siteGroup = siteGroupFor(employee.site)
  const band = bandForGrade(employee.grade, aliases)

  if (band === null) {
    return {
      approved: null,
      band: null,
      siteGroup,
      rateGroup,
      reason: employee.grade?.trim()
        ? `No grade band for "${employee.grade}". Add it to the grade alias table.`
        : 'No pay grade — it arrives with the SAP sync, or can be set on People.',
    }
  }

  const row = table.rows.find((candidate) => candidate.siteGroup === siteGroup && candidate.rateGroup === rateGroup)
  if (!row) {
    return { approved: null, band, siteGroup, rateGroup, reason: `No rate for ${siteGroup} · ${rateGroup}.` }
  }

  return { approved: row[band], band, siteGroup, rateGroup, reason: '' }
}

/**
 * Half-up to whole rupees, steady against binary floating point.
 *
 * `24112.985` is really `24112.984999…`, which `Math.round` takes down to 24112. A rupee
 * is not much, but it is the difference between the app and the workbook agreeing or not.
 */
export function roundRupees(amount: number | null): number | null {
  if (amount === null || !Number.isFinite(amount)) return null
  const sign = amount < 0 ? -1 : 1
  return sign * Math.round(Math.abs(amount) + Number.EPSILON * Math.abs(amount))
}

/** Earned = Approved × Total ÷ 100, to whole rupees. Null if either input is missing. */
export function earnedFor(approved: number | null, total: number | null): number | null {
  if (approved === null || total === null) return null
  if (!Number.isFinite(approved) || !Number.isFinite(total)) return null
  return roundRupees((approved * total) / 100)
}

/**
 * The period's payout: the sum of the **rounded** amounts.
 *
 * Summing first and rounding once would differ by a rupee or two from the sum of what each
 * person is actually paid, and the payroll file is the per-person figures.
 */
export function periodPayout(earned: ReadonlyArray<number | null>): number {
  return earned.reduce<number>((sum, amount) => sum + (amount ?? 0), 0)
}
