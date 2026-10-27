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
import { can, canAny } from '../domain/permissions'
import { displayName, userForSapUsername } from './selectors'
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

// ---------------------------------------------------------------------------

describe('linking a SAP sign-in to an app account', () => {
  const admin = { actorUserId: 'U-10009671', now: '2026-10-27T09:00:00.000Z' }
  const base = buildBaseState()

  it('ships with every account linked to the username DIC gave', () => {
    expect(base.users.every((user) => Boolean(user.sapUsername))).toBe(true)
    expect(userForSapUsername(base, '40009525@packagesli')?.name).toBe('Ambreen Nazir')
  })

  it('matches with or without the suffix, and whatever the case', () => {
    expect(userForSapUsername(base, '40009525')?.name).toBe('Ambreen Nazir')
    expect(userForSapUsername(base, '40009525@PACKAGESLI')?.name).toBe('Ambreen Nazir')
  })

  it('resolves the Super Admin', () => {
    expect(userForSapUsername(base, '10009671')?.roles).toEqual(['SUPER_ADMIN'])
  })

  it('reaches nobody for a username that is not linked', () => {
    expect(userForSapUsername(base, '99999999')).toBeNull()
  })

  it('strips a suffix somebody pasted in', () => {
    const linked = applyWrite(base, { kind: 'user.setSapUsername', userId: 'U-40009559', sapUsername: '40001111@packagesli' }, admin).state
    expect(linked.users.find((u) => u.userId === 'U-40009559')!.sapUsername).toBe('40001111')
  })

  it('REFUSES to link one sign-in to two accounts, which would make the role ambiguous', () => {
    const clash = applyWrite(base, { kind: 'user.setSapUsername', userId: 'U-40009559', sapUsername: '40009525' }, admin)
    expect(clash.state).toBe(base)
    expect(clash.message).toContain('already linked')
    expect(userForSapUsername(clash.state, '40009525')?.name).toBe('Ambreen Nazir')
  })

  it('audits the link, because it decides what somebody can do', () => {
    const result = applyWrite(base, { kind: 'user.setSapUsername', userId: 'U-40009559', sapUsername: '40001111' }, admin)
    expect(result.logs).toHaveLength(1)
    expect(result.logs[0].entity).toBe('User')
    expect(result.logs[0].newValue).toBe('40001111')
  })

  it('can be unlinked, and then that sign-in reaches nothing', () => {
    const unlinked = applyWrite(base, { kind: 'user.setSapUsername', userId: 'U-40009525', sapUsername: '' }, admin).state
    expect(userForSapUsername(unlinked, '40009525')).toBeNull()
  })

  it('never resolves an empty username to somebody', () => {
    expect(userForSapUsername(base, '')).toBeNull()
    expect(userForSapUsername(base, '   ')).toBeNull()
    expect(userForSapUsername(base, '@packagesli')).toBeNull()
  })
})

describe('the roles DIC named', () => {
  const base = buildBaseState()
  const roleOf = (sapUsername: string) => userForSapUsername(base, sapUsername)?.roles ?? []

  it('puts 40009525 and 40007649 on Data Entry', () => {
    expect(roleOf('40009525')).toEqual(['DATA_ENTRY'])
    expect(roleOf('40007649')).toEqual(['DATA_ENTRY'])
  })

  it('puts 40009569 on Target Setting', () => {
    expect(roleOf('40009569')).toEqual(['TARGET_SET'])
  })

  it('puts 40006991 on Review and Approval', () => {
    expect(roleOf('40006991')).toEqual(['REVIEW_APPROVE'])
  })

  it('gives 40009560 BOTH jobs, because DIC listed them under both', () => {
    expect(roleOf('40009560')).toEqual(['TARGET_SET', 'REVIEW_APPROVE'])
  })

  it('puts 40009559 on Viewer', () => {
    expect(roleOf('40009559')).toEqual(['VIEWER'])
  })

  it('lets somebody with two roles do the work of either', () => {
    const waqar = roleOf('40009560')
    expect(canAny(waqar, 'target.editDated', { periodStatus: 'Open' }).allowed).toBe(true)
    expect(canAny(waqar, 'month.hodSign', { periodStatus: 'Submitted' }).allowed).toBe(true)
  })

  it('keeps Data Entry out of targets and approval', () => {
    const entry = roleOf('40009525')
    expect(canAny(entry, 'entry.edit', { periodStatus: 'Open' }).allowed).toBe(true)
    expect(canAny(entry, 'target.editDated', { periodStatus: 'Open' }).allowed).toBe(false)
    expect(canAny(entry, 'month.opsApprove', { periodStatus: 'HOD Signed' }).allowed).toBe(false)
  })

  it('lets the Viewer download an approved export and change nothing', () => {
    const viewer = roleOf('40009559')
    expect(canAny(viewer, 'export.download', { periodStatus: 'Locked' }).allowed).toBe(true)
    expect(canAny(viewer, 'entry.edit', { periodStatus: 'Open' }).allowed).toBe(false)
    expect(canAny(viewer, 'month.opsApprove', { periodStatus: 'HOD Signed' }).allowed).toBe(false)
  })

  it('gives the Super Admin everything, at the point in the month each thing is allowed', () => {
    const superAdmin = roleOf('10009671')
    for (const action of ['entry.edit', 'target.editDated', 'masterdata.manage', 'rates.edit', 'month.submit'] as const) {
      expect(canAny(superAdmin, action, { periodStatus: 'Open' }).allowed, action).toBe(true)
    }
    expect(canAny(superAdmin, 'month.hodSign', { periodStatus: 'Submitted' }).allowed).toBe(true)
    expect(canAny(superAdmin, 'month.opsApprove', { periodStatus: 'HOD Signed' }).allowed).toBe(true)
    expect(canAny(superAdmin, 'month.reopen', { periodStatus: 'Locked' }).allowed).toBe(true)
  })

  it('says something useful when an account has no role at all', () => {
    expect(canAny([], 'entry.edit').reason).toContain('no role')
  })
})
