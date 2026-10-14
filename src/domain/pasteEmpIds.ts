/**
 * Reading a column of Emp IDs pasted out of Excel.
 *
 * The Office Executive usually arrives with the day's list already in a spreadsheet, so
 * copying that column beats ticking forty boxes. A paste from Excel is tab- and
 * newline-separated, often carries a header row, sometimes quotes, and sometimes the
 * 8-digit SAP id rather than the 4-digit floor one — all of which is handled here rather
 * than being the user's problem.
 */

import { floorEmpIdFrom } from '../data/plantMasters'

export interface PastedIds {
  /** Every Emp ID read, in the order pasted, without duplicates. */
  ids: number[]
  /** Lines that held no usable number — shown back so nothing is dropped silently. */
  ignored: string[]
}

/** Anything that is not a digit splits one value from the next. */
const SEPARATORS = /[\s,;|]+/

/**
 * Pulls Emp IDs out of pasted text.
 *
 * An 8-digit SAP userId is folded to the floor Emp ID, so a column copied out of
 * SuccessFactors works as well as one copied out of the Excel.
 */
export function parseEmpIds(text: string): PastedIds {
  const ids: number[] = []
  const ignored: string[] = []
  const seen = new Set<number>()

  for (const rawToken of text.split(SEPARATORS)) {
    const token = rawToken.trim().replace(/^["']|["']$/g, '')
    if (!token) continue

    // Strip anything that is not a digit: "Emp 1295", "#1295" and "1295." all mean 1295.
    const digits = token.replace(/\D+/g, '')
    if (!digits) {
      // A header like "Emp ID" is expected, not worth reporting back.
      if (!/^[a-z\s.#_-]+$/i.test(token)) ignored.push(token)
      continue
    }

    const parsed = floorEmpIdFrom(Number(digits))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      ignored.push(token)
      continue
    }
    if (seen.has(parsed)) continue

    seen.add(parsed)
    ids.push(parsed)
  }

  return { ids, ignored }
}

export interface PasteMatch {
  /** Pasted IDs that can be ticked right now. */
  matched: number[]
  /** Pasted IDs that are on the sheet already — reported, never silently re-added. */
  alreadyPresent: number[]
  /** Pasted IDs nobody on the incentive list has. */
  unknown: number[]
}

/**
 * Sorts a pasted list against who can actually be posted for.
 *
 * Every pasted ID lands in exactly one bucket, so the dialog can say precisely what it did
 * with the list rather than quietly ticking a subset.
 */
export function matchPastedIds(ids: number[], selectable: readonly number[], present: readonly number[]): PasteMatch {
  const canSelect = new Set(selectable)
  const onSheet = new Set(present)

  const matched: number[] = []
  const alreadyPresent: number[] = []
  const unknown: number[] = []

  for (const id of ids) {
    if (canSelect.has(id)) matched.push(id)
    else if (onSheet.has(id)) alreadyPresent.push(id)
    else unknown.push(id)
  }

  return { matched, alreadyPresent, unknown }
}

/** One line describing what a paste did, for the dialog to show. */
export function describePaste(match: PasteMatch, ignored: string[]): string {
  const parts: string[] = []
  parts.push(`${match.matched.length} selected`)
  if (match.alreadyPresent.length > 0) parts.push(`${match.alreadyPresent.length} already on the sheet`)
  if (match.unknown.length > 0) parts.push(`${match.unknown.length} not on the incentive list`)
  if (ignored.length > 0) parts.push(`${ignored.length} unreadable`)
  return parts.join(' · ')
}
