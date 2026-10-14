/**
 * The selection rules shared by every list in the app.
 *
 * The one that matters: a bulk action must never reach a row the user was not offered.
 * Tick-all covers only the eligible rows, and a row that stops being eligible — because a
 * filter changed, or someone else deactivated it — drops out of the selection rather than
 * being carried silently into a Deactivate or a Delete.
 */

import { describe, expect, it } from 'vitest'
import { isAllSelected, nextAllSelection, toggleKey, visibleSelection } from './BulkSelect'

const eligible = ['a', 'b', 'c']

describe('ticking one row', () => {
  it('adds it', () => {
    expect([...toggleKey(new Set<string>(), 'a')]).toEqual(['a'])
  })

  it('removes it again', () => {
    expect([...toggleKey(new Set(['a', 'b']), 'a')]).toEqual(['b'])
  })

  it('leaves the original set alone', () => {
    const picked = new Set(['a'])
    toggleKey(picked, 'b')
    expect([...picked]).toEqual(['a'])
  })
})

describe('what counts as selected', () => {
  it('is the ticked rows that are still eligible', () => {
    expect(visibleSelection(new Set(['a', 'c']), eligible)).toEqual(['a', 'c'])
  })

  it('drops a row that is no longer eligible — a filter moved, or it was deactivated', () => {
    // 'z' was ticked, then stopped being offered. A Deactivate must not reach it.
    expect(visibleSelection(new Set(['a', 'z']), eligible)).toEqual(['a'])
  })

  it('is empty when nothing on the list can be acted on', () => {
    expect(visibleSelection(new Set(['a', 'b']), [])).toEqual([])
  })

  it('is empty when nothing is ticked', () => {
    expect(visibleSelection(new Set<string>(), eligible)).toEqual([])
  })
})

describe('the header tick-all box', () => {
  it('is checked only when every eligible row is ticked', () => {
    expect(isAllSelected(new Set(['a', 'b', 'c']), eligible)).toBe(true)
    expect(isAllSelected(new Set(['a', 'b']), eligible)).toBe(false)
  })

  it('ignores ticked rows that are not eligible', () => {
    // Extra keys hanging around must not make the box look fully checked.
    expect(isAllSelected(new Set(['a', 'b', 'z']), eligible)).toBe(false)
  })

  it('is unchecked on an empty list rather than vacuously true', () => {
    expect(isAllSelected(new Set<string>(), [])).toBe(false)
  })
})

describe('pressing tick-all', () => {
  it('selects every eligible row from nothing', () => {
    expect([...nextAllSelection(new Set<string>(), eligible)]).toEqual(['a', 'b', 'c'])
  })

  it('clears when everything is already selected', () => {
    expect([...nextAllSelection(new Set(['a', 'b', 'c']), eligible)]).toEqual([])
  })

  it('completes a partial selection rather than clearing it', () => {
    expect([...nextAllSelection(new Set(['a']), eligible)]).toEqual(['a', 'b', 'c'])
  })

  it('never selects a row outside the eligible list', () => {
    // The whole point: "select all" on a filtered view means all of *that* view.
    const next = nextAllSelection(new Set(['z']), eligible)
    expect(next.has('z')).toBe(false)
    expect([...next]).toEqual(['a', 'b', 'c'])
  })

  it('does nothing useful on an empty list', () => {
    expect([...nextAllSelection(new Set<string>(), [])]).toEqual([])
  })
})

describe('numeric keys work too — Emp IDs are numbers', () => {
  const ids = [1295, 6289, 7092]

  it('ticks and unticks', () => {
    expect([...toggleKey(new Set<number>(), 1295)]).toEqual([1295])
  })

  it('selects all of them', () => {
    expect([...nextAllSelection(new Set<number>(), ids)]).toEqual(ids)
  })

  it('drops one that leaves the list', () => {
    expect(visibleSelection(new Set([1295, 9999]), ids)).toEqual([1295])
  })
})
