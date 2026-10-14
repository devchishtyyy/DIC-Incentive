/**
 * Bulk "Add rows" for Daily Entry.
 *
 * Posting for a whole line is the common case, so the dialog opens with everyone who has
 * no row yet already ticked and their usual point pre-filled. The fast path is: open,
 * glance, Add. Everything else — filtering, unticking, changing one point, or setting one
 * point for a whole area — is there for the days that are not ordinary.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate } from '../domain/dates'
import { describePaste, matchPastedIds, parseEmpIds } from '../domain/pasteEmpIds'
import type { DailyEntry as Entry, IsoDate } from '../domain/types'
import { useApp } from '../store/AppStore'
import { employeeIsActiveOn, employeesInScope, usualPoints } from '../store/selectors'
import { Badge, Icon, Modal, Tooltip } from './ui'

export interface RowPick {
  empId: number
  pointId: string | null
}

export function AddRowsDialog({
  open,
  date,
  existingRows,
  onClose,
  onAdd,
}: {
  open: boolean
  date: IsoDate
  /** Rows already on the sheet for this date, so people who have one can be shown as such. */
  existingRows: Entry[]
  onClose: () => void
  onAdd: (picks: RowPick[]) => void
}) {
  const { state } = useApp()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [points, setPoints] = useState<Record<number, string>>({})
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteResult, setPasteResult] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const usual = useMemo(() => usualPoints(state), [state])

  /** Everyone who could be posted for on this date, and the points they already have. */
  const candidates = useMemo(() => {
    const taken = new Map<number, Set<string>>()
    for (const row of existingRows) {
      const own = taken.get(row.empId) ?? new Set<string>()
      own.add(row.pointId ?? '')
      taken.set(row.empId, own)
    }

    return employeesInScope(state)
      .filter((employee) => employeeIsActiveOn(employee, date))
      .map((employee) => ({ employee, taken: taken.get(employee.empId) ?? new Set<string>() }))
  }, [state, date, existingRows])

  /** A row is one employee on one point on one day, so an existing pair cannot be added again. */
  const isTaken = (empId: number, pointId: string) =>
    candidates.find((c) => c.employee.empId === empId)?.taken.has(pointId) ?? false

  // Opening ticks everyone without a row and pre-fills their usual point.
  useEffect(() => {
    if (!open) return
    setQuery('')
    const defaults = Object.fromEntries(candidates.map((c) => [c.employee.empId, usual.get(c.employee.empId) ?? '']))
    setPoints(defaults)
    setSelected(
      new Set(
        candidates
          .filter((c) => !c.taken.has(defaults[c.employee.empId] ?? ''))
          .map((c) => c.employee.empId),
      ),
    )
    setPasteOpen(false)
    setPasteText('')
    setPasteResult(null)
    window.setTimeout(() => searchRef.current?.focus(), 0)
    // `candidates` is rebuilt on every open; depending on it here is what pre-fills the form.
  }, [open, candidates, usual])

  const needle = query.trim().toLowerCase()
  const shown = candidates.filter(
    ({ employee }) => !needle || String(employee.empId).includes(needle) || employee.name.toLowerCase().includes(needle),
  )

  /** The people the chosen point can still be added for — a clash is never addable. */
  const addable = new Set(
    candidates.filter((c) => !c.taken.has(points[c.employee.empId] ?? '')).map((c) => c.employee.empId),
  )

  const toggle = (empId: number) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })

  const setAllShown = (on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      for (const { employee } of shown) {
        if (on && addable.has(employee.empId)) next.add(employee.empId)
        else if (!on) next.delete(employee.empId)
      }
      return next
    })

  /**
   * Ticks everyone in a column pasted from Excel, and says what it did with the rest.
   * Replaces the selection rather than adding to it — a pasted list is the list.
   */
  const applyPaste = (text: string) => {
    const { ids, ignored } = parseEmpIds(text)
    if (ids.length === 0) {
      setPasteResult(ignored.length > 0 ? 'No Emp IDs found in that paste.' : 'Nothing pasted yet.')
      return
    }

    const onSheet = candidates.filter((c) => c.taken.size > 0).map((c) => c.employee.empId)
    const match = matchPastedIds(ids, [...addable], onSheet)

    setSelected(new Set(match.matched))
    setPasteResult(describePaste(match, ignored))
  }

  const withoutRow = candidates.filter((c) => c.taken.size === 0).map((c) => c.employee.empId)
  const shownAddable = shown.filter(({ employee }) => addable.has(employee.empId))
  const allShownSelected = shownAddable.length > 0 && shownAddable.every(({ employee }) => selected.has(employee.empId))

  /** "Same point for everyone" applies to everyone currently selected. */
  const applyPointToAll = (pointId: string) => {
    const point = state.points.find((p) => p.pointId === pointId)
    if (!point) return
    const affected = candidates.filter(({ employee }) => selected.has(employee.empId)).map(({ employee }) => employee.empId)

    setPoints((current) => {
      const next = { ...current }
      for (const empId of affected) next[empId] = pointId
      return next
    })
    // Anyone who already has that point today drops out of the selection rather than
    // silently becoming a duplicate.
    setSelected((current) => {
      const next = new Set(current)
      for (const empId of affected) {
        if (isTaken(empId, pointId)) next.delete(empId)
      }
      return next
    })
  }

  const picks = [...selected].filter((empId) => addable.has(empId)).sort((a, b) => a - b)
  const missingPoint = picks.filter((empId) => !points[empId]).length
  const blocked = candidates.filter((c) => !addable.has(c.employee.empId)).length
  const count = picks.length

  const submit = () => {
    if (count === 0) return
    onAdd(picks.map((empId) => ({ empId, pointId: points[empId] || null })))
    onClose()
  }

  /** Changing the point can clear a clash, so the person becomes selectable again. */
  const setPointFor = (empId: number, pointId: string) => {
    setPoints((current) => ({ ...current, [empId]: pointId }))
    setSelected((current) => {
      const next = new Set(current)
      if (pointId && !isTaken(empId, pointId)) next.add(empId)
      else next.delete(empId)
      return next
    })
  }

  return (
    <Modal
      open={open}
      title={`Add rows for ${formatDate(date)}`}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <span className="mr-auto text-xs text-ink-500">
            {count} to add
            {missingPoint > 0 ? ` · ${missingPoint} with no point yet` : ''}
            {blocked > 0 ? ` · ${blocked} already on the sheet` : ''}
          </span>
          <button type="button" className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <Tooltip label={count === 0 ? 'Tick at least one employee.' : ''}>
            <button type="button" className="btn btn-primary" disabled={count === 0} onClick={submit}>
              Add {count} row{count === 1 ? '' : 's'}
            </button>
          </Tooltip>
        </>
      }
    >
      <div className="space-y-3">
        {/* --- Paste a column from Excel ----------------------------------- */}
        <div className="rounded-md border border-ink-200 bg-ink-50 p-2.5">
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left text-sm font-medium text-ink-800"
            onClick={() => setPasteOpen((open) => !open)}
            aria-expanded={pasteOpen}
          >
            <Icon name="clipboard" className="h-4 w-4 text-brand-600" />
            Paste Emp IDs from Excel
            <Icon name="chevron" className={`ml-auto h-3.5 w-3.5 text-ink-400 transition-transform ${pasteOpen ? 'rotate-90' : ''}`} />
          </button>

          {pasteOpen && (
            <div className="mt-2 space-y-2">
              <textarea
                className="input min-h-24 font-mono text-xs"
                value={pasteText}
                autoFocus
                onChange={(event) => {
                  setPasteText(event.target.value)
                  applyPaste(event.target.value)
                }}
                placeholder={'Copy the Emp ID column and paste it here:\n1295\n2901\n2904'}
                aria-label="Paste a column of Emp IDs"
              />
              <p className="text-xs text-ink-500">
                One per line, or tab-separated across. A header row is ignored, and an 8-digit SAP id works as well as the 4-digit one.
                {pasteResult && <span className="mt-1 block font-medium text-ink-700">{pasteResult}</span>}
              </p>
            </div>
          )}
        </div>

        {/* --- Filter and bulk selection ---------------------------------- */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Icon name="search" className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-ink-400" />
            <input
              ref={searchRef}
              className="input pl-8"
              placeholder="Filter by Emp ID or name"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              }}
              aria-label="Filter employees"
            />
          </div>

          <button type="button" className="btn btn-default btn-sm" onClick={() => setAllShown(!allShownSelected)}>
            {allShownSelected ? 'Clear' : 'Select'} all {shown.length} shown
          </button>
          <button
            type="button"
            className="btn btn-default btn-sm"
            onClick={() => setSelected(new Set(withoutRow.filter((empId) => addable.has(empId))))}
            disabled={withoutRow.length === 0}
          >
            Only the {withoutRow.length} without a row
          </button>
        </div>

        {/* --- One point for everyone -------------------------------------- */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-2.5 py-2 text-xs text-ink-600">
          <label className="font-medium text-ink-700" htmlFor="bulk-point">
            Same point for everyone selected
          </label>
          <select
            id="bulk-point"
            className="input w-auto py-1"
            value=""
            onChange={(event) => {
              if (event.target.value) applyPointToAll(event.target.value)
            }}
          >
            <option value="">Keep each person&apos;s usual point</option>
            {state.points
              .filter((point) => point.active)
              .map((point) => (
                <option key={point.pointId} value={point.pointId}>
                  {point.name}
                </option>
              ))}
          </select>
          <span className="text-ink-500">applies to everyone selected</span>
        </div>

        {/* --- The list ----------------------------------------------------- */}
        <div className="max-h-80 overflow-y-auto rounded-md border border-ink-200 scroll-slim">
          {shown.length === 0 ? (
            <p className="p-4 text-sm text-ink-500">No employee matches that filter.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th scope="col" className="th w-10">
                    <span className="sr-only">Selected</span>
                  </th>
                  <th scope="col" className="th">Employee</th>
                  <th scope="col" className="th w-56">Point</th>
                  <th scope="col" className="th w-44">Already on the sheet</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ employee, taken }) => {
                  const chosen = points[employee.empId] ?? ''
                  const clash = chosen !== '' && taken.has(chosen)
                  const canAdd = addable.has(employee.empId)
                  const isOn = selected.has(employee.empId) && canAdd
                  // Their own Points first — nearly always the answer — then the rest.
                  const own = state.points.filter((p) => p.active && employee.pointIds.includes(p.pointId))
                  const ownIds = new Set(own.map((p) => p.pointId))
                  const rest = state.points.filter((p) => p.active && !ownIds.has(p.pointId))

                  return (
                    <tr key={employee.empId} className={isOn ? 'bg-brand-50/60' : clash ? 'bg-ink-50' : undefined}>
                      <td className="td">
                        <Tooltip label={clash ? 'This employee already has a row on that point today. Pick a different point to add one.' : ''}>
                          <input
                            type="checkbox"
                            checked={isOn}
                            disabled={!canAdd}
                            onChange={() => toggle(employee.empId)}
                            aria-label={`Add a row for ${employee.empId} ${employee.name}`}
                            className="h-4 w-4"
                          />
                        </Tooltip>
                      </td>
                      <td className="td">
                        <button
                          type="button"
                          className="w-full text-left disabled:cursor-not-allowed"
                          disabled={!canAdd}
                          onClick={() => toggle(employee.empId)}
                        >
                          <span className="font-mono text-xs tabular-nums text-ink-600">{employee.empId}</span>{' '}
                          <span className={`font-medium ${canAdd ? 'text-ink-900' : 'text-ink-500'}`}>{employee.name}</span>
                          <span className="block text-xs text-ink-500">
                            {employee.grade}
                            {employee.status !== 'Active' ? ` · ${employee.status}` : ''}
                          </span>
                        </button>
                      </td>
                      <td className="td">
                        <select
                          className={`input py-1 ${clash ? 'input-error' : isOn && !chosen ? 'input-error' : ''}`}
                          value={chosen}
                          aria-label={`Point for ${employee.name}`}
                          onChange={(event) => setPointFor(employee.empId, event.target.value)}
                        >
                          <option value="">— choose a point —</option>
                          {own.length > 0 && (
                            <optgroup label="Their points">
                              {own.map((point) => (
                                <option key={point.pointId} value={point.pointId}>
                                  {point.name}
                                  {taken.has(point.pointId) ? ' — already added' : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {rest.length > 0 && (
                            <optgroup label={own.length > 0 ? 'Other points' : 'All points'}>
                              {rest.map((point) => (
                                <option key={point.pointId} value={point.pointId}>
                                  {point.name}
                                  {taken.has(point.pointId) ? ' — already added' : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </td>
                      <td className="td">
                        {taken.size === 0 ? (
                          <span className="text-xs text-ink-400">&mdash;</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {[...taken].map((pointId) => (
                              <Badge key={pointId || 'blank'} tone={pointId === chosen ? 'warn' : 'neutral'}>
                                {state.points.find((p) => p.pointId === pointId)?.name ?? 'no point'}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-ink-500">
          Points are pre-filled from what each person usually works. Rows are added as Draft with the Output Batch blank — type the numbers into the
          grid, then Submit day.
        </p>
      </div>
    </Modal>
  )
}
