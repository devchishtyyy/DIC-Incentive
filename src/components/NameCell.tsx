/**
 * The name of somebody SuccessFactors has not named.
 *
 * Two of the forty-two people DIC supplied do not come back from SAP at all, and a row
 * reading "Name not synced yet" tells whoever is entering their output nothing. So the
 * cell is typed into directly: no dialog, no reason, commit on Enter or on leaving the
 * box — the same bargain as Output Batch next to it.
 *
 * A typed name survives the weekly sync. `directory.sync` only writes into blanks, so
 * SuccessFactors can never silently overwrite what somebody here knew and it didn't.
 */

import { useEffect, useRef, useState } from 'react'
import type { Employee } from '../domain/types'
import { useApp } from '../store/AppStore'
import { awaitingSapDetail } from '../data/plantMasters'
import { displayName } from '../store/selectors'
import { Icon, Tooltip } from './ui'

export function NameCell({ employee, empId, subtitle }: { employee: Employee | undefined; empId: number; subtitle?: boolean }) {
  const { allow, write } = useApp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) input.current?.focus()
  }, [editing])

  if (!employee) return <span className="text-ink-400 italic">{displayName(undefined, empId)}</span>

  const missing = awaitingSapDetail(employee)
  const decision = allow('employee.setName', { hasName: !missing })

  const commit = () => {
    const name = draft.trim()
    if (name) write({ kind: 'employee.setName', empId: employee.empId, name })
    setEditing(false)
    setDraft('')
  }

  if (editing) {
    return (
      <input
        ref={input}
        className="input py-1 text-sm"
        value={draft}
        placeholder="Type the name"
        aria-label={`Name for Emp ${employee.empId}`}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setEditing(false)
            setDraft('')
          }
        }}
      />
    )
  }

  // --- Nobody has named them yet ------------------------------------------
  if (missing) {
    if (!decision.allowed) {
      return (
        <Tooltip label={`${decision.reason} Names otherwise arrive with the SAP sync.`}>
          <span className="text-ink-400 italic">Name not synced yet</span>
        </Tooltip>
      )
    }
    return (
      <Tooltip label="SuccessFactors has no record of this Emp ID. Type the name and it will stick — the weekly sync will not overwrite it.">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-warn-100 bg-warn-50 px-2 py-0.5 text-xs font-medium text-warn-700 transition-colors hover:bg-warn-100"
          onClick={() => {
            setDraft('')
            setEditing(true)
          }}
        >
          <Icon name="plus" className="h-3 w-3" /> Add name
        </button>
      </Tooltip>
    )
  }

  // --- Named -------------------------------------------------------------
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-ink-900">{employee.name}</span>
        {decision.allowed && (
          <Tooltip label="Correct this name">
            <button
              type="button"
              className="text-ink-300 transition-colors hover:text-brand-600"
              aria-label={`Correct the name for Emp ${employee.empId}`}
              onClick={() => {
                setDraft(employee.name)
                setEditing(true)
              }}
            >
              <Icon name="pencil" className="h-3 w-3" />
            </button>
          </Tooltip>
        )}
      </div>
      {subtitle && <div className="text-xs text-ink-500">{[employee.grade, employee.role].filter(Boolean).join(' · ')}</div>}
    </>
  )
}
