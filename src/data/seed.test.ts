/**
 * The seed is the demo's contract: section 8 of the build brief says every scenario must
 * be reachable from the UI without editing code. These tests prove each one is really in
 * the data, and that the shape matches the Excel it replaces.
 */

import { describe, expect, it } from 'vitest'
import { calcEmployeeDay, entryPercent, entryScore, round } from '../domain/calc'
import { deadlineForPeriod } from '../domain/dates'
import { monthChecklist, periodHealth, periodWorkingDays, scorecard, selectEntries } from '../store/selectors'
import { hodHasSigned } from '../store/writes'
import { buildSeedState, MAIN_PERIOD_ID, OPEN_PERIOD_ID, SCENARIOS } from './seed'

const state = buildSeedState()
const main = state.periods.find((p) => p.periodId === MAIN_PERIOD_ID)!
const open = state.periods.find((p) => p.periodId === OPEN_PERIOD_ID)!
const TODAY = '2026-10-01'

const rowsFor = (empId: number, date: string) => state.entries.filter((e) => e.empId === empId && e.date === date)

// ---------------------------------------------------------------------------

describe('the seed copies the shape of the real Excel', () => {
  it('has 35 employees on the incentive list, plus one waiting for MD approval', () => {
    const approved = state.employees.filter((e) => e.incentiveListStatus === 'Approved')
    const pending = state.employees.filter((e) => e.incentiveListStatus === 'Pending MD approval')
    expect(approved).toHaveLength(35)
    expect(pending).toHaveLength(1)
  })


  it('has the 25 real Points, each with a demo target between 1 and 15', () => {
    expect(state.points).toHaveLength(25)
    for (const point of state.points) {
      expect(point.defaultTarget).toBeGreaterThanOrEqual(1)
      expect(point.defaultTarget).toBeLessThanOrEqual(15)
    }
  })

  it('gives the 17 Aug to 15 Sep period exactly 26 working days', () => {
    expect(periodWorkingDays(state, main)).toHaveLength(26)
  })

  it('holds about 780 rows for that period', () => {
    const rows = selectEntries(state, { periodId: MAIN_PERIOD_ID })
    expect(rows.length).toBeGreaterThan(680)
    expect(rows.length).toBeLessThan(900)
  })

  it('has at least one user per role, one HOD and two Office Executives', () => {
    const byRole = (role: string) => state.users.filter((u) => u.role === role)
    expect(byRole('OFFICE_EXEC')).toHaveLength(2)
    expect(byRole('HOD')).toHaveLength(1)
    for (const role of ['OPS_MANAGER', 'FINANCE', 'EHS_REP', 'MD_CEO', 'ADMIN']) {
      expect(byRole(role).length).toBeGreaterThanOrEqual(1)
    }
  })

  it('never produces a score above the cap anywhere in the data', () => {
    for (const entry of state.entries) {
      const score = entryScore(entry, state.settings)
      if (score !== null) expect(score).toBeLessThanOrEqual(state.settings.scoreCap)
    }
  })

  it('pins the demo so the Aug–Sep deadline has passed and the Sep–Oct one has not', () => {
    expect(deadlineForPeriod(main.endDate, 20)).toBe('2026-09-20')
    expect(deadlineForPeriod(open.endDate, 20)).toBe('2026-10-20')
    expect(TODAY > deadlineForPeriod(main.endDate, 20)).toBe(true)
    expect(TODAY < deadlineForPeriod(open.endDate, 20)).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('seeded scenario 1 — an employee who scores 20 every day', () => {
  it('gives Adeel Farooq (4101) a flat 20.00', () => {
    const row = scorecard(state, MAIN_PERIOD_ID).rows.find((r) => r.employee.empId === 4101)!
    expect(row.daysScored).toBe(26)
    expect(round(row.total!, 2)).toBe(20)
  })
})

describe('seeded scenario 2 — an employee under target, averaging about 15', () => {
  it('lands Bilal Nawaz (4102) in the 13 to 17 band', () => {
    const row = scorecard(state, MAIN_PERIOD_ID).rows.find((r) => r.employee.empId === 4102)!
    expect(row.total!).toBeGreaterThan(13)
    expect(row.total!).toBeLessThan(17)
  })

  it('has a visibly worse week from 24 to 29 August', () => {
    const inWeek = state.entries.filter((e) => e.empId === 4102 && e.date >= '2026-08-24' && e.date <= '2026-08-29')
    const scores = inWeek.map((e) => entryScore(e, state.settings)!).filter((s) => Number.isFinite(s))
    expect(scores.length).toBeGreaterThan(2)
    expect(scores.reduce((a, b) => a + b, 0) / scores.length).toBeLessThan(13)
  })
})

describe('seeded scenario 3 — output above target proves the cap', () => {
  it.each([
    ['2026-08-19', MAIN_PERIOD_ID],
    ['2026-09-30', OPEN_PERIOD_ID],
  ])('on %s shows 118.8%% and a score of 20.00', (date, periodId) => {
    const rows = rowsFor(4103, date)
    expect(rows).toHaveLength(1)
    expect(rows[0].periodId).toBe(periodId)
    expect(rows[0].target).toBe(4)
    expect(rows[0].actualBatches).toBe(4.75)
    expect(round(entryPercent(rows[0])! * 100, 1)).toBe(118.8)
    expect(round(entryScore(rows[0], state.settings)!, 2)).toBe(20)
  })
})

describe('seeded scenario 4 — a duplicate row', () => {
  it('puts Zeeshan Haider (4105) on Weighing twice for 28 September', () => {
    const rows = rowsFor(4105, '2026-09-28')
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.pointId)).size).toBe(1)
    expect(rows.every((r) => r.acknowledgedWarnings.length === 0)).toBe(true)
  })

  it('leaves the open period checklist red because of it', () => {
    const items = monthChecklist(state, open, TODAY)
    expect(items.find((item) => item.label === 'No open warnings')!.ok).toBe(false)
  })
})

describe('seeded scenario 5 — the outlier', () => {
  it('records target 1 against output 19 for Faizan Mir (4106)', () => {
    const rows = rowsFor(4106, '2026-09-29')
    expect(rows).toHaveLength(1)
    expect(rows[0].target).toBe(1)
    expect(rows[0].actualBatches).toBe(19)
    expect(entryScore(rows[0], state.settings)).toBe(20)
    expect(round(entryPercent(rows[0])! * 100, 0)).toBe(1900)
  })
})

describe('seeded scenario 6 — a blank point', () => {
  it('leaves Nabeel Arshad (4107) without a point on 30 September', () => {
    const rows = rowsFor(4107, '2026-09-30')
    expect(rows).toHaveLength(1)
    expect(rows[0].pointId).toBeNull()
  })

  it('makes the open period fail the Output Batch check', () => {
    const items = monthChecklist(state, open, TODAY)
    expect(items.find((item) => item.label === 'Every row has an Output Batch')!.ok).toBe(false)
  })

  it('counts as a blocking error, not merely an untyped row', () => {
    expect(periodHealth(state, open, TODAY).openErrors).toBeGreaterThan(0)
  })
})

describe('seeded scenario 7 — two points in one day', () => {
  it('averages Usman Tariq (4104) to 15.00 on 20 August', () => {
    const rows = rowsFor(4104, '2026-08-20')
    expect(rows).toHaveLength(2)
    expect(round(calcEmployeeDay(rows, state.settings)!, 2)).toBe(15)
  })
})

describe('seeded scenario 8 — a HOD target change on a stock-taking day', () => {
  it('has dated rules for 25 August with the policy reason', () => {
    const rules = state.targetRules.filter((rule) => rule.effectiveFrom === '2026-08-25')
    expect(rules.length).toBe(3)
    expect(rules.every((rule) => rule.reason === 'Stock-taking day')).toBe(true)
    expect(rules.every((rule) => rule.changedBy === 'U-HOD')).toBe(true)
  })

  it('writes the reason to the audit log', () => {
    const logged = state.auditLog.filter((row) => row.entity === 'TargetRule' && row.reason === 'Stock-taking day')
    expect(logged.length).toBe(3)
    expect(logged.every((row) => row.oldValue !== row.newValue)).toBe(true)
  })

  it('scored the 25 August Dispersion rows against the reduced target, not the default', () => {
    const rows = state.entries.filter((e) => e.date === '2026-08-25' && e.pointId === 'PT-DISPERSION')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.target === 2)).toBe(true)
  })

  it('left every other day on that Point default', () => {
    const fallback = state.points.find((p) => p.pointId === 'PT-DISPERSION')!.defaultTarget
    const rows = state.entries.filter((e) => e.date === '2026-08-24' && e.pointId === 'PT-DISPERSION')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.target === fallback)).toBe(true)
  })
})

describe('seeded scenario 9 — a day with no entries for a block of staff', () => {
  it('leaves a dozen people without rows on 29 September', () => {
    const missing = state.employees.slice(20, 32).map((employee) => employee.empId)
    const rows = state.entries.filter((e) => e.date === '2026-09-29' && missing.includes(e.empId))
    expect(rows).toHaveLength(0)
  })

  it('still has rows that day for everyone else', () => {
    expect(state.entries.filter((e) => e.date === '2026-09-29').length).toBeGreaterThan(0)
  })
})

describe('seeded scenario 10 — a period in each workflow state', () => {
  it('provides Open, Submitted, HOD Signed and Locked', () => {
    expect(state.periods.map((p) => p.status).sort()).toEqual(['HOD Signed', 'Locked', 'Open', 'Submitted'])
  })

  it('locks every row of the locked period', () => {
    const locked = state.periods.find((p) => p.status === 'Locked')!
    const rows = selectEntries(state, { periodId: locked.periodId })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.status === 'Locked')).toBe(true)
  })

  it('leaves draft rows only in the open period', () => {
    for (const period of state.periods) {
      const drafts = selectEntries(state, { periodId: period.periodId }).filter((row) => row.status === 'Draft')
      if (period.status === 'Open') expect(drafts.length).toBeGreaterThan(0)
      else expect(drafts).toHaveLength(0)
    }
  })
})

describe('seeded scenario 11 — a rejected submission and a resubmit', () => {
  it('records the HOD return with a comment', () => {
    const returned = state.approvals.find((step) => step.periodId === MAIN_PERIOD_ID && step.decision === 'Returned')!
    expect(returned.comment.length).toBeGreaterThan(20)
  })

  it('leaves the resubmitted month unsigned', () => {
    expect(hodHasSigned(state, MAIN_PERIOD_ID)).toBe(false)
  })

  it('shows the earlier period as signed', () => {
    expect(hodHasSigned(state, '2026-07')).toBe(true)
  })
})

describe('seeded scenario 12 — an employee waiting for MD approval', () => {
  const pending = state.employees.find((e) => e.incentiveListStatus === 'Pending MD approval')!

  it('is flagged and attributed to the requester', () => {
    expect(pending.empId).toBe(4999)
    expect(pending.requestedBy).toBeTruthy()
  })

  it('is excluded from the monthly roll-up', () => {
    const rows = scorecard(state, OPEN_PERIOD_ID).rows
    expect(rows.find((row) => row.employee.empId === pending.empId)).toBeUndefined()
  })
})

describe('seeded scenario 13 — probation staff, a joiner and a leaver', () => {
  it('flags two probation employees', () => {
    expect(state.employees.filter((e) => e.status === 'Probation')).toHaveLength(2)
  })

  it('has a mid-period joiner with no rows before they joined', () => {
    const joiner = state.employees.find((e) => e.empId === 4119)!
    expect(joiner.joinDate).toBe('2026-09-01')
    expect(state.entries.filter((e) => e.empId === 4119 && e.date < joiner.joinDate)).toHaveLength(0)
  })

  it('has a leaver with no rows after they left', () => {
    const leaver = state.employees.find((e) => e.empId === 4120)!
    expect(leaver.leaveDate).toBe('2026-09-05')
    expect(state.entries.filter((e) => e.empId === 4120 && e.date > leaver.leaveDate!)).toHaveLength(0)
  })

  it('surfaces the pro-rata flags on the scorecard row', () => {
    const rows = scorecard(state, MAIN_PERIOD_ID).rows
    expect(rows.find((r) => r.employee.empId === 4116)!.flags.join(' ')).toContain('Probation')
    expect(rows.find((r) => r.employee.empId === 4119)!.flags.join(' ')).toContain('pro-rata')
    expect(rows.find((r) => r.employee.empId === 4120)!.flags.join(' ')).toContain('Left')
  })
})

// ---------------------------------------------------------------------------

describe('acceptance test 12 — the scorecard total matches the Excel method', () => {
  it('equals the average of the employee-day scores over scored days', () => {
    const { dates, rows } = scorecard(state, MAIN_PERIOD_ID)
    for (const row of rows.slice(0, 10)) {
      const manual = dates
        .map((date) => calcEmployeeDay(state.entries.filter((e) => e.empId === row.employee.empId && e.date === date), state.settings))
        .filter((score): score is number => score !== null)
      if (manual.length === 0 || row.overridden) continue
      expect(round(row.total!, 6)).toBe(round(manual.reduce((a, b) => a + b, 0) / manual.length, 6))
    }
  })

  it('never counts a missing day as a zero', () => {
    const row = scorecard(state, MAIN_PERIOD_ID).rows.find((r) => r.daysScored < 26 && !r.overridden)!
    expect(row.daysScored).toBeLessThan(26)
    expect(row.total).toBeGreaterThan(0)
  })
})

describe('the Demo Guide can reach every scenario', () => {
  it('lists all thirteen with a link', () => {
    expect(SCENARIOS).toHaveLength(13)
    for (const scenario of SCENARIOS) {
      expect(scenario.to.startsWith('/')).toBe(true)
      expect(scenario.detail.length).toBeGreaterThan(20)
    }
  })
})
