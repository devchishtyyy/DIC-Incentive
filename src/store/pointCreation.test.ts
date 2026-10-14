/**
 * Points typed in during entry.
 *
 * New employees are not on the assignment list, so the HOD or Office Executive gives them
 * a Point — picked from the existing ones, or typed. Typing is where the old sheet's
 * "manual / Manual / MANUAL" problem came from, so a typed name that already exists must
 * resolve to that Point rather than creating a second one.
 */

import { describe, expect, it } from 'vitest'
import { buildDemoState } from '../data/seed'
import { applyWrite } from './writes'
import { usualPoints } from './selectors'

const state = buildDemoState()
const ctx = { actorUserId: 'U-HOD', now: '2026-10-07T09:00:00.000Z' }
const newcomer = state.employees[0].empId

describe('creating a Point during entry', () => {
  it('adds it to the master data', () => {
    const result = applyWrite(state, { kind: 'point.create', name: 'Lab Sampling' }, ctx)
    expect(result.state.points.find((point) => point.name === 'Lab Sampling')).toBeTruthy()
    expect(result.state.points.length).toBe(state.points.length + 1)
  })

  it('marks it as needing a real Daily Target', () => {
    const result = applyWrite(state, { kind: 'point.create', name: 'Lab Sampling' }, ctx)
    const added = result.state.points.find((point) => point.name === 'Lab Sampling')!

    expect(added.defaultTargetSet).toBe(false)
    expect(added.createdOnTheFloor).toBe(true)
  })

  it('records who typed it in and where', () => {
    const result = applyWrite(state, { kind: 'point.create', name: 'Lab Sampling' }, ctx)
    const log = result.logs.find((entry) => entry.entity === 'Point')!

    expect(log.field).toContain('created during entry')
    expect(log.userId).toBe('U-HOD')
    expect(log.reason).toContain('Daily Entry')
  })

  it('assigns it to the employee it was typed for', () => {
    const result = applyWrite(
      state,
      { kind: 'point.create', name: 'Lab Sampling', assignToEmpId: newcomer },
      ctx,
    )
    const added = result.state.points.find((point) => point.name === 'Lab Sampling')!
    const employee = result.state.employees.find((e) => e.empId === newcomer)!

    expect(employee.pointIds).toContain(added.pointId)
  })
})

describe('a name that already exists is reused, not duplicated', () => {
  const existing = state.points[0]

  it('matches regardless of casing — the manual / Manual / MANUAL problem', () => {
    const result = applyWrite(state, { kind: 'point.create', name: existing.name.toUpperCase() }, ctx)

    expect(result.state.points.length).toBe(state.points.length)
    expect(result.message).toContain('already exists')
  })

  it('matches regardless of surrounding spaces', () => {
    const result = applyWrite(state, { kind: 'point.create', name: `  ${existing.name}  ` }, ctx)
    expect(result.state.points.length).toBe(state.points.length)
  })

  it('still assigns the existing Point to the employee', () => {
    const fresh = {
      ...state,
      employees: state.employees.map((e) => (e.empId === newcomer ? { ...e, pointIds: [] } : e)),
    }
    const result = applyWrite(
      fresh,
      { kind: 'point.create', name: existing.name, assignToEmpId: newcomer },
      ctx,
    )

    expect(result.state.employees.find((e) => e.empId === newcomer)!.pointIds).toEqual([existing.pointId])
  })

  it('refuses an empty name', () => {
    const result = applyWrite(state, { kind: 'point.create', name: '   ' }, ctx)
    expect(result.state).toBe(state)
    expect(result.logs).toHaveLength(0)
  })
})

describe('assigning Points to an employee', () => {
  it('replaces the list and audits the change by name', () => {
    const target = state.points.slice(0, 2)
    const employee = state.employees[0]

    const result = applyWrite(state, { kind: 'employee.setPoints', empId: employee.empId, pointIds: target.map((p) => p.pointId) }, ctx)

    expect(result.state.employees.find((e) => e.empId === employee.empId)!.pointIds).toEqual(target.map((p) => p.pointId))
    expect(result.logs[0].newValue).toContain(target[0].name)
  })

  it('does nothing for somebody who is not there', () => {
    const result = applyWrite(state, { kind: 'employee.setPoints', empId: 999999, pointIds: [] }, ctx)
    expect(result.state).toBe(state)
  })
})

describe('the suggested Point prefers one they are assigned to', () => {
  it('suggests one of their own Points when they have any', () => {
    const suggestions = usualPoints(state)
    for (const employee of state.employees) {
      if (employee.pointIds.length === 0) continue
      expect(employee.pointIds, `${employee.empId}`).toContain(suggestions.get(employee.empId))
    }
  })
})
