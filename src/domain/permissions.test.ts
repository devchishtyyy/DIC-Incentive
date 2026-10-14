import { describe, expect, it } from 'vitest'
import { can } from './permissions'

describe('acceptance test 7 — Office Executive tries to edit a target', () => {
  it('is denied, with a reason for the tooltip', () => {
    const decision = can('OFFICE_EXEC', 'target.editDated', { periodStatus: 'Open', })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/Only the HOD/)
  })

  it('still lets the Office Executive enter actual batches', () => {
    expect(can('OFFICE_EXEC', 'entry.edit', { periodStatus: 'Open', }).allowed).toBe(true)
  })
})

describe('the HOD is no longer scoped to an area', () => {
  // Production Areas were removed: there is one HOD, one sign-off, one roster.
  it('can edit any entry while the month is open', () => {
    expect(can('HOD', 'entry.edit', { periodStatus: 'Open' }).allowed).toBe(true)
  })

  it('can view every entry', () => {
    expect(can('HOD', 'entry.view').allowed).toBe(true)
  })

  it('can change any target', () => {
    expect(can('HOD', 'target.editDated', { periodStatus: 'Open' }).allowed).toBe(true)
  })

  it('signs the month once, not once per area', () => {
    expect(can('HOD', 'month.hodSign', { periodStatus: 'Submitted' }).allowed).toBe(true)
    expect(can('HOD', 'month.hodSign', { periodStatus: 'Submitted', alreadySigned: true }).allowed).toBe(false)
  })

  it('leaves the other roles unchanged', () => {
    expect(can('OPS_MANAGER', 'entry.view').allowed).toBe(true)
    expect(can('FINANCE', 'entry.view').allowed).toBe(true)
  })
})

describe('acceptance test 9 — Ops Manager approves before the HODs have signed', () => {
  it('is denied with the reason shown', () => {
    const decision = can('OPS_MANAGER', 'month.opsApprove', { periodStatus: 'Submitted' })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/must sign off before/)
  })

  it('is allowed once the period reaches HOD Signed', () => {
    expect(can('OPS_MANAGER', 'month.opsApprove', { periodStatus: 'HOD Signed' }).allowed).toBe(true)
  })
})

describe('acceptance test 10 — a locked month', () => {
  it('blocks every edit', () => {
    for (const role of ['OFFICE_EXEC', 'HOD'] as const) {
      const decision = can(role, 'entry.edit', { periodStatus: 'Locked' })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toMatch(/Locked/)
    }
  })

  it('lets only the Ops Manager or the MD reopen it, and nobody else', () => {
    expect(can('OPS_MANAGER', 'month.reopen', { periodStatus: 'Locked' }).allowed).toBe(true)
    expect(can('MD_CEO', 'month.reopen', { periodStatus: 'Locked' }).allowed).toBe(true)
    expect(can('OFFICE_EXEC', 'month.reopen', { periodStatus: 'Locked' }).allowed).toBe(false)
    expect(can('HOD', 'month.reopen', { periodStatus: 'Locked' }).allowed).toBe(false)
    expect(can('ADMIN', 'month.reopen', { periodStatus: 'Locked' }).allowed).toBe(false)
  })

  it('will not reopen a month that is not locked', () => {
    expect(can('OPS_MANAGER', 'month.reopen', { periodStatus: 'Open' }).allowed).toBe(false)
  })
})

describe('the month-end sequence cannot be skipped', () => {
  it('only the Office Executive submits, and only while the month is Open', () => {
    expect(can('OFFICE_EXEC', 'month.submit', { periodStatus: 'Open' }).allowed).toBe(true)
    expect(can('OFFICE_EXEC', 'month.submit', { periodStatus: 'Submitted' }).allowed).toBe(false)
    expect(can('HOD', 'month.submit', { periodStatus: 'Open' }).allowed).toBe(false)
  })

  it('a HOD cannot sign before the month is submitted', () => {
    expect(
      can('HOD', 'month.hodSign', { periodStatus: 'Open' }).allowed,
    ).toBe(false)
  })

  it('a HOD cannot sign the same area twice', () => {
    expect(
      can('HOD', 'month.hodSign', {
        periodStatus: 'Submitted',
        alreadySigned: true,
      }).allowed,
    ).toBe(false)
  })

  it('lets the HOD fix a row while the month is Submitted, but not the Office Executive', () => {
    const resource = { periodStatus: 'Submitted' as const }
    expect(can('HOD', 'entry.edit', resource).allowed).toBe(true)
    expect(can('OFFICE_EXEC', 'entry.edit', resource).allowed).toBe(false)
  })
})

describe('export', () => {
  it('is downloadable by Finance only, and only for an approved period', () => {
    expect(can('FINANCE', 'export.download', { periodStatus: 'Locked' }).allowed).toBe(true)
    expect(can('FINANCE', 'export.download', { periodStatus: 'Submitted' }).allowed).toBe(false)
    expect(can('OPS_MANAGER', 'export.download', { periodStatus: 'Locked' }).allowed).toBe(false)
  })

  it('is not visible at all to the EHS Representative', () => {
    expect(can('EHS_REP', 'export.view').allowed).toBe(false)
  })
})

describe('row deletion', () => {
  it('is allowed only on a Draft row', () => {
    const open = { periodStatus: 'Open' as const }
    expect(can('OFFICE_EXEC', 'entry.delete', { ...open, entryStatus: 'Draft' }).allowed).toBe(true)
    expect(can('OFFICE_EXEC', 'entry.delete', { ...open, entryStatus: 'Submitted' }).allowed).toBe(false)
  })
})

describe('master data, audit and settings', () => {
  it('reserves master data for the Admin', () => {
    expect(can('ADMIN', 'masterdata.manage').allowed).toBe(true)
    expect(can('OPS_MANAGER', 'masterdata.manage').allowed).toBe(false)
  })

  it('reserves approving a new employee for the MD', () => {
    expect(can('MD_CEO', 'employee.approveAdd').allowed).toBe(true)
    expect(can('ADMIN', 'employee.approveAdd').allowed).toBe(false)
  })

  it('keeps the audit log away from the Office Executive and the EHS Rep', () => {
    expect(can('OFFICE_EXEC', 'audit.view').allowed).toBe(false)
    expect(can('EHS_REP', 'audit.view').allowed).toBe(false)
    expect(can('FINANCE', 'audit.view').allowed).toBe(true)
  })

  it('lets everyone read settings but only the Admin change them', () => {
    expect(can('FINANCE', 'settings.view').allowed).toBe(true)
    expect(can('FINANCE', 'settings.edit').allowed).toBe(false)
    expect(can('ADMIN', 'settings.edit').allowed).toBe(true)
  })
})

describe('every denial explains itself', () => {
  it('never returns an empty reason when it says no', () => {
    const probes = [
      can('EHS_REP', 'entry.edit', { periodStatus: 'Open' }),
      can('FINANCE', 'month.submit', { periodStatus: 'Open' }),
      can('MD_CEO', 'target.editDated', { periodStatus: 'Open' }),
      can('EHS_REP', 'audit.view'),
    ]
    for (const decision of probes) {
      expect(decision.allowed).toBe(false)
      expect(decision.reason.length).toBeGreaterThan(10)
    }
  })
})
