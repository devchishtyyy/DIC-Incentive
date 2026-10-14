/**
 * Master data: the Points worked on the floor, the grade bands, and the login accounts.
 *
 * There is no employee roster here. People come from the SAP directory (see
 * `sapImport.ts`), or from the optional demo roster in `demoRoster.ts`. The login accounts
 * below stay invented — SAP users are not mapped onto app roles.
 */

import type { Employee, Point, User } from '../domain/types'
import { PLANT_POINTS, pointIdFor } from './plantMasters'

export const USERS: User[] = [
  { userId: 'U-OE1', name: 'Nadia Hussain', role: 'OFFICE_EXEC' },
  { userId: 'U-OE2', name: 'Imran Qureshi', role: 'OFFICE_EXEC' },
  { userId: 'U-HOD', name: 'Arif Mahmood', role: 'HOD' },
  { userId: 'U-OPS', name: 'Rizwan Akhtar', role: 'OPS_MANAGER' },
  { userId: 'U-FIN', name: 'Faisal Baig', role: 'FINANCE' },
  { userId: 'U-EHS', name: 'Hira Zaman', role: 'EHS_REP' },
  { userId: 'U-MD', name: 'Tariq Jameel', role: 'MD_CEO' },
  { userId: 'U-ADM', name: 'Sana Mirza', role: 'ADMIN' },
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
