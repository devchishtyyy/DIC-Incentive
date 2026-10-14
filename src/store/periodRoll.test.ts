/**
 * The calendar rolling forward on its own, and every change belonging to a month.
 *
 * The period begins on the 16th whether or not anybody opened the app that morning, so a
 * maintained list of periods is a list that is wrong by definition. These tests pin the
 * two ways that could go badly: a month never appearing, and a month appearing on top of
 * one that was already locked.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_HISTORY_PERIODS, missingPeriods, periodContaining } from '../domain/periods'
import { buildBaseState } from '../data/seed'
import type { AppState } from '../domain/types'
import { applyWrite } from './writes'

const admin = { actorUserId: 'U-ADM', now: '2026-10-14T09:00:00.000Z' }
const base = buildBaseState()

// ---------------------------------------------------------------------------

describe('working out which periods are missing', () => {
  it('finds nothing when today is already covered', () => {
    expect(missingPeriods(base.periods, '2026-10-14', 16)).toEqual([])
  })

  it('opens the next one the moment the calendar reaches the 16th', () => {
    const missing = missingPeriods(base.periods, '2026-10-16', 16)
    expect(missing.map((p) => p.periodId)).toEqual(['2026-10'])
    expect(missing[0].startDate).toBe('2026-10-16')
  })

  it('still finds nothing on the 15th, which belongs to the period before', () => {
    expect(missingPeriods(base.periods, '2026-10-15', 16)).toEqual([])
  })

  it('CATCHES UP a gap nobody was there for', () => {
    // Nobody opened the app from October to February.
    const missing = missingPeriods(base.periods, '2027-02-20', 16)
    expect(missing.map((p) => p.periodId)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'])
  })

  it('leaves no gap or overlap in a caught-up run', () => {
    const missing = missingPeriods(base.periods, '2027-02-20', 16)
    const all = [...base.periods, ...missing].sort((a, b) => a.periodId.localeCompare(b.periodId))
    for (let i = 1; i < all.length; i += 1) {
      expect(new Date(all[i].startDate).getTime() - new Date(all[i - 1].endDate).getTime()).toBe(86400000)
    }
  })

  it('builds a run of history when there is nothing on file at all', () => {
    const missing = missingPeriods([], '2026-10-14', 16)
    expect(missing).toHaveLength(DEFAULT_HISTORY_PERIODS)
    expect(missing[missing.length - 1].periodId).toBe('2026-09')
  })

  it('follows the start-day setting', () => {
    const missing = missingPeriods(base.periods, '2026-10-17', 17)
    expect(missing[0].startDate).toBe('2026-10-17')
  })

  it('crosses a new year', () => {
    const missing = missingPeriods(base.periods, '2027-01-20', 16)
    expect(missing.map((p) => p.periodId)).toContain('2026-12')
    expect(missing.map((p) => p.periodId)).toContain('2027-01')
  })
})

describe('opening the periods the calendar has reached', () => {
  it('does nothing, and writes nothing, when there is nothing to open', () => {
    const result = applyWrite(base, { kind: 'period.ensure', today: '2026-10-14' }, admin)
    expect(result.state).toBe(base)
    expect(result.logs).toHaveLength(0)
  })

  it('opens the new period and logs it', () => {
    const result = applyWrite(base, { kind: 'period.ensure', today: '2026-10-16' }, admin)
    expect(result.state.periods.map((p) => p.periodId)).toContain('2026-10')

    const log = result.logs.find((row) => row.field === 'Period opened')!
    expect(log.entityId).toBe('2026-10')
    expect(log.periodId).toBe('2026-10')
    expect(log.reason).toContain('automatically')
  })

  it('LOGS EVERY MONTH IT OPENS, not just the newest', () => {
    const result = applyWrite(base, { kind: 'period.ensure', today: '2027-02-20' }, admin)
    const opened = result.logs.filter((row) => row.field === 'Period opened')
    expect(opened.map((row) => row.entityId)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'])
  })

  it('NEVER TOUCHES A PERIOD THAT ALREADY EXISTS', () => {
    const locked: AppState = {
      ...base,
      periods: base.periods.map((p) => (p.periodId === '2026-09' ? { ...p, status: 'Locked' as const } : p)),
    }
    const result = applyWrite(locked, { kind: 'period.ensure', today: '2027-02-20' }, admin)
    expect(result.state.periods.find((p) => p.periodId === '2026-09')!.status).toBe('Locked')
  })

  it('opens each new period as Open', () => {
    const result = applyWrite(base, { kind: 'period.ensure', today: '2026-11-20' }, admin)
    const fresh = result.state.periods.filter((p) => ['2026-10', '2026-11'].includes(p.periodId))
    expect(fresh.every((p) => p.status === 'Open')).toBe(true)
  })

  it('keeps the list in order', () => {
    const result = applyWrite(base, { kind: 'period.ensure', today: '2027-01-20' }, admin)
    const ids = result.state.periods.map((p) => p.periodId)
    expect([...ids].sort((a, b) => a.localeCompare(b))).toEqual(ids)
  })

  it('is safe to run twice', () => {
    const once = applyWrite(base, { kind: 'period.ensure', today: '2026-11-20' }, admin).state
    const twice = applyWrite(once, { kind: 'period.ensure', today: '2026-11-20' }, admin)
    expect(twice.state).toBe(once)
    expect(twice.logs).toHaveLength(0)
  })

  it('leaves every date in exactly one period afterwards', () => {
    const rolled = applyWrite(base, { kind: 'period.ensure', today: '2027-02-20' }, admin).state
    for (const date of ['2026-10-15', '2026-10-16', '2026-12-31', '2027-01-15', '2027-02-20']) {
      expect(periodContaining(rolled.periods, date), date).not.toBeNull()
    }
  })
})

describe('every change belongs to a month', () => {
  it('stamps a log with the period the op names', () => {
    const result = applyWrite(
      base,
      { kind: 'attendance.setMany', periodId: '2026-08', rows: [{ empId: 1295, daysAbsent: 3 }] },
      admin,
    )
    expect(result.logs[0].periodId).toBe('2026-08')
  })

  it('uses the month the change is ABOUT, not the month it was made in', () => {
    // Made on 14 October, which is in the September period — but it concerns August.
    const result = applyWrite(
      base,
      { kind: 'deptMarks.set', periodId: '2026-08', departmentId: 'DEP-PROD', patch: { quality: 12 } },
      admin,
    )
    expect(result.logs.every((row) => row.periodId === '2026-08')).toBe(true)
  })

  it('falls back to the month the clock is in when the op names none', () => {
    const result = applyWrite(base, { kind: 'employee.setName', empId: 6290, name: 'Imran Shah' }, admin)
    // 14 October 2026 falls in the period that began 16 September.
    expect(result.logs[0].periodId).toBe('2026-09')
  })

  it('gives every log row a month, whatever the op', () => {
    const ops = [
      { kind: 'employee.setName' as const, empId: 6290, name: 'Test Name' },
      { kind: 'point.create' as const, name: 'A New Point' },
      { kind: 'settings.update' as const, patch: { bandLow: 11 } },
      { kind: 'employee.approveAdd' as const, empIds: [1295], comment: '' },
    ]
    for (const op of ops) {
      const result = applyWrite(base, op, admin)
      for (const row of result.logs) {
        expect(row.periodId, `${op.kind}: ${row.field}`).not.toBe('')
      }
    }
  })

  it('ships a demo log where every row names its month', () => {
    const demo = buildBaseState()
    expect(demo.auditLog.every((row) => typeof row.periodId === 'string')).toBe(true)
  })
})
