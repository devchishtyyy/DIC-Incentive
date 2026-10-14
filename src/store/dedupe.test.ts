/**
 * A row is one employee, on one point, on one day.
 *
 * Bulk add therefore never creates a second one: anything already on the sheet is skipped
 * and reported back, and only the genuinely new rows are written. The duplicate *warning*
 * from section 6 of the build brief still exists for duplicates that arrive another way —
 * a changed point, an import — and is tested in calc.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { DEMO_TODAY } from '../config/policy'
import { ISSUE } from '../domain/calc'
import type { DailyEntry } from '../domain/types'
import { buildSeedState, DEFAULT_PERIOD_ID } from '../data/seed'
import { openIssuesFor, selectEntries } from './selectors'
import { applyWrite } from './writes'

const state = buildSeedState()
const ctx = { actorUserId: 'U-OE1', now: '2026-10-01T09:00:00.000Z' }
const todayRows = selectEntries(state, { periodId: DEFAULT_PERIOD_ID, date: DEMO_TODAY })

function row(empId: number, pointId: string | null, entryId: string, date = DEMO_TODAY): DailyEntry {
  return {
    entryId,
    periodId: DEFAULT_PERIOD_ID,
    date,
    empId,
    pointId,
    target: 4,
    actualBatches: null,
    scoreOverride: null,
    overrideReason: null,
    acknowledgedWarnings: [],
    status: 'Draft',
    enteredBy: ctx.actorUserId,
    enteredAt: ctx.now,
    updatedBy: null,
    updatedAt: null,
  }
}

const sample = todayRows[0]

describe('bulk add refuses to repeat a row that is already there', () => {
  it('skips an exact employee-and-point repeat and keeps the original', () => {
    const before = state.entries.length
    const result = applyWrite(state, { kind: 'entry.addMany', entries: [row(sample.empId, sample.pointId, 'DUP-1')] }, ctx)

    expect(result.state.entries.length).toBe(before)
    expect(result.logs).toHaveLength(0)
    expect(result.message).toContain('already on the sheet')
    expect(result.state.entries.some((e) => e.entryId === 'DUP-1')).toBe(false)
  })

  it('adds the new ones and skips only the repeats', () => {
    const newcomer = state.employees.find(
      (e) => e.incentiveListStatus === 'Approved' && !todayRows.some((r) => r.empId === e.empId),
    )!
    const result = applyWrite(
      state,
      {
        kind: 'entry.addMany',
        entries: [row(sample.empId, sample.pointId, 'DUP-2'), row(newcomer.empId, 'PT-DISPERSION', 'NEW-2')],
      },
      ctx,
    )

    expect(result.state.entries.some((e) => e.entryId === 'NEW-2')).toBe(true)
    expect(result.state.entries.some((e) => e.entryId === 'DUP-2')).toBe(false)
    expect(result.logs).toHaveLength(1)
    expect(result.message).toContain('1 row added')
    expect(result.message).toContain('1 skipped')
  })

  it('allows the same employee on a different point — that is a real second row', () => {
    const otherPoint = state.points.find((p) => p.pointId !== sample.pointId)!
    const result = applyWrite(state, { kind: 'entry.addMany', entries: [row(sample.empId, otherPoint.pointId, 'SECOND')] }, ctx)

    expect(result.state.entries.some((e) => e.entryId === 'SECOND')).toBe(true)
    expect(result.logs).toHaveLength(1)
  })

  it('allows the same employee and point on a different day', () => {
    const result = applyWrite(state, { kind: 'entry.addMany', entries: [row(sample.empId, sample.pointId, 'TOMORROW', '2026-10-02')] }, ctx)
    expect(result.state.entries.some((e) => e.entryId === 'TOMORROW')).toBe(true)
  })

  it('de-duplicates within the batch itself, not just against the sheet', () => {
    const newcomer = state.employees.find(
      (e) => e.incentiveListStatus === 'Approved' && !todayRows.some((r) => r.empId === e.empId),
    )!
    const result = applyWrite(
      state,
      {
        kind: 'entry.addMany',
        entries: [row(newcomer.empId, 'PT-DISPERSION', 'A'), row(newcomer.empId, 'PT-DISPERSION', 'B')],
      },
      ctx,
    )

    expect(result.state.entries.filter((e) => e.entryId === 'A' || e.entryId === 'B')).toHaveLength(1)
    expect(result.message).toContain('1 skipped')
  })

  it('never produces a row that would raise the duplicate warning', () => {
    const picks = todayRows.slice(0, 5).map((r, i) => row(r.empId, r.pointId, `X-${i}`))
    const result = applyWrite(state, { kind: 'entry.addMany', entries: picks }, ctx)
    const flagged = result.state.entries.filter((entry) =>
      openIssuesFor(result.state, entry).some((issue) => issue.code === ISSUE.DUPLICATE_ROW),
    )
    // Only the one duplicate the seed plants on purpose (scenario 4) remains.
    expect(flagged.every((entry) => entry.date === '2026-09-28')).toBe(true)
  })
})

describe('batch delete', () => {
  const drafts = todayRows.slice(0, 4).map((r) => r.entryId)

  it('removes every selected row in one write', () => {
    const result = applyWrite(state, { kind: 'entry.deleteMany', entryIds: drafts }, ctx)
    expect(result.state.entries.length).toBe(state.entries.length - drafts.length)
    for (const entryId of drafts) {
      expect(result.state.entries.some((e) => e.entryId === entryId)).toBe(false)
    }
  })

  it('audits each deletion with the values the row held', () => {
    const result = applyWrite(state, { kind: 'entry.deleteMany', entryIds: drafts }, ctx)
    expect(result.logs).toHaveLength(drafts.length)
    expect(result.logs.every((log) => log.field === 'Row deleted')).toBe(true)
    expect(result.logs.every((log) => log.oldValue.length > 10 && log.newValue === '')).toBe(true)
  })

  it('reports the count back to the user', () => {
    const result = applyWrite(state, { kind: 'entry.deleteMany', entryIds: drafts }, ctx)
    expect(result.message).toBe('4 draft rows deleted.')
  })

  it('leaves everything else untouched', () => {
    const result = applyWrite(state, { kind: 'entry.deleteMany', entryIds: drafts }, ctx)
    const survivor = todayRows[5]
    expect(result.state.entries.some((e) => e.entryId === survivor.entryId)).toBe(true)
  })

  it('does nothing when given ids that are not there', () => {
    const result = applyWrite(state, { kind: 'entry.deleteMany', entryIds: ['NOPE-1', 'NOPE-2'] }, ctx)
    expect(result.logs).toHaveLength(0)
    expect(result.state).toBe(state)
  })

  it('does nothing for an empty selection', () => {
    const result = applyWrite(state, { kind: 'entry.deleteMany', entryIds: [] }, ctx)
    expect(result.logs).toHaveLength(0)
    expect(result.state).toBe(state)
  })
})
