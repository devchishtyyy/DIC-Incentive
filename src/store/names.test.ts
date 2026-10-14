/**
 * What a screen shows where a name goes, and what typing a target in the grid does.
 *
 * DIC supplied Emp IDs, not names — names only exist in SuccessFactors. The rule these
 * tests pin is that the app never invents one: an unsynced person reads as unsynced, so
 * the Daily Entry sheet cannot end up showing the Emp ID twice and looking broken.
 */

import { describe, expect, it } from 'vitest'
import type { DailyEntry } from '../domain/types'
import { buildBaseState } from '../data/seed'
import { awaitingSapDetail, PLANT_ROSTER } from '../data/plantMasters'
import { can } from '../domain/permissions'
import { displayName } from './selectors'
import { applyWrite } from './writes'

const hod = { actorUserId: 'U-HOD', now: '2026-10-08T09:00:00.000Z' }

describe('the name a screen shows', () => {
  const shipped = buildBaseState()

  it('never repeats the Emp ID back as if it were a name', () => {
    for (const employee of shipped.employees) {
      expect(displayName(employee)).not.toContain(String(employee.empId))
    }
  })

  it('says the name has not been synced rather than showing an empty cell', () => {
    expect(displayName(shipped.employees[0])).toBe('Name not synced yet')
  })

  it('shows the real name once SAP has supplied it', () => {
    expect(displayName({ name: 'Ahmad Raza' })).toBe('Ahmad Raza')
  })

  it('treats a whitespace-only name as missing', () => {
    expect(displayName({ name: '   ' })).toBe('Name not synced yet')
    expect(awaitingSapDetail({ name: '   ' })).toBe(true)
  })

  it('names the Emp ID when the person is not on the incentive list at all', () => {
    expect(displayName(undefined, 4242)).toContain('4242')
    expect(displayName(undefined)).toBe('Unknown employee')
  })

  it('applies to all 42 shipped people, so no sheet shows a made-up name', () => {
    expect(shipped.employees).toHaveLength(PLANT_ROSTER.length)
    expect(shipped.employees.every((employee) => awaitingSapDetail(employee))).toBe(true)
  })
})

describe('a Daily Target typed into the grid', () => {
  const state = {
    ...buildBaseState(),
    entries: [
      {
        entryId: 'E-1',
        periodId: '2026-09',
        date: '2026-09-10',
        empId: 1295,
        pointId: 'P-01',
        target: 4,
        actualBatches: 3,
        scoreOverride: null,
        overrideReason: '',
        status: 'Draft' as const,
        acknowledgedWarnings: [],
        enteredBy: 'U-EXEC',
        enteredAt: hod.now,
        updatedBy: 'U-EXEC',
        updatedAt: hod.now,
      } satisfies DailyEntry,
    ],
  }

  it('changes the target and audits the before and after without being asked why', () => {
    const result = applyWrite(state, { kind: 'entry.setTarget', entryId: 'E-1', value: 9, reason: 'Changed on the daily sheet' }, hod)
    expect(result.state.entries[0].target).toBe(9)
    expect(result.logs).toHaveLength(1)
    expect(result.logs[0].oldValue).toBe('4')
    expect(result.logs[0].newValue).toBe('9')
  })

  it('writes nothing when the value has not actually moved', () => {
    const result = applyWrite(state, { kind: 'entry.setTarget', entryId: 'E-1', value: 4, reason: '' }, hod)
    expect(result.logs).toHaveLength(0)
    expect(result.state).toBe(state)
  })
})

describe('a default target typed into the Targets column', () => {
  const base = buildBaseState()
  const pointId = base.points[0].pointId

  it('clears the placeholder flag, so "not set" means what it says', () => {
    expect(base.points[0].defaultTargetSet).toBe(false)
    const result = applyWrite(base, { kind: 'target.setDefault', pointId, target: 12, reason: 'Default target set' }, hod)
    const point = result.state.points.find((p) => p.pointId === pointId)!
    expect(point.defaultTarget).toBe(12)
    expect(point.defaultTargetSet).toBe(true)
  })

  it('is audited like any other change to master data', () => {
    const result = applyWrite(base, { kind: 'target.setDefault', pointId, target: 12, reason: 'Default target set' }, hod)
    expect(result.logs.some((log) => log.newValue === '12')).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('typing a name for somebody SAP has no record of', () => {
  const base = buildBaseState()
  const exec = { actorUserId: 'U-EXEC', now: '2026-10-08T11:00:00.000Z' }

  it('names them', () => {
    const result = applyWrite(base, { kind: 'employee.setName', empId: 6290, name: 'Imran Shah' }, exec)
    expect(result.state.employees.find((e) => e.empId === 6290)!.name).toBe('Imran Shah')
    expect(awaitingSapDetail(result.state.employees.find((e) => e.empId === 6290)!)).toBe(false)
  })

  it('tidies the spacing rather than storing it as typed', () => {
    const result = applyWrite(base, { kind: 'employee.setName', empId: 6290, name: '  Imran   Shah  ' }, exec)
    expect(result.state.employees.find((e) => e.empId === 6290)!.name).toBe('Imran Shah')
  })

  it('audits it as typed in, not as something SAP said', () => {
    const result = applyWrite(base, { kind: 'employee.setName', empId: 6290, name: 'Imran Shah' }, exec)
    expect(result.logs).toHaveLength(1)
    expect(result.logs[0].reason).toContain('SuccessFactors has no record')
    expect(result.logs[0].newValue).toBe('Imran Shah')
  })

  it('says plainly when a later correction is a correction', () => {
    const named = applyWrite(base, { kind: 'employee.setName', empId: 6290, name: 'Imran Shah' }, exec).state
    const fixed = applyWrite(named, { kind: 'employee.setName', empId: 6290, name: 'Imran Shahid' }, exec)
    expect(fixed.logs[0].reason).toBe('Corrected by hand')
    expect(fixed.logs[0].oldValue).toBe('Imran Shah')
  })

  it('writes nothing when the name has not changed', () => {
    const named = applyWrite(base, { kind: 'employee.setName', empId: 6290, name: 'Imran Shah' }, exec).state
    const again = applyWrite(named, { kind: 'employee.setName', empId: 6290, name: 'Imran Shah' }, exec)
    expect(again.logs).toHaveLength(0)
    expect(again.state).toBe(named)
  })

  it('SURVIVES the weekly sync — SAP never overwrites what somebody typed', () => {
    const named = applyWrite(base, { kind: 'employee.setName', empId: 6290, name: 'Imran Shah' }, exec).state

    // The sync still does not know this person, and also brings a real name for 1295.
    const synced = applyWrite(
      named,
      {
        kind: 'directory.sync',
        entries: [
          { empId: 1295, sapUserId: 40001295, name: 'Muhammad Amin', grade: 'TE2', site: 'Kasur', joinDate: '1994-09-08', pointIds: [], syncedAt: exec.now },
        ],
        source: 'Weekly sync',
      },
      exec,
    )

    expect(synced.state.employees.find((e) => e.empId === 6290)!.name).toBe('Imran Shah')
    expect(synced.state.employees.find((e) => e.empId === 1295)!.name).toBe('Muhammad Amin')
  })

  it('is not overwritten even when SAP does later supply a name for them', () => {
    const named = applyWrite(base, { kind: 'employee.setName', empId: 6290, name: 'Imran Shah' }, exec).state
    const synced = applyWrite(
      named,
      {
        kind: 'directory.sync',
        entries: [{ empId: 6290, sapUserId: 40006290, name: 'IMRAN SHAH', grade: 'P3', site: 'Kasur', joinDate: '2015-01-01', pointIds: [], syncedAt: exec.now }],
        source: 'Weekly sync',
      },
      exec,
    )

    const person = synced.state.employees.find((e) => e.empId === 6290)!
    expect(person.name).toBe('Imran Shah')
    // The blanks around it still fill in — only the name is defended.
    expect(person.grade).toBe('P3')
    expect(person.joinDate).toBe('2015-01-01')
  })
})

describe('who may type a name', () => {
  it('lets the people who enter production data fill a gap', () => {
    expect(can('OFFICE_EXEC', 'employee.setName', { hasName: false }).allowed).toBe(true)
    expect(can('HOD', 'employee.setName', { hasName: false }).allowed).toBe(true)
    expect(can('ADMIN', 'employee.setName', { hasName: false }).allowed).toBe(true)
  })

  it('stops them renaming somebody who already has one — that is the Admin\'s call', () => {
    expect(can('OFFICE_EXEC', 'employee.setName', { hasName: true }).allowed).toBe(false)
    expect(can('HOD', 'employee.setName', { hasName: true }).allowed).toBe(false)
    expect(can('ADMIN', 'employee.setName', { hasName: true }).allowed).toBe(true)
  })

  it('keeps everyone who does not enter data out of it entirely', () => {
    for (const role of ['FINANCE', 'OPS_MANAGER', 'MD_CEO', 'EHS_REP'] as const) {
      expect(can(role, 'employee.setName', { hasName: false }).allowed, role).toBe(false)
    }
  })

  it('always explains why it said no', () => {
    expect(can('FINANCE', 'employee.setName', {}).reason).not.toBe('')
    expect(can('OFFICE_EXEC', 'employee.setName', { hasName: true }).reason).toContain('System Admin')
  })
})
