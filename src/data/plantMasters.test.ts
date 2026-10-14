/**
 * The real plant master data: the Points worked on the floor and who works them.
 *
 * Production Area is not in SuccessFactors, so it is derived from the Points an employee
 * works. That makes this assignment the thing that places someone under a HOD, which is
 * worth checking rather than assuming.
 */

import { describe, expect, it } from 'vitest'
import { POINTS } from './masters'
import { assignedPointIds, EMPLOYEE_POINTS, floorEmpIdFrom, PLANT_POINTS, pointIdFor } from './plantMasters'
import { buildBaseState, buildDemoState } from './seed'

describe('the Point master', () => {
  it('holds the 25 Points actually worked', () => {
    expect(PLANT_POINTS).toHaveLength(25)
    expect(POINTS).toHaveLength(25)
  })

  it('gives every Point a stable id derived from its name', () => {
    expect(pointIdFor('Grinding + Loading')).toBe('PT-GRINDING-LOADING')
    expect(pointIdFor('P48 / Dispenser')).toBe('PT-P48-DISPENSER')
    expect(pointIdFor('UV Sampling & Addition')).toBe('PT-UV-SAMPLING-ADDITION')
  })

  it('has no duplicate ids', () => {
    const ids = POINTS.map((point) => point.pointId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('flags every target as a placeholder, because none were supplied', () => {
    expect(POINTS.every((point) => point.defaultTargetSet === false)).toBe(true)
  })

})

describe('the Point assignment', () => {
  it('covers the 35 employees supplied', () => {
    expect(Object.keys(EMPLOYEE_POINTS)).toHaveLength(35)
  })

  it('only ever names a Point that exists', () => {
    const known = new Set(POINTS.map((point) => point.name))
    for (const [empId, names] of Object.entries(EMPLOYEE_POINTS)) {
      for (const name of names) expect(known.has(name), `${empId}: ${name}`).toBe(true)
    }
  })

  it('gives everyone at least one Point', () => {
    for (const [empId, names] of Object.entries(EMPLOYEE_POINTS)) {
      expect(names.length, empId).toBeGreaterThan(0)
    }
  })

  it('resolves an Emp ID to Point ids', () => {
    expect(assignedPointIds(1295)).toEqual([pointIdFor('Grinding + Loading'), pointIdFor('Grinding')])
    expect(assignedPointIds(9999)).toEqual([])
  })
})

describe('the SAP Emp ID relation', () => {
  // SuccessFactors numbers this plant 40000000-40009999; the floor uses the trailing
  // digits, and that is what the Employee KPI sheet holds.
  it('turns a SAP userId into the floor Emp ID', () => {
    expect(floorEmpIdFrom(40001295)).toBe(1295)
    expect(floorEmpIdFrom(40009360)).toBe(9360)
  })

  it('leaves a floor Emp ID alone', () => {
    expect(floorEmpIdFrom(1295)).toBe(1295)
  })

  it('leaves an id outside the range alone rather than mangling it', () => {
    expect(floorEmpIdFrom(50001295)).toBe(50001295)
  })

  it('resolves every supplied employee to their Points through that relation', () => {
    for (const empId of Object.keys(EMPLOYEE_POINTS).map(Number)) {
      expect(assignedPointIds(floorEmpIdFrom(40000000 + empId)), String(empId)).toEqual(assignedPointIds(empId))
    }
  })
})

describe('the app still starts from this master data', () => {
  it('ships with the Points and the 42 people DIC supplied, and no production history', () => {
    const base = buildBaseState()
    expect(base.points).toHaveLength(25)
    expect(base.employees).toHaveLength(42)
    expect(base.directory).toHaveLength(42)
    expect(base.entries).toHaveLength(0)
  })

  it('still builds a working demo on top of them', () => {
    const demo = buildDemoState()
    expect(demo.employees.length).toBeGreaterThan(30)
    expect(demo.entries.length).toBeGreaterThan(500)
    expect(demo.employees.every((employee) => employee.pointIds.length > 0)).toBe(true)
  })

  it('only ever posts an employee on a Point they are assigned to', () => {
    const demo = buildDemoState()
    const own = new Map(demo.employees.map((employee) => [employee.empId, new Set(employee.pointIds)]))

    for (const entry of demo.entries) {
      if (!entry.pointId) continue
      expect(own.get(entry.empId)?.has(entry.pointId), `${entry.empId} on ${entry.pointId}`).toBe(true)
    }
  })
})
