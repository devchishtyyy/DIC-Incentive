/**
 * The permission matrix from section 3 of the build brief, expressed once.
 *
 * Every screen and every button calls `can(...)`. Role checks are never written inline
 * in a component, so changing the matrix changes the whole app.
 *
 * A denied decision always carries a `reason`, which the UI shows as the tooltip on the
 * disabled control.
 */

import type { EntryStatus, PeriodStatus, RoleId } from './types'
import { ROLE_SHORT } from './types'

/** E = edit, A = approve or sign off, V = view only, none = no access. */
export type Grant = 'E' | 'A' | 'V' | 'none'

export type Capability =
  | 'entry.edit'
  | 'target.edit'
  | 'override.fullMarks'
  | 'entry.view'
  | 'scorecard.view'
  | 'month.submit'
  | 'month.hodSign'
  | 'month.opsApprove'
  | 'month.reopen'
  | 'export'
  | 'masterdata.manage'
  | 'employee.approveAdd'
  | 'audit.view'

/** Rows of the published matrix, verbatim. HOD grants marked in HOD_OWN_AREA are area-scoped. */
export const PERMISSION_MATRIX: Record<Capability, Record<RoleId, Grant>> = {
  'entry.edit': { OFFICE_EXEC: 'E', HOD: 'E', OPS_MANAGER: 'none', FINANCE: 'none', EHS_REP: 'none', MD_CEO: 'none', ADMIN: 'none' },
  'target.edit': { OFFICE_EXEC: 'none', HOD: 'E', OPS_MANAGER: 'none', FINANCE: 'none', EHS_REP: 'none', MD_CEO: 'none', ADMIN: 'E' },
  'override.fullMarks': { OFFICE_EXEC: 'none', HOD: 'E', OPS_MANAGER: 'none', FINANCE: 'none', EHS_REP: 'none', MD_CEO: 'A', ADMIN: 'none' },
  'entry.view': { OFFICE_EXEC: 'V', HOD: 'V', OPS_MANAGER: 'V', FINANCE: 'V', EHS_REP: 'V', MD_CEO: 'V', ADMIN: 'V' },
  'scorecard.view': { OFFICE_EXEC: 'V', HOD: 'V', OPS_MANAGER: 'V', FINANCE: 'V', EHS_REP: 'V', MD_CEO: 'V', ADMIN: 'V' },
  'month.submit': { OFFICE_EXEC: 'E', HOD: 'none', OPS_MANAGER: 'none', FINANCE: 'none', EHS_REP: 'none', MD_CEO: 'none', ADMIN: 'none' },
  'month.hodSign': { OFFICE_EXEC: 'none', HOD: 'A', OPS_MANAGER: 'none', FINANCE: 'none', EHS_REP: 'none', MD_CEO: 'none', ADMIN: 'none' },
  'month.opsApprove': { OFFICE_EXEC: 'none', HOD: 'none', OPS_MANAGER: 'A', FINANCE: 'none', EHS_REP: 'none', MD_CEO: 'none', ADMIN: 'none' },
  'month.reopen': { OFFICE_EXEC: 'none', HOD: 'none', OPS_MANAGER: 'A', FINANCE: 'none', EHS_REP: 'none', MD_CEO: 'A', ADMIN: 'none' },
  export: { OFFICE_EXEC: 'V', HOD: 'V', OPS_MANAGER: 'V', FINANCE: 'E', EHS_REP: 'none', MD_CEO: 'V', ADMIN: 'V' },
  'masterdata.manage': { OFFICE_EXEC: 'none', HOD: 'none', OPS_MANAGER: 'none', FINANCE: 'none', EHS_REP: 'none', MD_CEO: 'none', ADMIN: 'E' },
  'employee.approveAdd': { OFFICE_EXEC: 'none', HOD: 'none', OPS_MANAGER: 'none', FINANCE: 'none', EHS_REP: 'none', MD_CEO: 'A', ADMIN: 'none' },
  'audit.view': { OFFICE_EXEC: 'none', HOD: 'V', OPS_MANAGER: 'V', FINANCE: 'V', EHS_REP: 'none', MD_CEO: 'V', ADMIN: 'V' },
}

export type Action =
  | 'entry.view'
  | 'entry.edit'
  | 'entry.delete'
  | 'entry.acknowledgeWarning'
  | 'day.submit'
  | 'target.editDated'
  | 'target.editDefault'
  | 'override.grant'
  | 'override.review'
  | 'scorecard.view'
  | 'month.submit'
  | 'month.hodSign'
  | 'month.opsApprove'
  | 'month.reopen'
  | 'export.view'
  | 'export.download'
  | 'masterdata.manage'
  | 'employee.approveAdd'
  | 'employee.setName'
  | 'periodMarks.edit'
  | 'periodMarks.view'
  | 'audit.view'
  | 'settings.view'
  | 'settings.edit'

export interface Resource {
  periodStatus?: PeriodStatus
  entryStatus?: EntryStatus
  /** Whether the HOD has already signed this period off. */
  alreadySigned?: boolean
  /** Whether the employee already has a name — see `employee.setName`. */
  hasName?: boolean
}

export interface Decision {
  allowed: boolean
  /** Always populated when denied — shown as the tooltip on the disabled control. */
  reason: string
}

const ALLOW: Decision = { allowed: true, reason: '' }
const deny = (reason: string): Decision => ({ allowed: false, reason })

function grantFor(role: RoleId, capability: Capability): Grant {
  return PERMISSION_MATRIX[capability][role]
}

/**
 * The one access check. Call it from every screen and every button.
 *
 * @example can('OFFICE_EXEC', 'target.editDated', { periodStatus: 'Open' })
 *          → { allowed: false, reason: 'Only the HOD may change a Daily Target…' }
 */
export function can(role: RoleId, action: Action, resource: Resource = {}): Decision {
  switch (action) {
    // --- Daily entries ----------------------------------------------------
    case 'entry.view':
      return grantFor(role, 'entry.view') === 'none' ? deny(`${ROLE_SHORT[role]} has no access to daily entries.`) : ALLOW

    case 'entry.edit':
    case 'entry.acknowledgeWarning':
    case 'day.submit': {
      const grant = grantFor(role, 'entry.edit')
      if (grant !== 'E') return deny(`Only the Office Executive and the HOD may enter Output Batches. ${ROLE_SHORT[role]} has view-only access.`)

      if (resource.entryStatus === 'Locked') return deny('This row is locked because the period has been approved.')

      switch (resource.periodStatus) {
        case 'Locked':
          return deny('The period is Locked. It must be reopened by the Operations Manager or MD, with a reason.')
        case 'HOD Signed':
          return deny('The period has been signed off by all HODs and is waiting for Operations Manager approval.')
        case 'Submitted':
          return role === 'HOD'
            ? ALLOW
            : deny('The month is Submitted. Only the HOD may change a row now, to fix an error.')
        default:
          return ALLOW
      }
    }

    case 'entry.delete': {
      const base = can(role, 'entry.edit', resource)
      if (!base.allowed) return base
      if (resource.entryStatus !== 'Draft') return deny('Only a Draft row can be deleted. A submitted row must be corrected, so the change is audited.')
      return ALLOW
    }

    // --- Targets ----------------------------------------------------------
    case 'target.editDated': {
      if (role === 'ADMIN') return deny('The Admin maintains default targets on the Master Data screen. Only the HOD may change the target for a date.')
      if (grantFor(role, 'target.edit') !== 'E') return deny('Only the HOD may change a Daily Target, and only with a reason (policy section 5).')
      if (resource.periodStatus === 'Locked') return deny('The period is Locked. Reopen it before changing a target.')
      if (resource.periodStatus === 'HOD Signed') return deny('The period is signed off and waiting for Operations Manager approval.')
      return ALLOW
    }

    case 'target.editDefault':
      return role === 'ADMIN' || role === 'HOD' ? ALLOW : deny('Default targets are maintained by the Admin or the HOD.')

    // --- Full-marks override (policy section 10) ---------------------------
    case 'override.grant': {
      if (grantFor(role, 'override.fullMarks') !== 'E') return deny('Only the HOD may award full marks for extraordinary performance (policy section 10).')
      if (resource.periodStatus === 'Locked') return deny('The period is Locked.')
      return ALLOW
    }

    case 'override.review': {
      if (grantFor(role, 'override.fullMarks') !== 'A') return deny('Extraordinary awards are reviewed by the MD and CEO.')
      return ALLOW
    }

    // --- Scorecard --------------------------------------------------------
    case 'scorecard.view':
      return grantFor(role, 'scorecard.view') === 'none'
        ? deny(`${ROLE_SHORT[role]} has no access to the monthly scorecard.`)
        : ALLOW

    // --- Month-end workflow ------------------------------------------------
    case 'month.submit': {
      if (grantFor(role, 'month.submit') !== 'E') return deny('The Office Executive compiles and submits the monthly sheet (policy section 4).')
      if (resource.periodStatus !== 'Open') return deny(`The month is already ${resource.periodStatus}. It can only be submitted while Open.`)
      return ALLOW
    }

    case 'month.hodSign': {
      if (grantFor(role, 'month.hodSign') !== 'A') return deny('The HOD signs off the monthly sheet (policy section 4).')
      if (resource.periodStatus !== 'Submitted') {
        return deny(
          resource.periodStatus === 'Open'
            ? 'The Office Executive has not submitted the month yet.'
            : `The month is ${resource.periodStatus}. There is nothing left for the HOD to sign.`,
        )
      }
      if (resource.alreadySigned) return deny('You have already signed this period off.')
      return ALLOW
    }

    case 'month.opsApprove': {
      if (grantFor(role, 'month.opsApprove') !== 'A') return deny('The Operations Manager reviews the total marking and approves it (policy section 4).')
      if (resource.periodStatus !== 'HOD Signed') {
        return deny(
          resource.periodStatus === 'Locked'
            ? 'The month is already approved and locked.'
            : 'The HOD must sign off before the Operations Manager can approve.',
        )
      }
      return ALLOW
    }

    case 'month.reopen': {
      if (grantFor(role, 'month.reopen') !== 'A') return deny('Only the Operations Manager or the MD may reopen a locked month, with a reason.')
      if (resource.periodStatus !== 'Locked') return deny('Only a Locked month can be reopened.')
      return ALLOW
    }

    // --- Export -----------------------------------------------------------
    case 'export.view':
      return grantFor(role, 'export') === 'none'
        ? deny(`${ROLE_SHORT[role]} has no access to the export.`)
        : ALLOW

    case 'export.download': {
      if (grantFor(role, 'export') !== 'E') {
        return deny(`The permission matrix gives Export (E) to Finance. ${ROLE_SHORT[role]} can view the preview but not download the file.`)
      }
      if (resource.periodStatus !== 'Locked') return deny('Only an approved and locked period can be exported to Finance.')
      return ALLOW
    }

    // --- Master data and admin --------------------------------------------
    case 'masterdata.manage':
      return grantFor(role, 'masterdata.manage') !== 'E'
        ? deny('Master data — employees, points, areas, users and the calendar — is maintained by the System Admin.')
        : ALLOW

    /*
     * Naming somebody SuccessFactors has not named.
     *
     * Two people on the supplied list do not come back from SAP at all, and a row that
     * reads "Name not synced yet" is no use to whoever is entering their output. So the
     * people who do the entering — the Office Executive and the HOD — may fill the gap.
     *
     * Filling a gap is not the same as renaming somebody, though: once a name exists it
     * belongs to the record, and only the Admin may change it. That keeps a typed name
     * from quietly overwriting what SAP said.
     */
    case 'employee.setName': {
      if (grantFor(role, 'masterdata.manage') === 'E') return ALLOW
      if (grantFor(role, 'entry.edit') !== 'E') return deny(`${ROLE_SHORT[role]} does not enter production data, so cannot name an employee.`)
      if (resource.hasName) return deny('This person already has a name. Only the System Admin can change an existing one.')
      return ALLOW
    }

    /*
     * The six KPIs that are not production: department marks, attendance, submitted totals.
     *
     * The Office Executive enters them, exactly as they enter daily output — the brief is
     * explicit about that. The HOD can too, since they already correct entries and sign the
     * month off. The Admin is deliberately out: they maintain master data, not marks.
     */
    case 'periodMarks.edit': {
      if (grantFor(role, 'entry.edit') !== 'E') return deny(`${ROLE_SHORT[role]} does not enter period marks.`)
      if (resource.periodStatus === 'Locked') return deny('The period is Locked. Reopen it before changing any marks.')
      if (resource.periodStatus === 'HOD Signed') return deny('The period is signed off and waiting for Operations Manager approval.')
      return ALLOW
    }

    case 'periodMarks.view':
      return grantFor(role, 'entry.view') === 'none' ? deny(`${ROLE_SHORT[role]} has no access to period marks.`) : ALLOW

    case 'employee.approveAdd':
      return grantFor(role, 'employee.approveAdd') !== 'A'
        ? deny('Adding an employee to the incentive list needs MD approval (policy section 10).')
        : ALLOW

    case 'audit.view':
      return grantFor(role, 'audit.view') === 'none' ? deny(`${ROLE_SHORT[role]} has no access to the audit log.`) : ALLOW

    case 'settings.view':
      return ALLOW

    case 'settings.edit':
      return role === 'ADMIN' ? ALLOW : deny('Settings are maintained by the System Admin. Every role can read them.')

    default:
      return deny('Unknown action.')
  }
}

/** Convenience for rendering: true when the role may at least see the screen. */
export function canSeeScreen(role: RoleId, screen: string): boolean {
  switch (screen) {
    case 'scorecard':
    case 'targets':
    case 'month-end':
    case 'settings':
    case 'guide':
      return true
    case 'daily-entry':
      return can(role, 'entry.view').allowed
    case 'export':
      return can(role, 'export.view').allowed
    case 'audit':
      return can(role, 'audit.view').allowed
    // People covers the SAP directory and the incentive list: the Admin proposes, the MD
    // approves, so both need the screen even though they see different tabs of it.
    case 'period-marks':
      return can(role, 'periodMarks.view').allowed
    case 'people':
      return can(role, 'masterdata.manage').allowed || can(role, 'employee.approveAdd').allowed
    default:
      return false
  }
}
