/**
 * The rate table, grade bands and rupees.
 *
 * The centrepiece is the brief's worked example, checked to the rupee. Around it are the
 * ten pay-grade strings SuccessFactors actually returns for the forty-two people on the
 * list — the ones that would have silently mis-banded nine of them if the matching had
 * read the display code instead of the GRD token.
 */

import { describe, expect, it } from 'vitest'
import { attendanceMarks, toHundredths, totalScore, varianceMarks, wasteMarks, type KpiMarks } from './calc'
import {
  approvedFor,
  bandForGrade,
  DEFAULT_GRADE_ALIASES,
  earnedFor,
  gradeCodeCandidates,
  periodPayout,
  RATE_TABLE_2025,
  roundRupees,
  siteGroupFor,
} from './rates'

describe('the rate table matches the signed sheet', () => {
  const rate = (siteGroup: string, rateGroup: string) =>
    RATE_TABLE_2025.rows.find((row) => row.siteGroup === siteGroup && row.rateGroup === rateGroup)!

  it('Kasur Production', () => {
    expect([rate('Kasur', 'Production').B1, rate('Kasur', 'Production').B2, rate('Kasur', 'Production').B3]).toEqual([22800, 24100, 24750])
  })

  it('Kasur Support', () => {
    expect([rate('Kasur', 'Support').B1, rate('Kasur', 'Support').B2, rate('Kasur', 'Support').B3]).toEqual([21200, 22500, 23800])
  })

  it('Non-Kasur Production', () => {
    expect([rate('Non-Kasur', 'Production').B1, rate('Non-Kasur', 'Production').B2, rate('Non-Kasur', 'Production').B3]).toEqual([16800, 18100, 18750])
  })

  it('Non-Kasur Support', () => {
    expect([rate('Non-Kasur', 'Support').B1, rate('Non-Kasur', 'Support').B2, rate('Non-Kasur', 'Support').B3]).toEqual([15200, 16500, 17800])
  })

  it('pays more at Kasur, and more for Production, in every band', () => {
    for (const band of ['B1', 'B2', 'B3'] as const) {
      expect(rate('Kasur', 'Production')[band]).toBeGreaterThan(rate('Non-Kasur', 'Production')[band])
      expect(rate('Kasur', 'Production')[band]).toBeGreaterThan(rate('Kasur', 'Support')[band])
    }
  })
})

describe('site groups', () => {
  it('splits Kasur from everywhere else', () => {
    expect(siteGroupFor('Kasur')).toBe('Kasur')
    expect(siteGroupFor('Karachi')).toBe('Non-Kasur')
    expect(siteGroupFor('Inplant')).toBe('Non-Kasur')
  })
})

describe('grade bands from the aliases on the signed sheet', () => {
  it.each([
    ['TE', 'B3'],
    ['TE1', 'B3'],
    ['TE2', 'B3'],
    ['TE3', 'B3'],
    ['TE4', 'B3'],
    ['JE', 'B3'],
    ['JE-I', 'B3'],
    ['P', 'B2'],
    ['PI', 'B2'],
    ['PII', 'B2'],
    ['PIII', 'B2'],
    ['III', 'B2'],
    ['IV', 'B2'],
    ['V', 'B2'],
    ['A', 'B1'],
    ['I', 'B1'],
    ['II', 'B1'],
  ])('%s is %s', (code, band) => {
    expect(bandForGrade(code)).toBe(band)
  })

  it('is case- and spacing-insensitive', () => {
    expect(bandForGrade('  te2  ')).toBe('B3')
    expect(bandForGrade('Grade A')).toBe('B1')
  })
})

describe('the grade strings SuccessFactors really returns', () => {
  /** Every distinct payGrade across the 42 people, from a live sync on 8 Oct 2026. */
  const REAL: Array<[string, string]> = [
    ['Hourly Worker Level (P) (GRD.P)', 'B2'],
    ['Hourly Worker Level (P3) (GRD.PIII)', 'B2'],
    ['Hourly Worker Level (P2) (GRD.PII)', 'B2'],
    ['Jr. Technical Executive Lvl(TE) (GRD.TE)', 'B3'],
    ['Technical Executive Level (TE3) (GRD.TE.3)', 'B3'],
    ['Jr. Technical Executive Lvl(TE1) (GRD.TE.1)', 'B3'],
    ['Technical Executive Level (TE2) (GRD.TE.2)', 'B3'],
    ['Technical Executive Level (TE4) (GRD.TE.4)', 'B3'],
    ['Worker Level (2) (GRD.II)', 'B1'],
    ['Worker Level (5) (GRD.V)', 'B2'],
  ]

  it.each(REAL)('%s → %s', (grade, band) => {
    expect(bandForGrade(grade)).toBe(band)
  })

  it('resolves every real grade — none falls through to null', () => {
    expect(REAL.filter(([grade]) => bandForGrade(grade) === null)).toEqual([])
  })

  it('reads the GRD token in preference to the display code, which disagrees with it', () => {
    // The trap: (P3) is arabic and not on the signed sheet; GRD.PIII is roman and is.
    expect(gradeCodeCandidates('Hourly Worker Level (P3) (GRD.PIII)')[0]).toBe('PIII')
    expect(bandForGrade('Hourly Worker Level (P3) (GRD.PIII)')).toBe('B2')
  })

  it('strips the dots out of a GRD token', () => {
    expect(gradeCodeCandidates('Technical Executive Level (TE2) (GRD.TE.2)')[0]).toBe('TE2')
  })
})

describe('a grade nobody anticipated', () => {
  it('gives null rather than guessing a band', () => {
    expect(bandForGrade('Director of Everything')).toBeNull()
    expect(bandForGrade('')).toBeNull()
    expect(bandForGrade('   ')).toBeNull()
  })

  it('stops the money calculation and says what to do', () => {
    const result = approvedFor({ grade: 'Chief Mystery Officer', site: 'Kasur' }, 'Production', RATE_TABLE_2025)
    expect(result.approved).toBeNull()
    expect(result.band).toBeNull()
    expect(result.reason).toContain('grade alias table')
  })

  it('says something different when the grade is simply not synced yet', () => {
    const result = approvedFor({ grade: '', site: 'Kasur' }, 'Production', RATE_TABLE_2025)
    expect(result.approved).toBeNull()
    expect(result.reason).toContain('SAP sync')
  })

  it('is fixed by adding an alias, without touching code', () => {
    const extended = { ...DEFAULT_GRADE_ALIASES, 'TE5': 'B3' as const }
    expect(bandForGrade('Technical Executive Level (TE5) (GRD.TE.5)', extended)).toBe('B3')
  })
})

describe('the approved amount', () => {
  it('picks the Kasur Production B3 rate for a TE2 on the floor', () => {
    const result = approvedFor({ grade: 'Technical Executive Level (TE2) (GRD.TE.2)', site: 'Kasur' }, 'Production', RATE_TABLE_2025)
    expect(result.band).toBe('B3')
    expect(result.approved).toBe(24750)
  })

  it('pays the same person less in a Support department', () => {
    const result = approvedFor({ grade: 'Technical Executive Level (TE2) (GRD.TE.2)', site: 'Kasur' }, 'Support', RATE_TABLE_2025)
    expect(result.approved).toBe(23800)
  })

  it('pays the same person less away from Kasur', () => {
    const result = approvedFor({ grade: 'Technical Executive Level (TE2) (GRD.TE.2)', site: 'Karachi' }, 'Production', RATE_TABLE_2025)
    expect(result.approved).toBe(18750)
  })
})

describe('rupees', () => {
  it('rounds half up', () => {
    expect(roundRupees(24112.5)).toBe(24113)
    expect(roundRupees(24112.49)).toBe(24112)
    expect(roundRupees(0.5)).toBe(1)
  })

  it('is not thrown off by binary floating point', () => {
    expect(roundRupees(24112.985)).toBe(24113)
    expect(roundRupees(1.005 * 1000)).toBe(1005)
  })

  it('passes a missing amount through rather than producing a zero', () => {
    expect(roundRupees(null)).toBeNull()
    expect(roundRupees(Number.NaN)).toBeNull()
    expect(roundRupees(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('needs both an approved amount and a total', () => {
    expect(earnedFor(null, 97)).toBeNull()
    expect(earnedFor(24750, null)).toBeNull()
  })

  it('pays nothing for a zero score, and the full rate for 100', () => {
    expect(earnedFor(24750, 0)).toBe(0)
    expect(earnedFor(24750, 100)).toBe(24750)
  })

  it('sums the rounded amounts, which is what Finance actually pays', () => {
    // Rounding each then summing differs from summing then rounding; the first is right.
    const amounts = [earnedFor(24750, 33.333), earnedFor(24750, 33.333), earnedFor(24750, 33.333)]
    expect(periodPayout(amounts)).toBe(amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0))
  })

  it('counts a missing amount as nothing in the period total, rather than poisoning it', () => {
    expect(periodPayout([24113, null, 100])).toBe(24213)
  })
})

// ---------------------------------------------------------------------------

describe('the brief’s worked example, to the rupee', () => {
  /** Employee 1295, grade TE2, Kasur Production, 2 days absent. */
  const marks: KpiMarks = {
    production: 19.695455,
    waste: wasteMarks(toHundredths(2.83))!,
    variance: varianceMarks(toHundredths(5))!,
    quality: 15,
    ehs: 15,
    wcm5s: 13.5,
    attendance: attendanceMarks(2)!,
  }

  const total = totalScore(marks)!
  const lookup = approvedFor({ grade: 'Technical Executive Level (TE2) (GRD.TE.2)', site: 'Kasur' }, 'Production', RATE_TABLE_2025)

  it('scores waste 15 from 2.83%', () => {
    expect(marks.waste).toBe(15)
  })

  it('scores variance 10 from 5%', () => {
    expect(marks.variance).toBe(10)
  })

  it('scores attendance 9.230769 from 2 days absent', () => {
    expect(marks.attendance).toBeCloseTo(9.230769, 6)
  })

  it('totals 97.426224', () => {
    expect(total).toBeCloseTo(97.426224, 6)
  })

  it('approves 24,750 — Kasur, Production, band B3', () => {
    expect(lookup.band).toBe('B3')
    expect(lookup.approved).toBe(24750)
  })

  it('earns 24,112.99 before rounding', () => {
    expect((lookup.approved! * total) / 100).toBeCloseTo(24112.99, 2)
  })

  it('pays PKR 24,113', () => {
    expect(earnedFor(lookup.approved, total)).toBe(24113)
  })
})
