/**
 * Period Marks — the six KPIs that are not production.
 *
 * Five of them are one figure for a whole department (waste, variance, quality, EHS,
 * WCM & 5S); attendance is one figure per person. Both are entered here by the Office
 * Executive and read by the HOD at sign-off.
 *
 * Waste and variance are entered as the percentages they are measured in, and converted by
 * the policy tables, so nobody has to look up a mark. The converted figure is shown beside
 * the box as it is typed, which is also how a mistyped percentage gets noticed.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  attendanceMarks,
  fromHundredths,
  KPI_LABELS,
  toHundredths,
  varianceMarks,
  wasteMarks,
} from '../domain/calc'
import { formatScore } from '../domain/format'
import type { DepartmentMarks } from '../domain/types'
import { useApp } from '../store/AppStore'
import { displayName, employeesInRollup } from '../store/selectors'
import { AddPeopleDialog } from '../components/AddPeopleDialog'
import { useBulkSelection } from '../components/BulkSelect'
import { NumberColumn, useNumberColumn } from '../components/NumberColumn'
import { Badge, ConfirmDialog, EmptyState, Field, GuardedButton, Icon, InfoNote, PageHeader, PeriodBadge, Tooltip, type ConfirmConfig } from '../components/ui'

type Tab = 'department' | 'attendance' | 'totals'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'department', label: 'Department marks' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'totals', label: 'Submitted totals' },
]

export default function PeriodMarks() {
  const { period } = useApp()
  const [params, setParams] = useSearchParams()
  const requested = (params.get('tab') as Tab) ?? 'department'
  const tab = TABS.some((item) => item.id === requested) ? requested : 'department'

  return (
    <>
      <PageHeader
        title="Period Marks"
        subtitle={`${period.label} · the six KPIs that are not production`}
        actions={<PeriodBadge status={period.status} />}
      />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-ink-200">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === item.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'
            }`}
            onClick={() => {
              const copy = new URLSearchParams(params)
              copy.set('tab', item.id)
              setParams(copy, { replace: true })
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'department' && <DepartmentMarksTab />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'totals' && <SubmittedTotalsTab />}
    </>
  )
}

// ---------------------------------------------------------------------------

function DepartmentMarksTab() {
  const { state, period, allow, write } = useApp()
  const decision = allow('periodMarks.edit')
  const locked = period.status === 'Locked' || period.status === 'HOD Signed'

  const departments = state.departments.filter((d) => d.active && d.scoringMode === 'computed')

  if (departments.length === 0) {
    return (
      <div className="card">
        <EmptyState title="No department computes a KPI score" body="Departments that submit one total per employee are on the Submitted totals tab." />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <InfoNote>
        One set of marks per department per period. Everyone in the department gets them, unless somebody is given a
        per-employee override on the scorecard.
      </InfoNote>

      {departments.map((department) => (
        <DepartmentCard
          key={department.departmentId}
          departmentId={department.departmentId}
          name={department.name}
          periodId={period.periodId}
          marks={state.departmentMarks.find((m) => m.departmentId === department.departmentId && m.periodId === period.periodId)}
          disabled={!decision.allowed || locked}
          disabledReason={locked ? 'The period is closed to edits.' : decision.reason}
          onSave={(patch) => write({ kind: 'deptMarks.set', periodId: period.periodId, departmentId: department.departmentId, patch })}
        />
      ))}
    </div>
  )
}

function DepartmentCard({
  departmentId,
  name,
  periodId,
  marks,
  disabled,
  disabledReason,
  onSave,
}: {
  departmentId: string
  name: string
  periodId: string
  marks: DepartmentMarks | undefined
  disabled: boolean
  disabledReason: string
  onSave: (patch: Partial<DepartmentMarks>) => void
}) {
  const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))

  const initial = useMemo(
    () => ({
      waste: text(fromHundredths(marks?.wastePercentHundredths ?? null)),
      variancePercent: text(fromHundredths(marks?.variancePercentHundredths ?? null)),
      varianceDirect: text(marks?.varianceMarksDirect ?? null),
      quality: text(marks?.quality ?? null),
      ehs: text(marks?.ehs ?? null),
      wcm5s: text(marks?.wcm5s ?? null),
    }),
    [marks],
  )

  const [draft, setDraft] = useState(initial)
  useEffect(() => setDraft(initial), [initial, departmentId, periodId])

  const num = (value: string): number | null => {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  const wasteHundredths = toHundredths(num(draft.waste))
  const varianceHundredths = toHundredths(num(draft.variancePercent))
  const varianceDirect = num(draft.varianceDirect)

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  const save = () =>
    onSave({
      wastePercentHundredths: wasteHundredths,
      variancePercentHundredths: varianceHundredths,
      varianceMarksDirect: varianceDirect,
      quality: num(draft.quality),
      ehs: num(draft.ehs),
      wcm5s: num(draft.wcm5s),
    })

  const set = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }))

  const effectiveVariance = varianceDirect ?? varianceMarks(varianceHundredths)

  return (
    <section className="card card-pad">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">{name}</h2>
        <GuardedButton
          decision={{ allowed: !disabled, reason: disabledReason }}
          variant={dirty ? 'primary' : 'default'}
          size="sm"
          blockedReason={!dirty && !disabled ? 'Nothing has changed.' : undefined}
          onClick={save}
        >
          Save marks
        </GuardedButton>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Waste %" hint="Converted by policy table 7.2. Ties round to the worse row.">
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              className="input font-mono"
              value={draft.waste}
              disabled={disabled}
              onChange={(event) => set('waste', event.target.value)}
            />
            <MarkBadge marks={wasteMarks(wasteHundredths)} outOf={15} />
          </div>
        </Field>

        <Field label="Variance %" hint="Converted by policy table 7.1, unless marks are given below.">
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              className="input font-mono"
              value={draft.variancePercent}
              disabled={disabled || draft.varianceDirect.trim() !== ''}
              onChange={(event) => set('variancePercent', event.target.value)}
            />
            <MarkBadge marks={effectiveVariance} outOf={10} />
          </div>
        </Field>

        <Field label="Variance marks (optional)" hint="Given directly. Overrides the percentage above when filled in.">
          <input
            type="number"
            step="0.5"
            min="0"
            max="10"
            className="input font-mono"
            value={draft.varianceDirect}
            disabled={disabled}
            onChange={(event) => set('varianceDirect', event.target.value)}
          />
        </Field>

        {(['quality', 'ehs', 'wcm5s'] as const).map((key) => (
          <Field key={key} label={`${KPI_LABELS[key]} marks`} hint={`Out of ${key === 'wcm5s' ? 15 : 15}. Entered directly.`}>
            <input
              type="number"
              step="0.5"
              min="0"
              max="15"
              className="input font-mono"
              value={draft[key]}
              disabled={disabled}
              onChange={(event) => set(key, event.target.value)}
            />
          </Field>
        ))}
      </div>

      {marks && (
        <p className="mt-3 text-xs text-ink-500">
          Last saved by {marks.updatedBy} · every change is audited.
        </p>
      )}
    </section>
  )
}

function MarkBadge({ marks, outOf }: { marks: number | null; outOf: number }) {
  if (marks === null) {
    return (
      <Tooltip label="Enter a percentage and the table conversion appears here.">
        <span className="shrink-0 text-xs text-ink-400">— /{outOf}</span>
      </Tooltip>
    )
  }
  return (
    <Badge tone={marks >= outOf * 0.8 ? 'good' : marks >= outOf * 0.5 ? 'warn' : 'bad'}>
      {formatScore(marks)} /{outOf}
    </Badge>
  )
}

// ---------------------------------------------------------------------------

function AttendanceTab() {
  const { state, period, allow, write } = useApp()
  const decision = allow('periodMarks.edit')
  const locked = period.status === 'Locked' || period.status === 'HOD Signed'
  const editable = decision.allowed && !locked
  const divisor = state.settings.prorataDivisor

  const [addOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)

  const everyone = useMemo(() => employeesInRollup(state), [state])

  /**
   * The sheet is what has been added, not the whole roster — the same bargain as Daily
   * Entry, where a row exists because somebody put it there. Anybody not on it still
   * blocks sign-off, so the notice below says who is missing and offers to add them.
   */
  const onSheet = useMemo(() => {
    const ids = new Set(state.attendance.filter((a) => a.periodId === period.periodId).map((a) => a.empId))
    return everyone.filter((employee) => ids.has(employee.empId))
  }, [everyone, state.attendance, period.periodId])

  const onSheetIds = useMemo(() => new Set(onSheet.map((employee) => employee.empId)), [onSheet])
  const missing = everyone.filter((employee) => !onSheetIds.has(employee.empId))

  const initial = useMemo(() => {
    const out: Record<number, string> = {}
    for (const employee of onSheet) {
      const row = state.attendance.find((a) => a.periodId === period.periodId && a.empId === employee.empId)
      out[employee.empId] = row?.daysAbsent === null || row?.daysAbsent === undefined ? '' : String(row.daysAbsent)
    }
    return out
  }, [onSheet, state.attendance, period.periodId])

  const column = useNumberColumn(initial)
  useEffect(() => column.reset(initial), [initial])

  const selectableIds = useMemo(() => (editable ? onSheet.map((employee) => employee.empId) : []), [onSheet, editable])
  const selection = useBulkSelection(selectableIds)

  const blank = onSheet.filter((employee) => (column.draft[employee.empId] ?? '').trim() === '').length

  const addPeople = (empIds: number[]) =>
    write({ kind: 'attendance.setMany', periodId: period.periodId, rows: empIds.map((empId) => ({ empId, daysAbsent: null })) })

  const save = () => {
    const rows = column.changed.map((empId) => {
      const raw = (column.draft[empId] ?? '').trim()
      return { empId, daysAbsent: raw === '' ? null : Number(raw) }
    })
    write({ kind: 'attendance.setMany', periodId: period.periodId, rows })
  }

  return (
    <div className="space-y-3">
      <InfoNote>
        Days absent in the period, per person. Marks are <strong>(26 − days absent) ÷ 26 × 10</strong>, floored at zero.
        A blank blocks sign-off; <strong>0 is a real answer</strong> worth full marks.
      </InfoNote>

      {/* --- Anybody not on the sheet still blocks ------------------------- */}
      {missing.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border-warn-100 bg-warn-50 p-3">
          <Icon name="alert" className="h-5 w-5 shrink-0 text-warn-600" />
          <p className="min-w-0 flex-1 text-sm text-warn-700">
            <strong>
              {missing.length} {missing.length === 1 ? 'person is' : 'people are'} not on this sheet.
            </strong>{' '}
            They still need a figure before the month can be signed off.
          </p>
          <GuardedButton
            decision={{ allowed: editable, reason: locked ? 'The period is closed to edits.' : decision.reason }}
            variant="default"
            size="sm"
            onClick={() => addPeople(missing.map((employee) => employee.empId))}
          >
            <Icon name="plus" className="h-3.5 w-3.5" /> Add all {missing.length}
          </GuardedButton>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-500">
          {onSheet.length} of {everyone.length} on the sheet · {blank} still blank
        </span>
        <div className="flex flex-wrap gap-2">
          <GuardedButton
            decision={{ allowed: editable, reason: locked ? 'The period is closed to edits.' : decision.reason }}
            variant="default"
            onClick={() => setAddOpen(true)}
            blockedReason={missing.length === 0 && editable ? 'Everybody is already on the sheet.' : undefined}
          >
            <Icon name="plus" className="h-3.5 w-3.5" /> Add people
          </GuardedButton>
          <GuardedButton
            decision={{ allowed: editable, reason: locked ? 'The period is closed to edits.' : decision.reason }}
            variant={column.changed.length > 0 ? 'primary' : 'default'}
            blockedReason={column.changed.length === 0 && editable ? 'Nothing has changed.' : undefined}
            onClick={save}
          >
            <Icon name="check" className="h-3.5 w-3.5" /> Save
            {column.changed.length > 0 ? ` ${column.changed.length} change${column.changed.length === 1 ? '' : 's'}` : ' attendance'}
          </GuardedButton>
        </div>
      </div>

      <NumberColumn
        heading="Days absent"
        unit="Days absent"
        selection={editable ? selection : undefined}
        emptyTitle="Nobody on the attendance sheet yet"
        emptyBody="Add people to enter their days absent. Everybody on the incentive list needs a figure before the month can be signed off."
        bulkActions={
          <GuardedButton
            decision={{ allowed: editable, reason: decision.reason }}
            variant="bad"
            size="sm"
            onClick={() =>
              setConfirm({
                title: `Take ${selection.count} off the attendance sheet?`,
                body: (
                  <p>
                    Their days-absent figures are deleted. They stay on the incentive list and will still block sign-off
                    until somebody gives them a figure.
                  </p>
                ),
                confirmLabel: `Remove ${selection.count}`,
                variant: 'bad',
                onConfirm: () => {
                  write({ kind: 'attendance.removeMany', periodId: period.periodId, empIds: selection.selected })
                  selection.clear()
                },
              })
            }
          >
            <Icon name="trash" className="h-3.5 w-3.5" /> Remove
          </GuardedButton>
        }
        rows={onSheet.map((employee) => ({
          key: employee.empId,
          label: displayName(employee),
          sub: (() => {
            const raw = (column.draft[employee.empId] ?? '').trim()
            if (raw === '') return 'no marks until this is filled in'
            const marks = attendanceMarks(Number(raw), divisor)
            return marks === null ? 'not a valid number of days' : `${formatScore(marks)} / 10`
          })(),
        }))}
        draft={column.draft}
        onChange={(key, value) => column.setDraft((current) => ({ ...current, [key]: value }))}
        disabled={!editable}
        disabledReason={locked ? 'The period is closed to edits.' : decision.reason}
        invalid={(value) => {
          const trimmed = value.trim()
          if (trimmed === '') return null
          const parsed = Number(trimmed)
          if (!Number.isFinite(parsed) || parsed < 0) return 'Days absent cannot be negative.'
          if (parsed > divisor) return `More than the ${divisor} working days in a period — attendance marks will be zero.`
          return null
        }}
      />

      <AddPeopleDialog
        open={addOpen}
        title={`Add people to the attendance sheet — ${period.label}`}
        confirmLabel="person"
        candidates={everyone}
        alreadyOn={onSheetIds}
        onClose={() => setAddOpen(false)}
        onAdd={addPeople}
      />
      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function SubmittedTotalsTab() {
  const { state, period, allow, write } = useApp()
  const decision = allow('periodMarks.edit')
  const locked = period.status === 'Locked' || period.status === 'HOD Signed'
  const editable = decision.allowed && !locked

  const [addOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)

  const eligible = useMemo(() => {
    const submits = new Set(state.departments.filter((d) => d.scoringMode === 'submittedTotal').map((d) => d.departmentId))
    return employeesInRollup(state).filter((employee) => submits.has(employee.departmentId))
  }, [state])

  const onSheet = useMemo(() => {
    const ids = new Set(state.submittedTotals.filter((t) => t.periodId === period.periodId).map((t) => t.empId))
    return eligible.filter((employee) => ids.has(employee.empId))
  }, [eligible, state.submittedTotals, period.periodId])

  const onSheetIds = useMemo(() => new Set(onSheet.map((employee) => employee.empId)), [onSheet])
  const missing = eligible.filter((employee) => !onSheetIds.has(employee.empId))

  const initial = useMemo(() => {
    const out: Record<number, string> = {}
    for (const employee of onSheet) {
      const row = state.submittedTotals.find((t) => t.periodId === period.periodId && t.empId === employee.empId)
      out[employee.empId] = row?.total === null || row?.total === undefined ? '' : String(row.total)
    }
    return out
  }, [onSheet, state.submittedTotals, period.periodId])

  const column = useNumberColumn(initial)
  useEffect(() => column.reset(initial), [initial])

  const selectableIds = useMemo(() => (editable ? onSheet.map((employee) => employee.empId) : []), [onSheet, editable])
  const selection = useBulkSelection(selectableIds)

  if (eligible.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="Nobody is in a department that submits a total"
          body="Maintenance, Support Production and the support departments work this way. Assign people to one on the People screen and they appear here."
        />
      </div>
    )
  }

  const addPeople = (empIds: number[]) =>
    write({ kind: 'submittedTotal.setMany', periodId: period.periodId, rows: empIds.map((empId) => ({ empId, total: null })) })

  const save = () => {
    const rows = column.changed.map((empId) => {
      const raw = (column.draft[empId] ?? '').trim()
      return { empId, total: raw === '' ? null : Number(raw) }
    })
    write({ kind: 'submittedTotal.setMany', periodId: period.periodId, rows })
  }

  const blank = onSheet.filter((employee) => (column.draft[employee.empId] ?? '').trim() === '').length

  return (
    <div className="space-y-3">
      <InfoNote>
        One total out of 100 per person, for departments that do not use the KPI breakdown. It feeds Earned exactly as a
        computed total does.
      </InfoNote>

      {missing.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border-warn-100 bg-warn-50 p-3">
          <Icon name="alert" className="h-5 w-5 shrink-0 text-warn-600" />
          <p className="min-w-0 flex-1 text-sm text-warn-700">
            <strong>
              {missing.length} {missing.length === 1 ? 'person is' : 'people are'} not on this sheet.
            </strong>{' '}
            They still need a total before the month can be signed off.
          </p>
          <GuardedButton
            decision={{ allowed: editable, reason: locked ? 'The period is closed to edits.' : decision.reason }}
            variant="default"
            size="sm"
            onClick={() => addPeople(missing.map((employee) => employee.empId))}
          >
            <Icon name="plus" className="h-3.5 w-3.5" /> Add all {missing.length}
          </GuardedButton>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-500">
          {onSheet.length} of {eligible.length} on the sheet · {blank} still blank
        </span>
        <div className="flex flex-wrap gap-2">
          <GuardedButton
            decision={{ allowed: editable, reason: locked ? 'The period is closed to edits.' : decision.reason }}
            variant="default"
            onClick={() => setAddOpen(true)}
            blockedReason={missing.length === 0 && editable ? 'Everybody is already on the sheet.' : undefined}
          >
            <Icon name="plus" className="h-3.5 w-3.5" /> Add people
          </GuardedButton>
          <GuardedButton
            decision={{ allowed: editable, reason: locked ? 'The period is closed to edits.' : decision.reason }}
            variant={column.changed.length > 0 ? 'primary' : 'default'}
            blockedReason={column.changed.length === 0 && editable ? 'Nothing has changed.' : undefined}
            onClick={save}
          >
            <Icon name="check" className="h-3.5 w-3.5" /> Save totals
          </GuardedButton>
        </div>
      </div>

      <NumberColumn
        heading="Total /100"
        unit="Total /100"
        max={100}
        selection={editable ? selection : undefined}
        emptyTitle="Nobody on the totals sheet yet"
        emptyBody="Add people to enter their total out of 100."
        bulkActions={
          <GuardedButton
            decision={{ allowed: editable, reason: decision.reason }}
            variant="bad"
            size="sm"
            onClick={() =>
              setConfirm({
                title: `Take ${selection.count} off the totals sheet?`,
                body: <p>Their totals are deleted. They stay on the incentive list and will still block sign-off until somebody gives them one.</p>,
                confirmLabel: `Remove ${selection.count}`,
                variant: 'bad',
                onConfirm: () => {
                  write({ kind: 'submittedTotal.removeMany', periodId: period.periodId, empIds: selection.selected })
                  selection.clear()
                },
              })
            }
          >
            <Icon name="trash" className="h-3.5 w-3.5" /> Remove
          </GuardedButton>
        }
        rows={onSheet.map((employee) => ({
          key: employee.empId,
          label: displayName(employee),
          sub: state.departments.find((d) => d.departmentId === employee.departmentId)?.name,
        }))}
        draft={column.draft}
        onChange={(key, value) => column.setDraft((current) => ({ ...current, [key]: value }))}
        disabled={!editable}
        disabledReason={locked ? 'The period is closed to edits.' : decision.reason}
        invalid={(value) => {
          const trimmed = value.trim()
          if (trimmed === '') return null
          const parsed = Number(trimmed)
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return 'A total must be between 0 and 100.'
          return null
        }}
      />

      <AddPeopleDialog
        open={addOpen}
        title={`Add people to the totals sheet — ${period.label}`}
        confirmLabel="person"
        candidates={eligible}
        alreadyOn={onSheetIds}
        onClose={() => setAddOpen(false)}
        onAdd={addPeople}
      />
      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
