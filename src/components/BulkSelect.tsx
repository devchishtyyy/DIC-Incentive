/**
 * The one selection pattern, shared by every list in the app.
 *
 * Established on the Daily Entry grid: a tick box per row, a tick-all in the header that
 * only ever covers the rows actually eligible, and a bar that appears when something is
 * selected saying what will happen and to how many. Lists that cannot act on a row — a
 * submitted entry, a record someone else owns — show a disabled slot with the reason
 * rather than a missing control, so the column never looks ragged.
 */

import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon, Tooltip } from './ui'

/**
 * The decisions, kept pure so they can be tested without a browser. The hook below is a
 * thin wrapper that holds the set in state and calls these.
 */

/** What is actually selected: the ticked keys, minus anything no longer eligible. */
export function visibleSelection<K>(picked: ReadonlySet<K>, eligible: readonly K[]): K[] {
  const allowed = new Set(eligible)
  return [...picked].filter((key) => allowed.has(key))
}

/** Every eligible row is ticked — drives the header checkbox. False on an empty list. */
export function isAllSelected<K>(picked: ReadonlySet<K>, eligible: readonly K[]): boolean {
  return eligible.length > 0 && eligible.every((key) => picked.has(key))
}

/**
 * Tick-all is a toggle: when everything eligible is already ticked it clears, otherwise it
 * selects the eligible rows and nothing else. Selecting "all" never reaches a row the user
 * was not offered.
 */
export function nextAllSelection<K>(picked: ReadonlySet<K>, eligible: readonly K[]): Set<K> {
  return isAllSelected(picked, eligible) ? new Set<K>() : new Set(eligible)
}

export function toggleKey<K>(picked: ReadonlySet<K>, key: K): Set<K> {
  const next = new Set(picked)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

export interface BulkSelection<K> {
  selected: K[]
  count: number
  isSelected: (key: K) => boolean
  toggle: (key: K) => void
  /** Ticks or clears everything currently eligible. */
  toggleAll: () => void
  allSelected: boolean
  clear: () => void
  /** Keeps the selection honest when the underlying list changes. */
  retain: (eligible: K[]) => void
}

/**
 * @param eligible the keys that can actually be acted on — anything else is never selected,
 *                 so a bulk action can never touch a row the user was not offered.
 */
export function useBulkSelection<K>(eligible: readonly K[]): BulkSelection<K> {
  const [picked, setPicked] = useState<Set<K>>(new Set())

  const eligibleSet = useMemo(() => new Set(eligible), [eligible])
  const selected = useMemo(() => visibleSelection(picked, eligible), [picked, eligible])

  const toggle = useCallback((key: K) => setPicked((current) => toggleKey(current, key)), [])
  const allSelected = isAllSelected(picked, eligible)
  const toggleAll = useCallback(() => setPicked((current) => nextAllSelection(current, eligible)), [eligible])

  const clear = useCallback(() => setPicked(new Set()), [])
  const retain = useCallback((keys: K[]) => {
    const keep = new Set(keys)
    setPicked((current) => new Set([...current].filter((key) => keep.has(key))))
  }, [])

  return {
    selected,
    count: selected.length,
    isSelected: (key) => picked.has(key) && eligibleSet.has(key),
    toggle,
    toggleAll,
    allSelected,
    clear,
    retain,
  }
}

// ---------------------------------------------------------------------------

/** The header tick box. Hidden when nothing on the list can be acted on. */
export function SelectAllCell<K>({ selection, label }: { selection: BulkSelection<K>; label: string }) {
  return (
    <th scope="col" className="th w-10">
      <Tooltip label={selection.allSelected ? 'Clear the selection' : label}>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={selection.allSelected}
          onChange={selection.toggleAll}
          aria-label={selection.allSelected ? 'Clear the selection' : label}
        />
      </Tooltip>
    </th>
  )
}

/** A row's tick box, or a disabled slot explaining why this one cannot be chosen. */
export function SelectCell<K>({
  selection,
  itemKey,
  label,
  blockedReason,
}: {
  selection: BulkSelection<K>
  itemKey: K
  label: string
  blockedReason?: string
}) {
  if (blockedReason) {
    return (
      <td className="td">
        <Tooltip label={blockedReason}>
          <span className="block h-4 w-4" />
        </Tooltip>
      </td>
    )
  }

  return (
    <td className="td">
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={selection.isSelected(itemKey)}
        onChange={() => selection.toggle(itemKey)}
        aria-label={label}
      />
    </td>
  )
}

/**
 * The bar that appears above a list once something is selected. Actions are passed in, so
 * each list decides what a selection means — add, deactivate, delete — while the shape and
 * wording stay the same everywhere.
 */
export function BulkBar<K>({
  selection,
  noun,
  children,
}: {
  selection: BulkSelection<K>
  /** Singular noun for what is selected, e.g. "employee", "point", "draft row". */
  noun: string
  children: ReactNode
}) {
  if (selection.count === 0) return null

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
      <span className="font-medium text-brand-800">
        {selection.count} {noun}
        {selection.count === 1 ? '' : 's'} selected
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={selection.clear}>
        <Icon name="close" className="h-3 w-3" /> Clear
      </button>
      <span className="ml-auto flex flex-wrap items-center gap-2">{children}</span>
    </div>
  )
}
