/**
 * Policy constants — DIC Pakistan Limited Production Incentive Policy (rev. 30 June 2026).
 *
 * Every number the policy fixes lives here, nowhere else. Screens, the calculation
 * module and the export all read from this file so a policy revision is a one-file change.
 * Values marked "editable in Settings" are overridable at runtime via AppSettings.
 */

/** Production / Output KPI weight — 20 of the 100 incentive marks (policy section 5). */
export const SCORE_CAP = 20

/**
 * Working days in an incentive period, and the attendance denominator.
 *
 * A *fixed* 26, not a count of the period's actual working days. The two agree in most
 * months and come apart in February, where 16 Feb to 15 Mar is only 28 days and yields 24
 * Mon–Sat days — see `periods.test.ts`. The fixed figure is the decision recorded in the
 * brief, and it is what the signed policy's "÷ 26" means.
 */
export const PRORATA_DIVISOR = 26

/**
 * The day an incentive period starts; it runs to the day before this in the next month.
 * A setting rather than a constant because DIC has used the 17th at least once.
 */
export const PERIOD_START_DAY = 16

/** Monthly marks must be submitted before the 20th, ahead of the salary run (policy section 10). */
export const REVIEW_DEADLINE_DAY = 20

/**
 * "Today" is pinned for the prototype so the seeded demo always tells the same story:
 * the Aug–Sep period's 20 Sep deadline has passed, and the 16 Sep–15 Oct period is open.
 */
export const DEMO_TODAY = '2026-10-01'

/** Soft-warning thresholds for likely typos (section 6 of the build brief). */
export const OUTLIER = {
  /** Warn when actual batches exceed this multiple of the day's target. */
  actualOverTargetMultiple: 3,
  /** Warn when the day's target drops below this fraction of the point's default target. */
  targetUnderDefaultFraction: 0.2,
  /** Warn when output falls below this fraction of target — usually a mistyped target. */
  underTargetTypoFraction: 0.1,
}

/** Monthly Scorecard colour scale (out of 20). */
export const SCORE_BANDS = {
  low: 12,
  high: 17,
}

/** Dashboard counts an entry as under-performing below this fraction of target. */
export const UNDER_TARGET_FRACTION = 0.7

/** Display precision. */
export const DECIMALS = {
  score: 2,
  percent: 1,
  batches: 2,
}

/** Reasons the HOD may give for changing a daily target (policy section 5 note). */
export const TARGET_CHANGE_REASONS = [
  'Order inflow',
  'Order volume',
  'Stock-taking day',
  'Machine downtime',
  'Other',
] as const
export type TargetChangeReason = (typeof TARGET_CHANGE_REASONS)[number]

/**
 * Open policy questions. The app applies `default` today; Settings exposes the alternative
 * so DIC can switch once the question is answered.
 */
export const ASSUMPTIONS = [
  {
    id: 'multiRowWeighting',
    question: 'When one employee has several rows in a day, how are they combined?',
    applied: 'Plain average — each row counts equally, as the Excel does.',
    alternative: 'Weight each row by its target, so bigger points count more.',
    source: 'Build brief section 6, open question 1',
  },
  {
    id: 'monthlyDivisor',
    question: 'What does the monthly score average over?',
    applied: 'Days that have at least one entry (days scored).',
    alternative: 'All 26 working days, treating a missing day as zero.',
    source: 'Build brief section 6, open question 2',
  },
  {
    id: 'rounding',
    question: 'Where is rounding applied?',
    applied: 'Display only — scores to 2 decimals. Totals use the unrounded value.',
    alternative: 'Round each daily score before averaging.',
    source: 'Build brief section 6, open question 3',
  },
] as const

/**
 * Base incentive amounts from the signed Incentive Revision 2025/2026 sheet
 * (increase effective 1 Jan 2025). Held for Phase 3 — NOT used in any Phase 1 calculation.
 * Next revision is due Dec 2026 – Jan 2027, so this stays a table, never a hard-coded number.
 */
export const BASE_INCENTIVE_RATES = {
  effectiveFrom: '2025-01-01',
  nextRevisionDue: '2026-12',
  note: 'Read from the scan — to be checked against the signed sheet before Phase 3.',
  /** Band 1 / 2 / 3 run from the lowest to the highest grade band. */
  rates: [
    { siteGroup: 'Non-Kasur', sites: ['Karachi', 'Inplant'], band1: 16800, band2: 18100, band3: 18750 },
    { siteGroup: 'Kasur', sites: ['Kasur'], band1: 22800, band2: 24100, band3: 24750 },
  ],
} as const

/** The other six KPIs, shown as greyed Phase 2 placeholders. Weights total 80. */
export const PHASE_2_KPIS = [
  { key: 'quality', label: 'Quality', weight: 15 },
  { key: 'ehs', label: 'EHS', weight: 15 },
  { key: 'wastage', label: 'Wastage', weight: 15 },
  { key: 'wcm5s', label: '5S and WCM', weight: 15 },
  { key: 'variance', label: 'Variance', weight: 10 },
  { key: 'attendance', label: 'Attendance', weight: 10 },
] as const

/** Runtime-editable mirror of the constants above (Settings and Assumptions screen). */
export interface AppSettings {
  scoreCap: number
  prorataDivisor: number
  reviewDeadlineDay: number
  outlierActualMultiple: number
  outlierTargetFraction: number
  underTargetTypoFraction: number
  underTargetFraction: number
  periodStartDay: number
  bandLow: number
  bandHigh: number
  multiRowWeighting: 'average' | 'targetWeighted'
  monthlyDivisor: 'daysScored' | 'workingDays'
}

export const DEFAULT_SETTINGS: AppSettings = {
  scoreCap: SCORE_CAP,
  prorataDivisor: PRORATA_DIVISOR,
  reviewDeadlineDay: REVIEW_DEADLINE_DAY,
  outlierActualMultiple: OUTLIER.actualOverTargetMultiple,
  outlierTargetFraction: OUTLIER.targetUnderDefaultFraction,
  underTargetTypoFraction: OUTLIER.underTargetTypoFraction,
  underTargetFraction: UNDER_TARGET_FRACTION,
  periodStartDay: PERIOD_START_DAY,
  bandLow: SCORE_BANDS.low,
  bandHigh: SCORE_BANDS.high,
  multiRowWeighting: 'average',
  monthlyDivisor: 'daysScored',
}
