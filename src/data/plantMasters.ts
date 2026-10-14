/**
 * The real plant master data: the Points worked on the floor, and which Points each
 * current employee is assigned to.
 *
 * Points are a flat list — there are no Production Areas. A Point is a work station, an
 * employee works some of them, and that is the whole structure.
 *
 * New employees are not covered here. The HOD or Office Executive picks their Points on
 * the Daily Entry screen, either from this list or by typing a new one.
 */

export const PLANT_POINTS: string[] = [
  'Dispersion',
  'Grinding',
  'Grinding + Loading',
  'Dispersion + Grinding',
  'Filtration',
  'Varnish Plant',
  'P48',
  'P48 / Dispenser',
  'Piccolo',
  'Pessa + Mixing',
  'Weighing',
  'Weighing / Mixing',
  'Mixing',
  'Manual',
  'Filling / Grinding',
  'UV Sampling',
  'UV Filling',
  'UV Weighing',
  'UV Base Weighing',
  'UV Dosing',
  'UV Dead Stock Charging',
  'UV Recover Dead Stock',
  'UV / Damp Off',
  'UV Sampling / Filling',
  'UV Sampling & Addition',
]

/** Stable id from the display name, so the two never drift apart. */
export function pointIdFor(name: string): string {
  return `PT-${name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`
}

/**
 * Emp ID → the Points that employee works, exactly as supplied.
 *
 * These are the Emp IDs used on the floor and in the Excel. SuccessFactors `userId` is an
 * 8-digit number, so the import matches on the trailing digits as well as the whole value
 * — see `matchEmpId` in sapImport.ts.
 */
export const EMPLOYEE_POINTS: Record<number, string[]> = {
  1295: ['Grinding + Loading', 'Grinding'],
  2901: ['Filling / Grinding'],
  2904: ['Grinding + Loading', 'Grinding'],
  2905: ['Grinding + Loading', 'Grinding'],
  4070: ['Filling / Grinding'],
  4071: ['Grinding + Loading', 'Grinding'],
  4143: ['Dispersion', 'Varnish Plant'],
  5827: ['Dispersion + Grinding'],
  5948: [
    'UV Weighing',
    'UV Sampling',
    'UV Dead Stock Charging',
    'UV Filling',
    'Filling / Grinding',
    'UV Dosing',
    'UV Base Weighing',
    'Weighing',
    'UV Recover Dead Stock',
  ],
  6251: ['P48'],
  6289: [
    'UV Sampling',
    'UV Filling',
    'UV Weighing',
    'Filling / Grinding',
    'UV Dead Stock Charging',
    'UV / Damp Off',
    'Weighing',
    'UV Sampling / Filling',
    'UV Sampling & Addition',
  ],
  6290: ['UV Filling'],
  6515: ['Dispersion', 'P48'],
  6516: ['P48', 'P48 / Dispenser'],
  6717: ['Varnish Plant'],
  6719: ['Varnish Plant'],
  6905: ['Grinding + Loading', 'Dispersion', 'Grinding'],
  7073: ['Weighing', 'Weighing / Mixing'],
  7092: ['Manual'],
  7257: ['Filling / Grinding'],
  7418: ['Manual'],
  7772: ['Varnish Plant'],
  7773: ['Weighing', 'Mixing', 'Weighing / Mixing', 'UV Base Weighing'],
  7865: ['Dispersion + Grinding', 'Piccolo'],
  7866: ['Dispersion'],
  7867: ['Dispersion', 'Filtration'],
  7868: ['Dispersion', 'Filtration'],
  8092: ['Pessa + Mixing'],
  8093: ['Piccolo', 'Dispersion + Grinding'],
  8096: ['Grinding + Loading', 'Dispersion', 'Grinding'],
  8100: ['Filling / Grinding'],
  8102: ['Dispersion', 'Grinding + Loading'],
  8114: ['UV Weighing', 'UV Filling', 'Filling / Grinding'],
  8717: ['Piccolo', 'Pessa + Mixing'],
  9360: ['P48', 'P48 / Dispenser'],
}

/** The Point ids for an Emp ID, or an empty list for somebody new. */
export function assignedPointIds(empId: number): string[] {
  return (EMPLOYEE_POINTS[empId] ?? []).map(pointIdFor)
}

/**
 * SuccessFactors `userId` → the Emp ID used on the floor and in the Excel.
 *
 * The tenant numbers this plant 40000000–40009999, and the floor uses the trailing digits:
 * SAP 40001295 is Emp ID 1295. That trailing value is what the Employee KPI sheet's
 * "Emp Code" column holds, so it is what the app stores as `empId`.
 */
export const SAP_EMP_ID_OFFSET = 40000000

export function floorEmpIdFrom(sapUserId: number): number {
  if (!Number.isFinite(sapUserId)) return sapUserId
  const offset = sapUserId - SAP_EMP_ID_OFFSET
  return offset > 0 && offset < 10000 ? offset : sapUserId
}

/**
 * The incentive list as DIC supplied it — 42 Emp IDs, SAP's 4000xxxx with the prefix off.
 *
 * These people exist; their names, pay grades and joining dates do not, because those only
 * come from SuccessFactors. So the app ships them as placeholders awaiting a sync, which
 * fills the detail in by Emp ID. Thirty-five have a Point assignment above; the other seven
 * need Points before they can be posted for.
 */
export const PLANT_ROSTER: number[] = [
  1295, 2901, 2902, 2903, 2904, 2905, 2961, 3054, 3983, 4070, 4071, 4143, 4198, 5827, 5948,
  6251, 6289, 6290, 6515, 6516, 6717, 6719, 6905, 7073, 7092, 7257, 7418, 7772, 7773, 7865,
  7866, 7867, 7868, 8092, 8093, 8096, 8100, 8102, 8114, 8717, 9360, 9535,
]

/**
 * True while this record is still waiting on SuccessFactors for its detail.
 *
 * An unsynced person has no name at all, rather than a stand-in like "Emp 1295". A made-up
 * name reads as a real one and just repeats the Emp ID column, which makes the Daily Entry
 * sheet look broken; an empty one is honest, and the screens say where the name comes from.
 */
export function awaitingSapDetail(person: { name: string }): boolean {
  return person.name.trim() === ''
}
