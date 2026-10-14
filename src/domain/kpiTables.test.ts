/**
 * The waste, variance and attendance tables.
 *
 * Every row and both sides of every rounding tie, because these are lookup tables where a
 * boundary off by one row is worth 2.5 marks — and 2.5 marks out of 100 is a couple of
 * thousand rupees a head. Floating point is the reason the tables take integer hundredths:
 * `2.8 + 0.1` is `2.9000000000000004`, which compares wrong against a 2.9 boundary.
 */

import { describe, expect, it } from 'vitest'
import {
  attendanceMarks,
  fromHundredths,
  KPI_ORDER,
  KPI_WEIGHTS,
  missingKpis,
  roundToTableRow,
  toHundredths,
  totalScore,
  varianceMarks,
  VARIANCE_STEP_HUNDREDTHS,
  wasteMarks,
  WASTE_STEP_HUNDREDTHS,
  type KpiMarks,
} from './calc'

describe('percentages as integer hundredths', () => {
  it('converts both ways', () => {
    expect(toHundredths(2.83)).toBe(283)
    expect(fromHundredths(283)).toBe(2.83)
  })

  it('survives the float that makes this necessary', () => {
    expect(toHundredths(2.8 + 0.1)).toBe(290)
  })

  it('passes null through rather than inventing a zero', () => {
    expect(toHundredths(null)).toBeNull()
    expect(toHundredths(Number.NaN)).toBeNull()
    expect(fromHundredths(null)).toBeNull()
  })
})

describe('rounding to a table row', () => {
  it('rounds down when nearer the better row', () => {
    expect(roundToTableRow(283, 10)).toBe(280)
    expect(roundToTableRow(281, 10)).toBe(280)
  })

  it('rounds up when nearer the worse row', () => {
    expect(roundToTableRow(287, 10)).toBe(290)
    expect(roundToTableRow(289, 10)).toBe(290)
  })

  it('breaks a tie towards the WORSE row', () => {
    expect(roundToTableRow(285, 10)).toBe(290)
    expect(roundToTableRow(295, 10)).toBe(300)
    expect(roundToTableRow(525, 50)).toBe(550)
  })

  it('leaves a value already on a row alone', () => {
    expect(roundToTableRow(280, 10)).toBe(280)
    expect(roundToTableRow(500, 50)).toBe(500)
  })
})

describe('the waste table', () => {
  const cases: Array<[number, number]> = [
    [280, 15],
    [290, 12.5],
    [300, 10],
    [310, 7.5],
    [320, 5],
  ]

  it.each(cases)('%d hundredths → %s marks', (hundredths, marks) => {
    expect(wasteMarks(hundredths)).toBe(marks)
  })

  it('gives full marks below the first row', () => {
    expect(wasteMarks(0)).toBe(15)
    expect(wasteMarks(100)).toBe(15)
    expect(wasteMarks(279)).toBe(15)
  })

  it('floors at 5 however bad it gets', () => {
    expect(wasteMarks(500)).toBe(5)
    expect(wasteMarks(10000)).toBe(5)
  })

  it('scores last period’s 2.83% as 15 — the brief’s worked figure', () => {
    expect(wasteMarks(toHundredths(2.83))).toBe(15)
  })

  it('breaks each tie to the worse row', () => {
    expect(wasteMarks(285)).toBe(12.5)
    expect(wasteMarks(295)).toBe(10)
    expect(wasteMarks(305)).toBe(7.5)
    expect(wasteMarks(315)).toBe(5)
  })

  it('lands on exactly one row for every tenth across the whole table', () => {
    const allowed = new Set([15, 12.5, 10, 7.5, 5])
    for (let h = 0; h <= 600; h += 1) {
      expect(allowed.has(wasteMarks(h)!), String(h)).toBe(true)
    }
  })

  it('never improves as waste rises', () => {
    let previous = 15
    for (let h = 0; h <= 600; h += 1) {
      const marks = wasteMarks(h)!
      expect(marks, String(h)).toBeLessThanOrEqual(previous)
      previous = marks
    }
  })

  it('is null for a figure nobody has entered', () => {
    expect(wasteMarks(null)).toBeNull()
    expect(wasteMarks(undefined)).toBeNull()
  })
})

describe('the variance table', () => {
  const cases: Array<[number, number]> = [
    [500, 10],
    [550, 8.5],
    [600, 7],
    [650, 5.5],
    [700, 4],
    [750, 2.5],
    [800, 1],
    [850, 0],
  ]

  it.each(cases)('%d hundredths → %s marks', (hundredths, marks) => {
    expect(varianceMarks(hundredths)).toBeCloseTo(marks, 10)
  })

  it('gives full marks at or below 5%', () => {
    expect(varianceMarks(0)).toBe(10)
    expect(varianceMarks(499)).toBe(10)
  })

  it('floors at zero rather than going negative', () => {
    expect(varianceMarks(900)).toBe(0)
    expect(varianceMarks(5000)).toBe(0)
  })

  it('breaks a tie to the worse row', () => {
    expect(varianceMarks(525)).toBeCloseTo(8.5, 10)
    expect(varianceMarks(575)).toBeCloseTo(7, 10)
  })

  it('loses exactly 1.5 per half-percent', () => {
    for (let steps = 1; steps <= 6; steps += 1) {
      const hundredths = 500 + steps * VARIANCE_STEP_HUNDREDTHS
      expect(varianceMarks(hundredths), String(hundredths)).toBeCloseTo(10 - steps * 1.5, 10)
    }
  })

  it('never improves as variance rises, and never leaves the 0–10 range', () => {
    let previous = 10
    for (let h = 0; h <= 1200; h += 1) {
      const marks = varianceMarks(h)!
      expect(marks, String(h)).toBeLessThanOrEqual(previous)
      expect(marks).toBeGreaterThanOrEqual(0)
      expect(marks).toBeLessThanOrEqual(10)
      previous = marks
    }
  })

  it('scores last period’s 10 marks from a 5% variance', () => {
    expect(varianceMarks(toHundredths(5))).toBe(10)
  })

  it('is null for a figure nobody has entered', () => {
    expect(varianceMarks(null)).toBeNull()
  })
})

describe('attendance', () => {
  it('gives full marks for a perfect period', () => {
    expect(attendanceMarks(0)).toBe(10)
  })

  it('gives the brief’s worked figure for two days absent', () => {
    expect(attendanceMarks(2)).toBeCloseTo(9.230769230769232, 12)
  })

  it('gives nothing for a whole period absent', () => {
    expect(attendanceMarks(26)).toBe(0)
  })

  it('floors at zero beyond a whole period, rather than going negative', () => {
    expect(attendanceMarks(27)).toBe(0)
    expect(attendanceMarks(40)).toBe(0)
  })

  it('treats zero as a real answer and blank as no answer', () => {
    expect(attendanceMarks(0)).toBe(10)
    expect(attendanceMarks(null)).toBeNull()
    expect(attendanceMarks(undefined)).toBeNull()
  })

  it('refuses a negative count rather than paying more than full marks', () => {
    expect(attendanceMarks(-1)).toBeNull()
  })

  it('never leaves the 0–10 range', () => {
    for (let absent = 0; absent <= 60; absent += 1) {
      const marks = attendanceMarks(absent)!
      expect(marks, String(absent)).toBeGreaterThanOrEqual(0)
      expect(marks).toBeLessThanOrEqual(10)
    }
  })

  it('survives a nonsense divisor without dividing by zero', () => {
    expect(attendanceMarks(2, 0)).toBeNull()
    expect(attendanceMarks(2, -26)).toBeNull()
  })
})

describe('the total', () => {
  const full: KpiMarks = { production: 20, waste: 15, variance: 10, quality: 15, ehs: 15, wcm5s: 15, attendance: 10 }

  it('adds the seven KPIs', () => {
    expect(totalScore(full)).toBe(100)
  })

  it('weights total 100, which is what makes Earned × Total ÷ 100 mean anything', () => {
    expect(KPI_ORDER.reduce((sum, key) => sum + KPI_WEIGHTS[key], 0)).toBe(100)
  })

  it('is null when any KPI is missing — never a quietly smaller total', () => {
    for (const key of KPI_ORDER) {
      expect(totalScore({ ...full, [key]: null }), key).toBeNull()
    }
  })

  it('names what is missing, so the screen can say so', () => {
    expect(missingKpis({ ...full, waste: null, attendance: null })).toEqual(['waste', 'attendance'])
    expect(missingKpis(full)).toEqual([])
  })

  it('reaches the brief’s worked total for employee 1295', () => {
    const marks: KpiMarks = {
      production: 19.695455,
      waste: wasteMarks(toHundredths(2.83))!,
      variance: varianceMarks(toHundredths(5))!,
      quality: 15,
      ehs: 15,
      wcm5s: 13.5,
      attendance: attendanceMarks(2)!,
    }
    expect(totalScore(marks)).toBeCloseTo(97.426224, 6)
  })
})

describe('the step constants match the tables they drive', () => {
  it('uses a tenth of a percent for waste and a half for variance', () => {
    expect(WASTE_STEP_HUNDREDTHS).toBe(10)
    expect(VARIANCE_STEP_HUNDREDTHS).toBe(50)
  })
})
