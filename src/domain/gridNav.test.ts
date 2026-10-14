import { describe, expect, it } from 'vitest'
import { hasRow, nextRow } from './gridNav'

const order = ['a', 'b', 'c', 'd']

describe('moving down the Output Batch column', () => {
  it('goes to the next row on Enter', () => {
    expect(nextRow(order, 'a', 1)).toBe('b')
    expect(nextRow(order, 'b', 1)).toBe('c')
  })

  it('goes back up on Shift+Enter', () => {
    expect(nextRow(order, 'c', -1)).toBe('b')
    expect(nextRow(order, 'b', -1)).toBe('a')
  })

  it('stops at the bottom rather than wrapping round', () => {
    expect(nextRow(order, 'd', 1)).toBeNull()
  })

  it('stops at the top rather than wrapping round', () => {
    expect(nextRow(order, 'a', -1)).toBeNull()
  })
})

describe('rows that cannot be typed into are simply not in the order', () => {
  // The caller builds `order` from the editable rows only, so a locked or submitted row
  // between two drafts is stepped straight over.
  const withGaps = ['draft1', 'draft2', 'draft3']

  it('skips the read-only row in between', () => {
    expect(nextRow(withGaps, 'draft1', 1)).toBe('draft2')
  })

  it('leaves nothing to move to when only one row is editable', () => {
    expect(nextRow(['only'], 'only', 1)).toBeNull()
    expect(nextRow(['only'], 'only', -1)).toBeNull()
  })

  it('has nowhere to go on an empty day', () => {
    expect(nextRow([], 'anything', 1)).toBeNull()
  })
})

describe('the row underneath you disappearing', () => {
  // Deleting the selected rows, or switching area while focus sits in the grid, can leave
  // the focused id out of the order entirely. Focus must land somewhere sensible.
  it('falls to the first row when moving down', () => {
    expect(nextRow(order, 'gone', 1)).toBe('a')
  })

  it('falls to the last row when moving up', () => {
    expect(nextRow(order, 'gone', -1)).toBe('d')
  })

  it('still reports nowhere to go when the grid is empty', () => {
    expect(nextRow([], 'gone', 1)).toBeNull()
  })
})

describe('hasRow decides whether Tab leaves the grid', () => {
  it('keeps Tab inside the column while there is a row below', () => {
    expect(hasRow(order, 'a', 1)).toBe(true)
    expect(hasRow(order, 'c', 1)).toBe(true)
  })

  it('lets Tab out at the bottom, so the grid is never a keyboard trap', () => {
    expect(hasRow(order, 'd', 1)).toBe(false)
  })

  it('lets Shift+Tab out at the top', () => {
    expect(hasRow(order, 'a', -1)).toBe(false)
  })
})

describe('a zero step does nothing', () => {
  it('never returns a row', () => {
    expect(nextRow(order, 'b', 0)).toBeNull()
  })
})
