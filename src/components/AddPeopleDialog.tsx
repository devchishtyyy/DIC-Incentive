/**
 * Picking people to put on a period sheet.
 *
 * The same dialog as Daily Entry's "Add rows", with the per-day columns taken out: paste a
 * column of Emp IDs from Excel, filter, tick all shown, tick one at a time. Anybody already
 * on the sheet is shown greyed with the reason, so the list never looks as though somebody
 * is missing from it.
 */

import { useEffect, useRef, useState } from 'react'
import { describePaste, matchPastedIds, parseEmpIds } from '../domain/pasteEmpIds'
import type { Employee } from '../domain/types'
import { displayName } from '../store/selectors'
import { Icon, Modal, Tooltip } from './ui'

export function AddPeopleDialog({
  open,
  title,
  confirmLabel,
  candidates,
  alreadyOn,
  onClose,
  onAdd,
}: {
  open: boolean
  title: string
  /** Word for what is being added, e.g. "row". */
  confirmLabel: string
  candidates: Employee[]
  /** Emp IDs already on the sheet — offered, but not selectable. */
  alreadyOn: ReadonlySet<number>
  onClose: () => void
  onAdd: (empIds: number[]) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteResult, setPasteResult] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const addable = candidates.filter((employee) => !alreadyOn.has(employee.empId))

  // Opening ticks everybody not already on the sheet — the common case is "all of them".
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(new Set(addable.map((employee) => employee.empId)))
    setPasteOpen(false)
    setPasteText('')
    setPasteResult(null)
    window.setTimeout(() => searchRef.current?.focus(), 0)
    // Rebuilt whenever the dialog opens; that is what pre-fills the selection.
  }, [open, candidates, alreadyOn])

  const needle = query.trim().toLowerCase()
  const shown = candidates.filter(
    (employee) => !needle || String(employee.empId).includes(needle) || displayName(employee).toLowerCase().includes(needle),
  )
  const shownAddable = shown.filter((employee) => !alreadyOn.has(employee.empId))
  const allShownSelected = shownAddable.length > 0 && shownAddable.every((employee) => selected.has(employee.empId))

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
      for (const employee of shownAddable) {
        if (on) next.add(employee.empId)
        else next.delete(employee.empId)
      }
      return next
    })

  /** Ticks everyone in a column pasted from Excel, and says what it did with the rest. */
  const applyPaste = (text: string) => {
    const { ids, ignored } = parseEmpIds(text)
    if (ids.length === 0) {
      setPasteResult(ignored.length > 0 ? 'No Emp IDs found in that paste.' : 'Nothing pasted yet.')
      return
    }
    const match = matchPastedIds(ids, addable.map((employee) => employee.empId), [...alreadyOn])
    setSelected(new Set(match.matched))
    setPasteResult(describePaste(match, ignored))
  }

  const picks = [...selected].filter((empId) => !alreadyOn.has(empId)).sort((a, b) => a - b)
  const count = picks.length

  const submit = () => {
    if (count === 0) return
    onAdd(picks)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <span className="mr-auto text-xs text-ink-500">
            {count} to add
            {alreadyOn.size > 0 ? ` · ${alreadyOn.size} already on the sheet` : ''}
          </span>
          <button type="button" className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <Tooltip label={count === 0 ? 'Tick at least one employee.' : ''}>
            <button type="button" className="btn btn-primary" disabled={count === 0} onClick={submit}>
              Add {count} {confirmLabel}
              {count === 1 ? '' : 's'}
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
            onClick={() => setPasteOpen((current) => !current)}
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
                One per line, or tab-separated across. A header row is ignored, and an 8-digit SAP id works as well as the
                4-digit one.
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
            {allShownSelected ? 'Clear' : 'Select'} all {shownAddable.length} shown
          </button>
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
                  <th scope="col" className="th w-44">Already on the sheet</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((employee) => {
                  const on = alreadyOn.has(employee.empId)
                  const isOn = selected.has(employee.empId) && !on

                  return (
                    <tr key={employee.empId} className={isOn ? 'bg-brand-50/60' : on ? 'bg-ink-50' : undefined}>
                      <td className="td">
                        <Tooltip label={on ? 'Already on the sheet.' : ''}>
                          <input
                            type="checkbox"
                            checked={isOn}
                            disabled={on}
                            onChange={() => toggle(employee.empId)}
                            aria-label={`Add ${employee.empId} ${displayName(employee)}`}
                            className="h-4 w-4"
                          />
                        </Tooltip>
                      </td>
                      <td className="td">
                        <button
                          type="button"
                          className="w-full text-left disabled:cursor-not-allowed"
                          disabled={on}
                          onClick={() => toggle(employee.empId)}
                        >
                          <span className="font-mono text-xs tabular-nums text-ink-600">{employee.empId}</span>{' '}
                          <span className={`font-medium ${on ? 'text-ink-500' : 'text-ink-900'}`}>{displayName(employee)}</span>
                          <span className="block text-xs text-ink-500">
                            {employee.grade}
                            {employee.status !== 'Active' ? ` · ${employee.status}` : ''}
                          </span>
                        </button>
                      </td>
                      <td className="td text-xs text-ink-500">{on ? 'On the sheet' : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  )
}
