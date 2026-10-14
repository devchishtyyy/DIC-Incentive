import { describe, expect, it } from 'vitest'
import { describePaste, matchPastedIds, parseEmpIds } from './pasteEmpIds'

describe('reading a column copied out of Excel', () => {
  it('reads one id per line', () => {
    expect(parseEmpIds('1295\n2901\n2904').ids).toEqual([1295, 2901, 2904])
  })

  it('copes with Windows line endings', () => {
    expect(parseEmpIds('1295\r\n2901\r\n').ids).toEqual([1295, 2901])
  })

  it('copes with a tab-separated row, which is what a sideways selection gives', () => {
    expect(parseEmpIds('1295\t2901\t2904').ids).toEqual([1295, 2901, 2904])
  })

  it('accepts commas and semicolons, for a list typed by hand', () => {
    expect(parseEmpIds('1295, 2901; 2904').ids).toEqual([1295, 2901, 2904])
  })

  it('skips a header row without complaining about it', () => {
    const result = parseEmpIds('Emp ID\n1295\n2901')
    expect(result.ids).toEqual([1295, 2901])
    expect(result.ignored).toEqual([])
  })

  it('strips quotes that a CSV paste brings along', () => {
    expect(parseEmpIds('"1295"\n"2901"').ids).toEqual([1295, 2901])
  })

  it('reads an id with decoration around it', () => {
    expect(parseEmpIds('#1295\n1295.\nEmp 2901').ids).toEqual([1295, 2901])
  })

  it('ignores blank lines and trailing whitespace', () => {
    expect(parseEmpIds('  1295  \n\n\n2901\n   ').ids).toEqual([1295, 2901])
  })

  it('drops duplicates, keeping the first position', () => {
    expect(parseEmpIds('1295\n2901\n1295').ids).toEqual([1295, 2901])
  })

  it('reads nothing from nothing', () => {
    expect(parseEmpIds('').ids).toEqual([])
    expect(parseEmpIds('   \n  ').ids).toEqual([])
  })
})

describe('an 8-digit SAP id works just as well', () => {
  // A column copied out of SuccessFactors rather than the Excel.
  it('folds it to the floor Emp ID', () => {
    expect(parseEmpIds('40001295\n40002901').ids).toEqual([1295, 2901])
  })

  it('treats the two forms of the same person as one', () => {
    expect(parseEmpIds('1295\n40001295').ids).toEqual([1295])
  })
})

describe('what could not be read is reported, never dropped quietly', () => {
  it('reports a token with no digits in it', () => {
    const result = parseEmpIds('1295\n???\n2901')
    expect(result.ids).toEqual([1295, 2901])
    expect(result.ignored).toEqual(['???'])
  })

  it('does not report plain words, which are almost always a header', () => {
    expect(parseEmpIds('Employee Code\n1295').ignored).toEqual([])
  })
})

describe('sorting a pasted list against the sheet', () => {
  const selectable = [1295, 2901, 2904]
  const present = [4070, 4071]

  it('ticks the ones that can be added', () => {
    expect(matchPastedIds([1295, 2901], selectable, present).matched).toEqual([1295, 2901])
  })

  it('separates the ones already on the sheet', () => {
    const match = matchPastedIds([1295, 4070], selectable, present)
    expect(match.matched).toEqual([1295])
    expect(match.alreadyPresent).toEqual([4070])
  })

  it('separates the ones nobody on the incentive list has', () => {
    const match = matchPastedIds([1295, 9999], selectable, present)
    expect(match.matched).toEqual([1295])
    expect(match.unknown).toEqual([9999])
  })

  it('puts every pasted id in exactly one bucket', () => {
    const ids = [1295, 4070, 9999]
    const match = matchPastedIds(ids, selectable, present)
    expect(match.matched.length + match.alreadyPresent.length + match.unknown.length).toBe(ids.length)
  })

  it('handles a paste that matches nothing', () => {
    const match = matchPastedIds([8888, 9999], selectable, present)
    expect(match.matched).toEqual([])
    expect(match.unknown).toEqual([8888, 9999])
  })
})

describe('telling the user what the paste did', () => {
  it('mentions only what happened', () => {
    expect(describePaste({ matched: [1, 2], alreadyPresent: [], unknown: [] }, [])).toBe('2 selected')
  })

  it('accounts for every category when they all occur', () => {
    const summary = describePaste({ matched: [1], alreadyPresent: [2], unknown: [3] }, ['???'])
    expect(summary).toBe('1 selected · 1 already on the sheet · 1 not on the incentive list · 1 unreadable')
  })

  it('still says something when nothing matched', () => {
    expect(describePaste({ matched: [], alreadyPresent: [], unknown: [9] }, [])).toBe('0 selected · 1 not on the incentive list')
  })
})
