/**
 * The SAP directory and the route onto the incentive list.
 *
 * The directory is master data: everyone SuccessFactors knows about, held apart from the
 * people being scored. The Admin picks from it, which proposes them to the MD — nobody
 * reaches the incentive list without that approval (policy section 10). These tests pin
 * that separation, because collapsing it would quietly pay people nobody approved.
 */

import { describe, expect, it } from 'vitest'
import type { DirectoryEntry } from '../domain/types'
import { buildBaseState } from '../data/seed'
import { assignedPointIds, awaitingSapDetail, PLANT_ROSTER } from '../data/plantMasters'
import { employeesInRollup, employeesInScope } from './selectors'
import { applyWrite } from './writes'

// These tests are about the write ops, so they start from an empty list rather than the
// 42 people the app ships with — those get their own describe block at the bottom.
const base = { ...buildBaseState(), directory: [], employees: [] }
const admin = { actorUserId: 'U-ADM', now: '2026-10-08T09:00:00.000Z' }
const md = { actorUserId: 'U-MD', now: '2026-10-08T10:00:00.000Z' }

function entry(empId: number, name: string, extra: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    empId,
    sapUserId: 40000000 + empId,
    name,
    grade: 'Grade C',
    site: 'Kasur',
    joinDate: '2023-04-01',
    pointIds: assignedPointIds(empId),
    syncedAt: admin.now,
    ...extra,
  }
}

const THREE = [entry(1295, 'Ahmad Raza'), entry(6289, 'Bilal Khan'), entry(7092, 'Danish Iqbal')]
const synced = applyWrite(base, { kind: 'directory.sync', entries: THREE, source: 'Test sync' }, admin).state

// ---------------------------------------------------------------------------

describe('syncing the directory', () => {
  it('fills the directory and leaves the incentive list alone', () => {
    expect(synced.directory).toHaveLength(3)
    expect(synced.employees).toHaveLength(0)
  })

  it('audits the sync once, plus a row for each new arrival', () => {
    const result = applyWrite(base, { kind: 'directory.sync', entries: THREE, source: 'Test sync' }, admin)
    const summary = result.logs.filter((log) => log.entityId === 'directory')
    expect(summary).toHaveLength(1)
    expect(result.logs.filter((log) => log.field === 'Appeared in the SAP directory')).toHaveLength(3)
  })

  it('only announces people who were not there before', () => {
    const again = applyWrite(synced, { kind: 'directory.sync', entries: THREE, source: 'Weekly sync' }, admin)
    expect(again.logs.filter((log) => log.field === 'Appeared in the SAP directory')).toHaveLength(0)
    expect(again.message).not.toContain('new since')
  })

  it('reports the arrivals on the next sync', () => {
    const grown = applyWrite(synced, { kind: 'directory.sync', entries: [...THREE, entry(9360, 'Owais Bashir')], source: 'Weekly sync' }, admin)
    expect(grown.state.directory).toHaveLength(4)
    expect(grown.message).toContain('1 new since last time')
  })

  it('replaces rather than accumulates, so a leaver drops out of the directory', () => {
    const smaller = applyWrite(synced, { kind: 'directory.sync', entries: THREE.slice(0, 2), source: 'Weekly sync' }, admin)
    expect(smaller.state.directory).toHaveLength(2)
  })

  it('keeps somebody on the incentive list even after they leave the directory', () => {
    const added = applyWrite(synced, { kind: 'employee.addFromDirectory', empIds: [1295] }, admin).state
    const smaller = applyWrite(added, { kind: 'directory.sync', entries: THREE.slice(1), source: 'Weekly sync' }, admin)

    // Their scores and history must survive a change of HR filter.
    expect(smaller.state.directory.some((row) => row.empId === 1295)).toBe(false)
    expect(smaller.state.employees.some((row) => row.empId === 1295)).toBe(true)
  })

  it('does nothing at all for an empty sync', () => {
    const empty = applyWrite(synced, { kind: 'directory.sync', entries: [], source: 'Weekly sync' }, admin)
    expect(empty.state).toBe(synced)
    expect(empty.logs).toHaveLength(0)
  })
})

describe('the Admin picking people off the directory', () => {
  const picked = applyWrite(synced, { kind: 'employee.addFromDirectory', empIds: [1295, 6289] }, admin)

  it('creates them on the incentive list', () => {
    expect(picked.state.employees).toHaveLength(2)
    expect(picked.state.employees.map((employee) => employee.empId)).toEqual([1295, 6289])
  })

  it('carries the SAP details and the Point assignment across', () => {
    const ahmad = picked.state.employees.find((employee) => employee.empId === 1295)!
    expect(ahmad.name).toBe('Ahmad Raza')
    expect(ahmad.grade).toBe('Grade C')
    expect(ahmad.sapUserId).toBe(40001295)
    expect(ahmad.pointIds).toEqual(assignedPointIds(1295))
  })

  it('imports everyone as an Operator', () => {
    expect(picked.state.employees.every((employee) => employee.role === 'Operator')).toBe(true)
  })

  it('leaves them Pending MD approval — the Admin cannot put anyone on the list', () => {
    expect(picked.state.employees.every((employee) => employee.incentiveListStatus === 'Pending MD approval')).toBe(true)
    expect(picked.state.employees.every((employee) => employee.requestedBy === 'U-ADM')).toBe(true)
  })

  it('keeps them out of the monthly roll-up until the MD acts', () => {
    expect(employeesInScope(picked.state)).toHaveLength(2)
    expect(employeesInRollup(picked.state)).toHaveLength(0)
  })

  it('audits each one as a proposal, not an addition', () => {
    expect(picked.logs).toHaveLength(2)
    expect(picked.logs[0].field).toBe('Proposed for the incentive list')
    expect(picked.logs[0].reason).toContain('MD approval')
  })

  it('skips anyone already on the list rather than duplicating them', () => {
    const again = applyWrite(picked.state, { kind: 'employee.addFromDirectory', empIds: [1295, 7092] }, admin)
    expect(again.state.employees).toHaveLength(3)
    expect(again.state.employees.filter((employee) => employee.empId === 1295)).toHaveLength(1)
  })

  it('says so when there is nobody new in the selection', () => {
    const again = applyWrite(picked.state, { kind: 'employee.addFromDirectory', empIds: [1295] }, admin)
    expect(again.state).toBe(picked.state)
    expect(again.message).toContain('already on the list')
  })

  it('ignores an Emp ID that is not in the directory', () => {
    const bogus = applyWrite(synced, { kind: 'employee.addFromDirectory', empIds: [999999] }, admin)
    expect(bogus.state.employees).toHaveLength(0)
  })
})

describe('the MD is the only way onto the incentive list', () => {
  const proposed = applyWrite(synced, { kind: 'employee.addFromDirectory', empIds: [1295] }, admin).state

  it('puts them in the roll-up once approved', () => {
    const approved = applyWrite(proposed, { kind: 'employee.approveAdd', empIds: [1295], comment: 'Agreed' }, md)
    expect(approved.state.employees[0].incentiveListStatus).toBe('Approved')
    expect(employeesInRollup(approved.state)).toHaveLength(1)
  })

  it('records who approved them and when', () => {
    const approved = applyWrite(proposed, { kind: 'employee.approveAdd', empIds: [1295], comment: 'Agreed' }, md)
    expect(approved.state.employees[0].approvedBy).toBe('U-MD')
    expect(approved.state.employees[0].approvedAt).toBe(md.now)
  })

  it('audits the approval against the employee', () => {
    const approved = applyWrite(proposed, { kind: 'employee.approveAdd', empIds: [1295], comment: 'Agreed' }, md)
    const log = approved.logs[0]
    expect(log.oldValue).toBe('Pending MD approval')
    expect(log.newValue).toBe('Approved')
  })
})

// ---------------------------------------------------------------------------

describe('the 42 people DIC supplied', () => {
  const shipped = buildBaseState()

  it('are all on the incentive list', () => {
    expect(shipped.employees).toHaveLength(PLANT_ROSTER.length)
    expect(shipped.employees.map((employee) => employee.empId)).toEqual(PLANT_ROSTER)
  })

  it('wait for the MD like anyone else — a supplied list is not an approval', () => {
    expect(shipped.employees.every((employee) => employee.incentiveListStatus === 'Pending MD approval')).toBe(true)
    expect(employeesInRollup(shipped)).toHaveLength(0)
  })

  it('carry the Point assignments DIC gave, and nothing invented for the seven without one', () => {
    const withoutPoints = shipped.employees.filter((employee) => employee.pointIds.length === 0)
    expect(withoutPoints.map((employee) => employee.empId)).toEqual([2902, 2903, 2961, 3054, 3983, 4198, 9535])
    expect(shipped.employees.find((employee) => employee.empId === 1295)!.pointIds).toEqual(assignedPointIds(1295))
  })

  it('map onto their 8-digit SAP ids', () => {
    expect(shipped.employees.find((employee) => employee.empId === 1295)!.sapUserId).toBe(40001295)
  })

  it('have no name at all until a sync — a stand-in name would read as a real one', () => {
    expect(shipped.employees.every(awaitingSapDetail)).toBe(true)
    expect(shipped.employees.every((employee) => employee.name === '')).toBe(true)
  })

  it('get their real name, grade and joining date from the first sync', () => {
    const real = entry(1295, 'Ahmad Raza', { grade: 'Grade C', joinDate: '2019-02-11' })
    const after = applyWrite(shipped, { kind: 'directory.sync', entries: [real], source: 'Weekly sync' }, admin)
    const ahmad = after.state.employees.find((employee) => employee.empId === 1295)!

    expect(ahmad.name).toBe('Ahmad Raza')
    expect(ahmad.grade).toBe('Grade C')
    expect(ahmad.joinDate).toBe('2019-02-11')
    expect(after.message).toContain('1 on the incentive list filled in')
  })

  it('keeps the Points the app already holds — SAP does not know about Points', () => {
    const real = entry(1295, 'Ahmad Raza', { pointIds: [] })
    const after = applyWrite(shipped, { kind: 'directory.sync', entries: [real], source: 'Weekly sync' }, admin)
    expect(after.state.employees.find((employee) => employee.empId === 1295)!.pointIds).toEqual(assignedPointIds(1295))
  })

  it('never overwrites a name somebody edited by hand', () => {
    const named = applyWrite(
      shipped,
      { kind: 'employee.upsert', employee: { ...shipped.employees[0], name: 'Corrected By Hand' }, isNew: false },
      admin,
    ).state
    const after = applyWrite(named, { kind: 'directory.sync', entries: [entry(1295, 'Ahmad Raza')], source: 'Weekly sync' }, admin)
    expect(after.state.employees.find((employee) => employee.empId === 1295)!.name).toBe('Corrected By Hand')
  })
})

describe('approving the list in one go', () => {
  const shipped = buildBaseState()
  const all = applyWrite(shipped, { kind: 'employee.approveAdd', empIds: PLANT_ROSTER, comment: 'Approved by the MD' }, md)

  it('approves everyone waiting', () => {
    expect(all.state.employees.every((employee) => employee.incentiveListStatus === 'Approved')).toBe(true)
    expect(employeesInRollup(all.state)).toHaveLength(PLANT_ROSTER.length)
  })

  it('still audits one row per person — section 10 is about who, not how many', () => {
    expect(all.logs).toHaveLength(PLANT_ROSTER.length)
    expect(all.logs.every((log) => log.newValue === 'Approved')).toBe(true)
  })

  it('stamps the same approver and time on all of them', () => {
    expect(all.state.employees.every((employee) => employee.approvedBy === 'U-MD' && employee.approvedAt === md.now)).toBe(true)
  })

  it('approves only the selection, leaving the rest waiting', () => {
    const some = applyWrite(shipped, { kind: 'employee.approveAdd', empIds: [1295, 2901], comment: '' }, md)
    expect(some.state.employees.filter((employee) => employee.incentiveListStatus === 'Approved')).toHaveLength(2)
    expect(some.message).toContain('2 people')
  })

  it('does nothing, and says so, when nobody in the selection is waiting', () => {
    const again = applyWrite(all.state, { kind: 'employee.approveAdd', empIds: PLANT_ROSTER, comment: '' }, md)
    expect(again.state).toBe(all.state)
    expect(again.logs).toHaveLength(0)
    expect(again.message).toContain('Nothing waiting')
  })
})
