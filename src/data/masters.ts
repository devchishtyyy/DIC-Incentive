/**
 * Master data: the Points worked on the floor, the grade bands, and the login accounts.
 *
 * There is no employee roster here. People come from the SAP directory (see
 * `sapImport.ts`), or from the optional demo roster in `demoRoster.ts`. The login accounts
 * below stay invented — SAP users are not mapped onto app roles.
 */

import type { Department, Employee, Point, User } from '../domain/types'
import { PLANT_POINTS, pointIdFor } from './plantMasters'

/**
 * The people who use the app, as DIC named them, with the SuccessFactors username each
 * signs in with. Names came from the tenant; the jobs came from DIC.
 *
 * Muhammad Waqar holds two: he sets the Daily Targets *and* sits on review and approval.
 * That is why `roles` is a list — and it is worth knowing, because it means the targets a
 * month is scored against can be approved by the person who set them.
 */
export const USERS: User[] = [
  { userId: 'U-40009525', name: 'Ambreen Nazir', sapUsername: '40009525', roles: ['DATA_ENTRY'] },
  { userId: 'U-40007649', name: 'Rehmat Ali Khan', sapUsername: '40007649', roles: ['DATA_ENTRY'] },
  { userId: 'U-40009560', name: 'Muhammad Waqar', sapUsername: '40009560', roles: ['TARGET_SET', 'REVIEW_APPROVE'] },
  { userId: 'U-40009569', name: 'Muhammad Fozan Shoaib', sapUsername: '40009569', roles: ['TARGET_SET'] },
  { userId: 'U-40006991', name: 'Muhammad Salman Bari', sapUsername: '40006991', roles: ['REVIEW_APPROVE'] },
  { userId: 'U-40009559', name: 'Muhammad Hassaan Shoukat', sapUsername: '40009559', roles: ['VIEWER'] },
  { userId: 'U-10009671', name: 'Super Admin', sapUsername: '10009671', roles: ['SUPER_ADMIN'] },
]

/**
 * The Points worked on the floor, built from the live assignment list in plantMasters.ts.
 *
 * Targets start as a placeholder of 1 and `defaultTargetSet: false` — the real Daily
 * Targets were not supplied, and a made-up target produces a meaningless score. The
 * Targets screen flags every Point still on the placeholder.
 */
export const POINTS: Point[] = PLANT_POINTS.map((name) => ({
  pointId: pointIdFor(name),
  name,
  defaultTarget: 1,
  defaultTargetSet: false,
  active: true,
}))

/**
 * The old Excel spellings, mapped onto one canonical point. A later import reads this so
 * "manual", "Manual" and "MANUAL" all land on the same Point. Keys are lower-cased and
 * whitespace-collapsed before lookup.
 */
export const POINT_ALIASES: Record<string, string> = {
  manual: 'PT-MANUAL',
  dispersion: 'PT-DISPERSION',
  disperssion: 'PT-DISPERSION',
  grinding: 'PT-GRINDING',
  'grinding + loading': 'PT-GRINDING-LOADING',
  'grinding+loading': 'PT-GRINDING-LOADING',
  'grinding & loading': 'PT-GRINDING-LOADING',
  'dispersion + grinding': 'PT-DISPERSION-GRINDING',
  filtration: 'PT-FILTRATION',
  filteration: 'PT-FILTRATION',
  p48: 'PT-P48',
  'p48 / dispensor': 'PT-P48',
  'p48 / dispenser': 'PT-P48',
  'p 48': 'PT-P48',
  piccolo: 'PT-PICCOLO',
  picolo: 'PT-PICCOLO',
  'varnish plant': 'PT-VARNISH-PLANT',
  'varnish plent': 'PT-VARNISH-PLANT',
  weighing: 'PT-WEIGHING',
  weighting: 'PT-WEIGHING',
  'weighing / mixing': 'PT-WEIGHING-MIXING',
  'weighing/mixing': 'PT-WEIGHING-MIXING',
  'pessa + mixing': 'PT-PESSA-MIXING',
  'uv sampling': 'PT-UV-SAMPLING',
  'uv filling': 'PT-UV-FILLING',
  'uv dead stock charging': 'PT-UV-DEAD-STOCK',
  'filling / grinding': 'PT-FILLING-GRINDING',
  'filling/grinding': 'PT-FILLING-GRINDING',
}

/** Grade bands from the policy. Band 1 → 3 drive the Phase 3 base incentive table. */
export const GRADES = [
  { grade: 'Grade A', band: 1 },
  { grade: 'Grade B', band: 1 },
  { grade: 'Grade C', band: 2 },
  { grade: 'P1', band: 2 },
  { grade: 'P2', band: 3 },
  { grade: 'P3', band: 3 },
  { grade: 'Grade 1', band: 1 },
  { grade: 'Grade 2', band: 2 },
  { grade: 'Grade 3', band: 3 },
  { grade: 'JE-1', band: 3 },
  { grade: 'TE', band: 1 },
  { grade: 'TE2', band: 2 },
  { grade: 'TE3', band: 2 },
  { grade: 'TE4', band: 3 },
] as const

export function bandForGrade(grade: string): number {
  return GRADES.find((g) => g.grade === grade)?.band ?? 1
}

/** Employees who appear on the Daily Entry screen — Operators and Supervisors only. */
export const ENTRY_ELIGIBLE_ROLES: Employee['role'][] = ['Operator', 'Supervisor']

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

/**
 * The departments on the incentive list.
 *
 * Production is the one the app was built for and the only one that computes a score from
 * the seven KPIs. Maintenance and Support Production submit one total out of 100 per
 * employee instead — the brief is explicit that they do not use the KPI breakdown.
 *
 * `rateGroup` picks a column out of the 2025/2026 rate sheet. The sheet names "Production &
 * Maintenance" as the Production group, so Maintenance sits there despite submitting a
 * total. Support Production is not named on the sheet at all; it is seeded as Production
 * because it works the floor, and that reading is on the Settings open-questions list.
 */
export const DEPARTMENTS: Department[] = [
  { departmentId: 'DEP-PROD', name: 'Production', rateGroup: 'Production', scoringMode: 'computed', active: true },
  { departmentId: 'DEP-MAINT', name: 'Maintenance', rateGroup: 'Production', scoringMode: 'submittedTotal', active: true },
  { departmentId: 'DEP-SUPPROD', name: 'Support Production', rateGroup: 'Production', scoringMode: 'submittedTotal', active: true },
  { departmentId: 'DEP-TECH', name: 'Technical', rateGroup: 'Support', scoringMode: 'submittedTotal', active: true },
  { departmentId: 'DEP-STORES', name: 'Stores', rateGroup: 'Support', scoringMode: 'submittedTotal', active: true },
  { departmentId: 'DEP-DISPATCH', name: 'Dispatch', rateGroup: 'Support', scoringMode: 'submittedTotal', active: true },
  { departmentId: 'DEP-SAP', name: 'SAP', rateGroup: 'Support', scoringMode: 'submittedTotal', active: true },
]

/** Everyone DIC supplied works Production. */
export const DEFAULT_DEPARTMENT_ID = 'DEP-PROD'
