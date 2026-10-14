/**
 * Choosing a Point for one employee-day.
 *
 * Their own assigned Points come first, because that is nearly always the answer. Below
 * them sit the rest of the area's Points, and at the bottom the option to type a new one —
 * which is how a Point enters the master data for a new employee or a new activity.
 *
 * A typed name that already exists, in any casing, resolves to the existing Point rather
 * than creating a second one. That is the "manual / Manual / MANUAL" problem from section
 * 6 of the build brief, prevented at the point of entry.
 */

import { useState } from 'react'
import type { Employee, Point } from '../domain/types'
import { useApp } from '../store/AppStore'
import { Field, Modal, Tooltip } from './ui'

const ADD_NEW = '__add_new__'

export function PointPicker({
  value,
  employee,
  disabled,
  onChange,
  invalid,
}: {
  value: string | null
  employee: Employee | undefined
  disabled: boolean
  onChange: (pointId: string | null) => void
  invalid?: boolean
}) {
  const { state, write, allow } = useApp()
  const [adding, setAdding] = useState(false)

  const assigned = state.points.filter((point) => point.active && employee?.pointIds.includes(point.pointId))
  const assignedIds = new Set(assigned.map((point) => point.pointId))
  const others = state.points.filter((point) => point.active && !assignedIds.has(point.pointId))

  const canCreate = allow('entry.edit').allowed

  return (
    <>
      <select
        className={`input py-1 ${invalid ? 'input-error' : ''}`}
        value={value ?? ''}
        disabled={disabled}
        aria-label={`Point for ${employee?.name ?? 'this row'}`}
        onChange={(event) => {
          if (event.target.value === ADD_NEW) setAdding(true)
          else onChange(event.target.value || null)
        }}
      >
        <option value="">— choose a point —</option>

        {assigned.length > 0 && (
          <optgroup label="Their points">
            {assigned.map((point) => (
              <option key={point.pointId} value={point.pointId}>
                {point.name}
              </option>
            ))}
          </optgroup>
        )}

        {others.length > 0 && (
          <optgroup label={assigned.length > 0 ? 'Other points' : 'All points'}>
            {others.map((point) => (
              <option key={point.pointId} value={point.pointId}>
                {point.name}
              </option>
            ))}
          </optgroup>
        )}

        {canCreate && !disabled && <option value={ADD_NEW}>+ Add a new point…</option>}
      </select>

      <NewPointDialog
        open={adding}
        employee={employee}
        onClose={() => setAdding(false)}
        onCreate={(name) => {
          const existing = state.points.find((point) => point.name.trim().toLowerCase() === name.trim().toLowerCase())
          write({ kind: 'point.create', name, assignToEmpId: employee?.empId })
          // An existing Point can be selected straight away; a new one gets its id from
          // the write, so the next render offers it under "Their points".
          if (existing) onChange(existing.pointId)
          setAdding(false)
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------

function NewPointDialog({
  open,
  employee,
  onClose,
  onCreate,
}: {
  open: boolean
  employee: Employee | undefined
  onClose: () => void
  onCreate: (name: string) => void
}) {
  const { state } = useApp()
  const [name, setName] = useState('')

  const trimmed = name.trim()
  const clash: Point | undefined = state.points.find((point) => point.name.trim().toLowerCase() === trimmed.toLowerCase())

  return (
    <Modal
      open={open}
      title="Add a point"
      onClose={() => {
        setName('')
        onClose()
      }}
      footer={
        <>
          <button
            type="button"
            className="btn btn-default"
            onClick={() => {
              setName('')
              onClose()
            }}
          >
            Cancel
          </button>
          <Tooltip label={trimmed.length < 2 ? 'Give the point a name.' : ''}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={trimmed.length < 2}
              onClick={() => {
                onCreate(trimmed)
                setName('')
              }}
            >
              {clash ? 'Use the existing point' : 'Add point'}
            </button>
          </Tooltip>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Point name"
          hint={`Added to the Point list and assigned to ${employee?.name ?? 'this employee'}.`}
        >
          <input
            className="input"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. UV Dosing"
          />
        </Field>

        {clash && (
          <p className="rounded-md border border-warn-100 bg-warn-50 px-2.5 py-1.5 text-xs text-warn-700">
            <strong>{clash.name}</strong> already exists. It will be reused rather than creating a second one — which is how "manual", "Manual" and
            "MANUAL" stayed three different things in the old sheet.
          </p>
        )}

        <p className="text-xs text-ink-500">
          A new point starts with a placeholder Daily Target of 1. The HOD sets the real target on the Targets screen — until then any score against it
          is meaningless.
        </p>
      </div>
    </Modal>
  )
}
