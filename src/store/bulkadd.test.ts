/**
 * Adding rows for a whole line is the slowest part of the Office Executive's day, so the
 * pieces behind it are pinned here: the usual-point lookup that pre-fills the dialog, and
 * the bulk write that creates the rows and audits each one.
 */

import { describe, expect, it } from 'vitest'
import { DEMO_TODAY } from '../config/policy'
import type { DailyEntry } from '../domain/types'
import { buildSeedState, DEFAULT_PERIOD_ID } from '../data/seed'
import { selectEntries, usualPoints } from './selectors'
import { applyWrite } from './writes'

const state = buildSeedState()
const ctx = { actorUserId: 'U-OE1', now: '2026-10-01T09:00:00.000Z' }

function draftRow(empId: number, pointId: string | null, entryId: string): DailyEntry {
  return {
    entryId,
    periodId: DEFAULT_PERIOD_ID,
    date: DEMO_TODAY,
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

describe('usualPoints pre-fills the point so nothing is typed in the common case', () => {
  const usual = usualPoints(state)

  it('gives every employee a point', () => {
    for (const employee of state.employees) {
      expect(usual.get(employee.empId), `${employee.empId} ${employee.name}`).toBeTruthy()
    }
  })

  it('only ever suggests a Point the employee is assigned to', () => {
    for (const employee of state.employees) {
      if (employee.pointIds.length === 0) continue
      expect(employee.pointIds, `${employee.empId}`).toContain(usual.get(employee.empId))
    }
  })

  it('picks the point the employee actually works most often', () => {
    const empId = 4101
    const counts = new Map<string, number>()
    for (const entry of state.entries) {
      if (entry.empId !== empId || !entry.pointId) continue
      counts.set(entry.pointId, (counts.get(entry.pointId) ?? 0) + 1)
    }
    const mostUsed = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    expect(usual.get(empId)).toBe(mostUsed)
  })

  it('falls back to an assigned Point for someone with no history', () => {
    const withoutHistory = usualPoints({ ...state, entries: [] })
    const employee = state.employees[0]
    expect(employee.pointIds).toContain(withoutHistory.get(employee.empId))
  })
})

describe('entry.addMany creates the whole batch in one write', () => {
  const sharedPoint = state.points[0]
  const picks = [4201, 4202, 4204, 4205].map((empId, index) => draftRow(empId, sharedPoint.pointId, `NEW-${index}`))
  const result = applyWrite(state, { kind: 'entry.addMany', entries: picks }, ctx)

  it('adds every row', () => {
    expect(result.state.entries.length).toBe(state.entries.length + picks.length)
    for (const row of picks) {
      expect(result.state.entries.some((e) => e.entryId === row.entryId)).toBe(true)
    }
  })

  it('writes one audit row per created row, naming the employee and point', () => {
    expect(result.logs).toHaveLength(picks.length)
    expect(result.logs.every((log) => log.entity === 'DailyEntry' && log.field === 'Row created')).toBe(true)
    expect(result.logs[0].newValue).toContain('Kashif Riaz')
    expect(result.logs[0].newValue).toContain(sharedPoint.name)
  })

  it('reports the count back to the user', () => {
    expect(result.message).toContain('4 rows added')
  })

  it('leaves the rows as editable drafts with no Output Batch', () => {
    const added = result.state.entries.filter((e) => e.entryId.startsWith('NEW-'))
    expect(added.every((e) => e.status === 'Draft')).toBe(true)
    expect(added.every((e) => e.actualBatches === null)).toBe(true)
  })

  it('does nothing at all when the selection is empty', () => {
    const empty = applyWrite(state, { kind: 'entry.addMany', entries: [] }, ctx)
    expect(empty.logs).toHaveLength(0)
    expect(empty.state).toBe(state)
  })
})

describe('the dialog has something to do the moment it opens', () => {
  const todayRows = selectEntries(state, { periodId: DEFAULT_PERIOD_ID, date: DEMO_TODAY })
  const covered = new Set(todayRows.map((row) => row.empId))
  const eligible = state.employees.filter(
    (e) => e.active && e.incentiveListStatus === 'Approved' && e.joinDate <= DEMO_TODAY && (e.leaveDate === null || e.leaveDate >= DEMO_TODAY),
  )
  const withoutRow = eligible.filter((e) => !covered.has(e.empId))

  it('leaves a worthwhile number of people unposted on today', () => {
    expect(withoutRow.length).toBeGreaterThan(3)
  })

  it('can suggest a point for every one of them, so the batch needs no typing', () => {
    const usual = usualPoints(state)
    for (const employee of withoutRow) {
      expect(usual.get(employee.empId), `${employee.empId} ${employee.name}`).toBeTruthy()
    }
  })

  it('adds the whole batch in a single write', () => {
    const usual = usualPoints(state)
    const picks = withoutRow.map((employee, index) => draftRow(employee.empId, usual.get(employee.empId) ?? null, `BULK-${index}`))
    const result = applyWrite(state, { kind: 'entry.addMany', entries: picks }, ctx)

    const after = selectEntries(result.state, { periodId: DEFAULT_PERIOD_ID, date: DEMO_TODAY })
    expect(new Set(after.map((row) => row.empId)).size).toBe(eligible.length)
    expect(result.logs).toHaveLength(withoutRow.length)
  })
})
