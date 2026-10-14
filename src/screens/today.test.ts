/**
 * Daily Entry must open on a sheet the tester can actually type into. These tests pin the
 * demo to that: today is a working day in the Open period, it already has a row per
 * employee, and a good share of them are blank and waiting.
 */

import { describe, expect, it } from 'vitest'
import { DEMO_TODAY } from '../config/policy'
import { can } from '../domain/permissions'
import { isWorkingDay, periodById, periodWorkingDays, selectEntries } from '../store/selectors'
import { buildSeedState, DEFAULT_PERIOD_ID } from '../data/seed'

const state = buildSeedState()
const period = periodById(state, DEFAULT_PERIOD_ID)!

describe('the app opens on a period that can be edited', () => {
  it('defaults to the period that is still Open', () => {
    expect(period.status).toBe('Open')
  })

  it('has today inside that period', () => {
    expect(period.startDate <= DEMO_TODAY && DEMO_TODAY <= period.endDate).toBe(true)
  })

  it('treats today as a working day', () => {
    expect(isWorkingDay(state, DEMO_TODAY)).toBe(true)
    expect(periodWorkingDays(state, period)).toContain(DEMO_TODAY)
  })

  it('is the last working day up to today, so Daily Entry lands on it', () => {
    const upToToday = periodWorkingDays(state, period).filter((date) => date <= DEMO_TODAY)
    expect(upToToday[upToToday.length - 1]).toBe(DEMO_TODAY)
  })
})

describe("today's sheet is ready to type into", () => {
  const todayRows = selectEntries(state, { periodId: DEFAULT_PERIOD_ID, date: DEMO_TODAY })

  it('covers most of the line, and leaves some people to be added', () => {
    const eligible = state.employees.filter(
      (e) => e.active && e.incentiveListStatus === 'Approved' && e.joinDate <= DEMO_TODAY && (e.leaveDate === null || e.leaveDate >= DEMO_TODAY),
    )
    const covered = new Set(todayRows.map((row) => row.empId))
    expect(covered.size).toBeGreaterThan(eligible.length * 0.5)
    expect(covered.size).toBeLessThan(eligible.length)
  })

  it('leaves every row in Draft, so nothing reads as already submitted', () => {
    expect(todayRows.every((row) => row.status === 'Draft')).toBe(true)
  })

  it('gives every row a point and a usable target', () => {
    expect(todayRows.every((row) => row.pointId !== null)).toBe(true)
    expect(todayRows.every((row) => (row.target ?? 0) > 0)).toBe(true)
  })

  it('leaves a meaningful share blank and waiting for the Office Executive', () => {
    const blank = todayRows.filter((row) => row.actualBatches === null)
    expect(blank.length).toBeGreaterThan(5)
    expect(blank.length).toBeLessThan(todayRows.length)
  })

  it('lets the Office Executive edit those rows', () => {
    const decision = can('OFFICE_EXEC', 'entry.edit', { periodStatus: period.status, entryStatus: 'Draft' })
    expect(decision.allowed).toBe(true)
  })

  it('lets the day be submitted once the blanks are filled', () => {
    expect(can('OFFICE_EXEC', 'day.submit', { periodStatus: period.status }).allowed).toBe(true)
  })

  it('only posts people on Points they are assigned to', () => {
    for (const row of todayRows) {
      const employee = state.employees.find((e) => e.empId === row.empId)!
      expect(employee.pointIds, String(row.empId)).toContain(row.pointId)
    }
  })
})

describe('the earlier days of the open period stay as they were', () => {
  it('still has submitted days behind today', () => {
    const submitted = selectEntries(state, { periodId: DEFAULT_PERIOD_ID }).filter((row) => row.status === 'Submitted')
    expect(submitted.length).toBeGreaterThan(100)
  })
})
