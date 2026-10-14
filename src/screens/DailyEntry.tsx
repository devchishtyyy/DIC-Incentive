/**
 * Screen 2 — Daily Entry.
 *
 * Edits are held in a local buffer so %age and Score update live while typing; nothing
 * reaches the store (or the audit log) until Save draft or Submit day. Tab and Enter walk
 * down the Output Batch column, which is how the Office Executive actually works.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { blocksSave, calcEmployeeDay, calcPercent, calcScore, ISSUE, openIssues, targetForDate, validateEntry, type ValidationIssue } from '../domain/calc'
import { addDays, formatDate, formatWeekday } from '../domain/dates'
import { hasRow, nextRow } from '../domain/gridNav'
import { formatBatches, formatPercent, formatScore } from '../domain/format'
import type { DailyEntry as Entry, IsoDate } from '../domain/types'
import { awaitingSapDetail } from '../data/plantMasters'
import { useApp } from '../store/AppStore'
import {
  calendarDay,
  displayName,
  employeeById,
  employeeIsActiveOn,
  employeesInScope,
  periodWorkingDays,
  pointById,
  usualPoints,
} from '../store/selectors'
import { newEntryId } from '../store/writes'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  EntryBadge,
  Field,
  GuardedButton,
  Icon,
  InfoNote,
  PageHeader,
  Tooltip,
  WarnNote,
  type ConfirmConfig,
} from '../components/ui'
import { ScoreCell } from '../components/ScoreCell'
import { PointPicker } from '../components/PointPicker'
import { AddRowsDialog, type RowPick } from '../components/AddRowsDialog'
import { NameCell } from '../components/NameCell'

type Pending = Record<string, Partial<Entry>>

export default function DailyEntry() {
  const { state, user, period, today, write, allow, pushToast, rosterSync } = useApp()
  const [params, setParams] = useSearchParams()

  const workingDays = useMemo(() => periodWorkingDays(state, period), [state, period])
  const defaultDate = useMemo(() => {
    const upToToday = workingDays.filter((date) => date <= today)
    return upToToday.length > 0 ? upToToday[upToToday.length - 1] : (workingDays[0] ?? period.startDate)
  }, [workingDays, today, period.startDate])

  const date = params.get('date') ?? defaultDate
  const setDate = (next: IsoDate) => {
    const copy = new URLSearchParams(params)
    copy.set('date', next)
    setParams(copy, { replace: true })
  }

  const [pending, setPending] = useState<Pending>({})
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Keyed by entryId, never by position: a deleted row or a changed filter would leave a
  // stale element behind in an index-based array, and focus would vanish into it.
  // One map per editable column, so Enter walks down the column the cursor is actually in.
  const actualRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const targetRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const [focusedId, setFocusedId] = useState<string | null>(null)



  const usual = useMemo(() => usualPoints(state), [state])
  const day = calendarDay(state, date)
  const inPeriod = date >= period.startDate && date <= period.endDate

  // --- Rows ---------------------------------------------------------------
  const merge = useCallback((entry: Entry): Entry => ({ ...entry, ...pending[entry.entryId] }), [pending])

  const allRowsForDate = useMemo(
    () => state.entries.filter((entry) => entry.date === date).map(merge),
    [state.entries, date, merge],
  )

  const rows = useMemo(
    () =>
      allRowsForDate
        .filter((entry) => entry.periodId === period.periodId)
        .sort((a, b) => a.empId - b.empId || a.entryId.localeCompare(b.entryId)),
    [allRowsForDate, period.periodId],
  )

  const issuesFor = useCallback(
    (entry: Entry): ValidationIssue[] =>
      validateEntry(entry, {
        sameDateEntries: allRowsForDate,
        point: pointById(state, entry.pointId) ?? null,
        employee: employeeById(state, entry.empId) ?? null,
        calendarDay: day,
        settings: state.settings,
      }),
    [allRowsForDate, state, day],
  )

  const rowViews = useMemo(
    () =>
      rows.map((entry) => {
        const issues = issuesFor(entry)
        return {
          entry,
          issues,
          open: openIssues(entry, issues),
          percent: calcPercent(entry.target, entry.actualBatches),
          score: entry.scoreOverride ?? calcScore(entry.target, entry.actualBatches, state.settings),
        }
      }),
    [rows, issuesFor, state.settings],
  )

  const pendingCount = Object.keys(pending).length
  const hasSaveBlockers = rowViews.some((row) => blocksSave(row.open))
  // "Not typed yet" is counted apart from real problems, so the tooltip says the useful thing.
  const untypedRows = rowViews.filter((row) => row.open.some((issue) => issue.code === ISSUE.ACTUAL_MISSING)).length
  const otherIssues = rowViews.reduce((sum, row) => sum + row.open.filter((issue) => issue.code !== ISSUE.ACTUAL_MISSING).length, 0)
  const openIssueCount = untypedRows + otherIssues

  const submitBlockedReason = (): string | undefined => {
    if (rows.length === 0) return 'There are no rows for this day.'
    if (rows.every((entry) => entry.status !== 'Draft')) return 'Every row for this day has already been submitted.'
    if (untypedRows > 0 && otherIssues === 0) return `${untypedRows} row(s) still have no Output Batch typed.`
    if (untypedRows > 0) return `${untypedRows} row(s) with no Output Batch, and ${otherIssues} warning(s) to resolve.`
    if (otherIssues > 0) return `${otherIssues} warning(s) must be merged or confirmed first.`
    return undefined
  }

  // Day totals
  const dayScores = useMemo(() => {
    const byEmployee = new Map<number, Entry[]>()
    for (const entry of rows) {
      const bucket = byEmployee.get(entry.empId)
      if (bucket) bucket.push(entry)
      else byEmployee.set(entry.empId, [entry])
    }
    return [...byEmployee.values()].map((bucket) => calcEmployeeDay(bucket, state.settings)).filter((s): s is number => s !== null)
  }, [rows, state.settings])

  const dayAverage = dayScores.length > 0 ? dayScores.reduce((a, b) => a + b, 0) / dayScores.length : null
  const dayBatches = rows.reduce((sum, entry) => sum + (entry.actualBatches ?? 0), 0)

  // --- Permissions --------------------------------------------------------
  // Anyone on today's sheet whose name SuccessFactors has not supplied yet.
  const unnamed = useMemo(
    () => [...new Set(rows.map((entry) => entry.empId))].filter((empId) => {
      const employee = employeeById(state, empId)
      return employee ? awaitingSapDetail(employee) : false
    }),
    [rows, state],
  )

  const editDecision = (entry: Entry) => allow('entry.edit', { entryStatus: entry.status })
  const targetDecision = allow('target.editDated')
  const canEditTarget = targetDecision.allowed
  const anyEditable = rowViews.some((row) => editDecision(row.entry).allowed)
  const saveDecision = allow('entry.edit')
  const locked = period.status === 'Locked'

  // --- Batch delete -------------------------------------------------------
  // Only Draft rows can be deleted, so only those get a tick box.
  const deletable = rowViews
    .filter((row) => allow('entry.delete', { entryStatus: row.entry.status }).allowed)
    .map((row) => row.entry.entryId)
  const deletableSet = new Set(deletable)
  const selectedIds = [...picked].filter((entryId) => deletableSet.has(entryId))
  const allDeletablePicked = deletable.length > 0 && deletable.every((entryId) => picked.has(entryId))

  const togglePick = (entryId: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })

  const deleteSelected = () => {
    const doomed = rowViews.filter((row) => selectedIds.includes(row.entry.entryId))
    setConfirm({
      title: `Delete ${doomed.length} draft row${doomed.length === 1 ? '' : 's'}?`,
      body: (
        <div className="space-y-2">
          <p>Every deletion is written to the audit log with the values it held.</p>
          <ul className="max-h-48 overflow-y-auto rounded border border-ink-200 text-xs scroll-slim">
            {doomed.map((row) => {
              const employee = employeeById(state, row.entry.empId)
              return (
                <li key={row.entry.entryId} className="flex justify-between gap-2 border-b border-ink-100 px-2 py-1 last:border-0">
                  <span>
                    {row.entry.empId} {displayName(employee, row.entry.empId)} · {pointById(state, row.entry.pointId)?.name ?? 'no point'}
                  </span>
                  <span className="font-mono text-ink-500">{formatBatches(row.entry.actualBatches)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ),
      confirmLabel: `Delete ${doomed.length} row${doomed.length === 1 ? '' : 's'}`,
      variant: 'bad',
      onConfirm: () => {
        write({ kind: 'entry.deleteMany', entryIds: selectedIds })
        setPicked(new Set())
      },
    })
  }

  // --- Editing ------------------------------------------------------------
  const patch = (entryId: string, change: Partial<Entry>) => {
    setPending((current) => ({ ...current, [entryId]: { ...current[entryId], ...change } }))
  }

  const commitAll = useCallback(() => {
    let committed = 0
    for (const [entryId, change] of Object.entries(pending)) {
      const original = state.entries.find((e) => e.entryId === entryId)
      if (!original) continue
      if ('actualBatches' in change && change.actualBatches !== original.actualBatches) {
        write({ kind: 'entry.setActual', entryId, value: change.actualBatches ?? null })
        committed += 1
      }
      // A target typed into the grid is audited like any other change; it just does not
      // stop to ask why, so a HOD can set a day's targets in one pass.
      if ('target' in change && change.target !== original.target) {
        write({ kind: 'entry.setTarget', entryId, value: change.target ?? null, reason: 'Changed on the daily sheet' })
        committed += 1
      }
      if ('pointId' in change && change.pointId !== original.pointId) {
        write({ kind: 'entry.setPoint', entryId, pointId: change.pointId ?? null })
        committed += 1
      }
      if ('empId' in change && change.empId !== original.empId) {
        write({ kind: 'entry.setEmployee', entryId, empId: change.empId! })
        committed += 1
      }
    }
    setPending({})
    return committed
  }, [pending, state.entries, write])

  const onSaveDraft = () => {
    const committed = commitAll()
    if (committed === 0) pushToast('info', 'Nothing to save — no changes are pending.')
  }

  // Keep a handle on the latest commit so the view-change effect below can call it
  // without re-running on every keystroke.
  const commitRef = useRef(commitAll)
  useEffect(() => {
    commitRef.current = commitAll
  })

  /**
   * Moving to another day, period or area saves what was typed rather than dropping it.
   * Losing half an hour of entry because the date arrow was clicked is not a trade worth
   * making for a tidier buffer.
   */
  useEffect(() => {
    const committed = commitRef.current()
    if (committed > 0) pushToast('success', `${committed} change${committed === 1 ? '' : 's'} saved before moving on.`)
    setPicked(new Set())
  }, [date, period.periodId, pushToast])

  const onSubmitDay = () => {
    if (openIssueCount > 0) {
      pushToast('error', submitBlockedReason() ?? 'This day is not ready to submit.')
      return
    }
    setConfirm({
      title: `Submit ${formatDate(date)}?`,
      body: (
        <p>
          {rows.length} rows will move from Draft to Submitted. They can still be corrected by the Office Executive or the area HOD, and every change is audited.
        </p>
      ),
      confirmLabel: 'Submit day',
      commentLabel: 'Note',
      onConfirm: () => {
        commitAll()
        write({ kind: 'day.submit', periodId: period.periodId, date })
      },
    })
  }

  /**
   * Both editable columns behave like an Excel column: Enter commits and drops to the next
   * employee, Shift+Enter goes back up, and the arrows do the same. Rows that cannot be
   * edited are skipped rather than swallowing the focus. Daily Target walks the Target
   * column and Output Batch the Batch column, so the HOD can fill in a day's targets in one
   * pass exactly the way the Executive fills in a day's output.
   */
  const focusOrder = rowViews
    .filter((row) => editDecision(row.entry).allowed)
    .map((row) => row.entry.entryId)

  // Targets are the HOD's column, and that permission does not depend on the row's status.
  const targetOrder = canEditTarget ? rowViews.map((row) => row.entry.entryId) : []

  const focusIn = (refs: React.RefObject<Map<string, HTMLInputElement>>, entryId: string) => {
    const element = refs.current.get(entryId)
    if (!element || element.disabled) return false
    element.focus()
    element.select()
    return true
  }

  const columnKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    entryId: string,
    order: string[],
    refs: React.RefObject<Map<string, HTMLInputElement>>,
  ) => {
    const step = (delta: number) => {
      const target = nextRow(order, entryId, delta)
      if (target) focusIn(refs, target)
    }

    switch (event.key) {
      case 'Enter':
      case 'ArrowDown':
      case 'ArrowUp':
        // Always swallow these: on a number input the arrows would otherwise nudge the
        // value, and at the end of the column that would silently corrupt a batch.
        event.preventDefault()
        step(event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 1)
        break
      case 'Tab': {
        // Tab walks the column too, but the end of it falls through so the grid can be left.
        const delta = event.shiftKey ? -1 : 1
        if (hasRow(order, entryId, delta)) {
          event.preventDefault()
          step(delta)
        }
        break
      }
      default:
        break
    }
  }

  // --- Add / copy ---------------------------------------------------------
  const employeesWithoutRow = useMemo(() => {
    const withRow = new Set(rows.map((entry) => entry.empId))
    return employeesInScope(state)
      .filter((employee) => !withRow.has(employee.empId))
      .filter((employee) => employeeIsActiveOn(employee, date))
  }, [rows, state, date])

  /** Adds one row or thirty through the same path, so both are audited identically. */
  const addRows = (picks: RowPick[]) => {
    const now = new Date().toISOString()
    const entries = picks
      .filter((pick) => employeeById(state, pick.empId))
      .map<Entry>((pick) => ({
        entryId: newEntryId(),
        periodId: period.periodId,
        date,
        empId: pick.empId,
        pointId: pick.pointId,
        // The target comes from the rule in force on this date, not the point default.
        target: pick.pointId ? (targetForDate(state.targetRules, pick.pointId, date)?.target ?? pointById(state, pick.pointId)?.defaultTarget ?? null) : null,
        actualBatches: null,
        scoreOverride: null,
        overrideReason: null,
        acknowledgedWarnings: [],
        status: 'Draft',
        enteredBy: user.userId,
        enteredAt: now,
        updatedBy: null,
        updatedAt: null,
      }))

    if (entries.length === 0) return
    write({ kind: 'entry.addMany', entries })
  }

  const copyPreviousDay = () => {
    const index = workingDays.indexOf(date)
    const previous = index > 0 ? workingDays[index - 1] : null
    if (!previous) {
      pushToast('error', 'There is no earlier working day in this period to copy from.')
      return
    }
    const existing = new Set(rows.map((entry) => `${entry.empId}|${entry.pointId}`))
    const source = state.entries
      .filter((entry) => entry.date === previous && entry.periodId === period.periodId)
      .filter((entry) => !existing.has(`${entry.empId}|${entry.pointId}`))
      .filter((entry) => {
        const employee = employeeById(state, entry.empId)
        return employee ? employeeIsActiveOn(employee, date) : false
      })

    const copied: Entry[] = source.map((entry) => ({
      ...entry,
      entryId: newEntryId(),
      periodId: period.periodId,
      date,
      // Targets come from the rule in force on the new date, never copied blindly.
      target: pointById(state, entry.pointId)?.defaultTarget ?? entry.target,
      actualBatches: null,
      scoreOverride: null,
      overrideReason: null,
      acknowledgedWarnings: [],
      status: 'Draft',
      enteredBy: user.userId,
      enteredAt: new Date().toISOString(),
      updatedBy: null,
      updatedAt: null,
    }))

    write({ kind: 'day.copyPrevious', periodId: period.periodId, from: previous, to: date, entries: copied })
  }

  // --- Duplicate handling -------------------------------------------------
  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, Entry[]>()
    for (const entry of rows) {
      if (!entry.pointId) continue
      const key = `${entry.empId}|${entry.pointId}`
      const bucket = groups.get(key)
      if (bucket) bucket.push(entry)
      else groups.set(key, [entry])
    }
    return [...groups.values()].filter((bucket) => bucket.length > 1)
  }, [rows])

  const navigateDay = (delta: number) => {
    const index = workingDays.indexOf(date)
    if (index === -1) {
      setDate(delta > 0 ? addDays(date, 1) : addDays(date, -1))
      return
    }
    const next = workingDays[index + delta]
    if (next) setDate(next)
  }

  // ---------------------------------------------------------------------------

  return (
    <>
      <PageHeader
        title="Daily Entry"
        subtitle={`${formatWeekday(date)} ${formatDate(date)} · ${rows.length} rows · %age and Score update as you type`}
        actions={
          <>
            <GuardedButton
              decision={saveDecision}
              variant="default"
              onClick={copyPreviousDay}
              blockedReason={locked ? 'The period is Locked.' : undefined}
            >
              Copy previous day
            </GuardedButton>
            <GuardedButton decision={saveDecision} variant="default" onClick={() => setAddOpen(true)}>
              <Icon name="plus" className="h-3.5 w-3.5" /> Add rows
            </GuardedButton>
            <GuardedButton
              decision={saveDecision}
              variant={pendingCount > 0 ? 'primary' : 'default'}
              onClick={onSaveDraft}
              blockedReason={hasSaveBlockers ? 'A row has an error that blocks Save — fix it first.' : undefined}
            >
              Save draft{pendingCount > 0 ? ` (${pendingCount})` : ''}
            </GuardedButton>
            <GuardedButton
              decision={allow('day.submit')}
              variant="good"
              onClick={onSubmitDay}
              blockedReason={submitBlockedReason()}
            >
              Submit day
            </GuardedButton>
          </>
        }
      />

      {/* --- Names have not arrived from SAP yet ----------------------------- */}
      {unnamed.length > 0 && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 border-warn-100 bg-warn-50 p-3">
          <Icon name="alert" className="h-5 w-5 shrink-0 text-warn-600" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-warn-700">
              {unnamed.length} {unnamed.length === 1 ? 'person has' : 'people have'} no name yet
            </p>
            <p className="text-xs text-warn-700">
              DIC supplied Emp IDs; names, pay grades and joining dates live in SuccessFactors. One sync fills them in by
              Emp ID — nothing else about these rows changes.
              {state.rosterSync.lastStatus === 'failed' && state.rosterSync.lastMessage
                ? ` Last sync failed: ${state.rosterSync.lastMessage}`
                : ''}
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={rosterSync.running} onClick={rosterSync.runNow}>
            {rosterSync.running ? rosterSync.message || 'Syncing…' : 'Fetch names from SAP'}
          </button>
        </div>
      )}

      {/* --- Date strip ----------------------------------------------------- */}
      <div className="card card-pad mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Date">
            <div className="flex items-center gap-1">
              <button type="button" className="btn btn-default btn-sm" onClick={() => navigateDay(-1)} aria-label="Previous working day">
                <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" />
              </button>
              <input type="date" className="input w-auto" value={date} min={period.startDate} max={period.endDate} onChange={(event) => setDate(event.target.value)} />
              <button type="button" className="btn btn-default btn-sm" onClick={() => navigateDay(1)} aria-label="Next working day">
                <Icon name="chevron" className="h-3.5 w-3.5" />
              </button>
            </div>
          </Field>

          <div className="flex flex-wrap items-center gap-2 pb-1.5 text-sm text-ink-600">
            <Badge tone="neutral">
              {formatWeekday(date)} {formatDate(date)}
            </Badge>
            {day?.isWorkingDay === false && <Badge tone="warn">Not a working day{day.note ? ` — ${day.note}` : ''}</Badge>}
            {!inPeriod && <Badge tone="bad">Outside {period.label}</Badge>}
            {locked && (
              <Badge tone="brand">
                <Icon name="lock" className="h-3 w-3" /> Period locked — read only
              </Badge>
            )}
          </div>

          <div className="ml-auto flex flex-wrap gap-4 pb-1 text-sm">
            <div>
              <div className="label">Rows</div>
              <div className="font-mono text-lg tabular-nums">{rows.length}</div>
            </div>
            <div>
              <div className="label">Output batches</div>
              <div className="font-mono text-lg tabular-nums">{formatBatches(dayBatches)}</div>
            </div>
            <div>
              <div className="label">Day average score</div>
              <div className="font-mono text-lg tabular-nums">{formatScore(dayAverage)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* --- Warnings summary ------------------------------------------------ */}
      {duplicateGroups.length > 0 && (
        <div className="mb-3">
          <WarnNote>
            <p className="font-semibold">
              {duplicateGroups.length} possible duplicate{duplicateGroups.length > 1 ? 's' : ''} on this day.
            </p>
            <p className="mt-0.5">Merge them, or confirm both are real. The day cannot be submitted until each one is resolved.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {duplicateGroups.map((group) => {
                const employee = employeeById(state, group[0].empId)
                const point = pointById(state, group[0].pointId)
                const editable = editDecision(group[0])
                return (
                  <div key={group[0].entryId} className="flex items-center gap-1.5 rounded border border-warn-100 bg-white px-2 py-1 text-xs">
                    <span>
                      {group[0].empId} {displayName(employee, group[0].empId)} · {point?.name} · {group.length} rows
                    </span>
                    <GuardedButton
                      decision={editable}
                      size="sm"
                      variant="default"
                      onClick={() =>
                        setConfirm({
                          title: 'Merge duplicate rows',
                          body: (
                            <p>
                              Keep the first row ({formatBatches(group[0].actualBatches)} batches) and remove the other {group.length - 1}. The removed
                              rows are written to the audit log with their values.
                            </p>
                          ),
                          confirmLabel: 'Merge rows',
                          onConfirm: () =>
                            write({ kind: 'entry.merge', keepId: group[0].entryId, dropIds: group.slice(1).map((e) => e.entryId) }),
                        })
                      }
                    >
                      Merge
                    </GuardedButton>
                    <GuardedButton
                      decision={editable}
                      size="sm"
                      variant="default"
                      onClick={() =>
                        setConfirm({
                          title: 'Confirm both rows are real',
                          body: <p>Both rows will count toward the day average. The confirmation is written to the audit log.</p>,
                          confirmLabel: 'Confirm both',
                          commentLabel: 'Reason',
                          onConfirm: (comment) => {
                            for (const row of group) {
                              write({ kind: 'entry.acknowledge', entryId: row.entryId, code: 'DUPLICATE_ROW', note: comment })
                            }
                          },
                        })
                      }
                    >
                      Confirm both
                    </GuardedButton>
                  </div>
                )
              })}
            </div>
          </WarnNote>
        </div>
      )}

      {/* --- Batch selection bar ----------------------------------------------- */}
      {selectedIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-800">
            {selectedIds.length} draft row{selectedIds.length === 1 ? '' : 's'} selected
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>
            Clear selection
          </button>
          <span className="ml-auto" />
          <GuardedButton decision={saveDecision} variant="bad" size="sm" onClick={deleteSelected}>
            <Icon name="trash" className="h-3.5 w-3.5" /> Delete {selectedIds.length} row{selectedIds.length === 1 ? '' : 's'}
          </GuardedButton>
        </div>
      )}

      {/* --- The grid --------------------------------------------------------- */}
      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={`No rows for ${formatDate(date)}`}
            body={
              day?.isWorkingDay === false
                ? 'This date is not a working day, so no production is expected. Sundays and declared holidays come from the day calendar.'
                : 'Copy the previous working day as a starting point, or add rows one at a time.'
            }
            action={
              <div className="flex gap-2">
                <GuardedButton decision={saveDecision} variant="default" onClick={copyPreviousDay}>
                  Copy previous day
                </GuardedButton>
                <GuardedButton decision={saveDecision} variant="primary" onClick={() => setAddOpen(true)}>
                  Add rows
                </GuardedButton>
              </div>
            }
          />
        ) : (
          <div className="overflow-x-auto scroll-slim">
            <table className="w-full min-w-[58rem] border-collapse">
              <caption className="px-3 py-1.5 text-left text-xs text-ink-500">
                Press <kbd className="rounded border border-ink-300 bg-ink-50 px-1 font-mono">Enter</kbd> in the Output Batch column to drop to the next
                employee, <kbd className="rounded border border-ink-300 bg-ink-50 px-1 font-mono">Shift</kbd> +{' '}
                <kbd className="rounded border border-ink-300 bg-ink-50 px-1 font-mono">Enter</kbd> to go back up.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="th w-10">
                    {deletable.length > 0 ? (
                      <Tooltip label={allDeletablePicked ? 'Clear the selection' : `Select all ${deletable.length} draft rows`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={allDeletablePicked}
                          onChange={() => setPicked(allDeletablePicked ? new Set() : new Set(deletable))}
                          aria-label={allDeletablePicked ? 'Clear the selection' : 'Select all draft rows'}
                        />
                      </Tooltip>
                    ) : (
                      <span className="sr-only">Selected</span>
                    )}
                  </th>
                  <th scope="col" className="th w-20">Emp ID</th>
                  <th scope="col" className="th">Employee</th>
                  <th scope="col" className="th w-56">Point</th>
                  <th scope="col" className="th w-24 text-right">Daily Target</th>
                  <th scope="col" className="th w-28 text-right">Output Batch</th>
                  <th scope="col" className="th w-24 text-right">%age</th>
                  <th scope="col" className="th w-24 text-right">Score /20</th>
                  <th scope="col" className="th w-24">Status</th>
                  <th scope="col" className="th w-10"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rowViews.map((row) => {
                  const { entry } = row
                  const employee = employeeById(state, entry.empId)
                  const canEdit = editDecision(entry)
                  const errors = row.open.filter((issue) => issue.severity === 'error')
                  const isDirty = Boolean(pending[entry.entryId])

                  return (
                    <tr
                      key={entry.entryId}
                      className={
                        focusedId === entry.entryId
                          ? 'bg-brand-100/70 ring-1 ring-brand-400 ring-inset'
                          : picked.has(entry.entryId)
                            ? 'bg-brand-50/70'
                            : isDirty
                              ? 'bg-brand-50/50'
                              : undefined
                      }
                    >
                      <td className="td">
                        {deletableSet.has(entry.entryId) ? (
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={picked.has(entry.entryId)}
                            onChange={() => togglePick(entry.entryId)}
                            aria-label={`Select the row for ${displayName(employee, entry.empId)}`}
                          />
                        ) : (
                          <Tooltip label={allow('entry.delete', { entryStatus: entry.status }).reason}>
                            <span className="block h-4 w-4" />
                          </Tooltip>
                        )}
                      </td>
                      <td className="td num text-ink-700">{entry.empId}</td>
                      <td className="td">
                        <NameCell employee={employee} empId={entry.empId} subtitle />
                      </td>
                      <td className="td">
                        <PointPicker
                          value={entry.pointId}
                          employee={employee}
                          disabled={!canEdit.allowed}
                          invalid={!entry.pointId}
                          onChange={(pointId) => patch(entry.entryId, { pointId })}
                        />
                      </td>
                      <td className="td">
                        {canEditTarget ? (
                          <input
                            ref={(element) => {
                              if (element) targetRefs.current.set(entry.entryId, element)
                              else targetRefs.current.delete(entry.entryId)
                            }}
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            className={`input py-1 text-right font-mono tabular-nums ${
                              entry.target === null || entry.target <= 0 ? 'input-error' : ''
                            }`}
                            value={entry.target ?? ''}
                            aria-label={`Daily Target for ${displayName(employee, entry.empId)}`}
                            onKeyDown={(event) => columnKeyDown(event, entry.entryId, targetOrder, targetRefs)}
                            onFocus={(event) => {
                              setFocusedId(entry.entryId)
                              event.target.select()
                            }}
                            onBlur={() => setFocusedId((current) => (current === entry.entryId ? null : current))}
                            onWheel={(event) => event.currentTarget.blur()}
                            onChange={(event) => patch(entry.entryId, { target: event.target.value === '' ? null : Number(event.target.value) })}
                          />
                        ) : (
                          <Tooltip label={targetDecision.reason}>
                            <span
                              className={`block text-right font-mono tabular-nums ${
                                entry.target === null || entry.target <= 0 ? 'font-semibold text-bad-600' : 'text-ink-700'
                              }`}
                            >
                              {entry.target ?? '—'}
                            </span>
                          </Tooltip>
                        )}
                      </td>
                      <td className="td">
                        <input
                          ref={(element) => {
                            if (element) actualRefs.current.set(entry.entryId, element)
                            else actualRefs.current.delete(entry.entryId)
                          }}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          className={`input py-1 text-right font-mono tabular-nums ${errors.some((e) => e.code.startsWith('ACTUAL')) ? 'input-error' : ''}`}
                          value={entry.actualBatches ?? ''}
                          disabled={!canEdit.allowed}
                          aria-label={`Output Batch for ${displayName(employee, entry.empId)}`}
                          onKeyDown={(event) => columnKeyDown(event, entry.entryId, focusOrder, actualRefs)}
                          onFocus={(event) => {
                            setFocusedId(entry.entryId)
                            event.target.select()
                          }}
                          onBlur={() => setFocusedId((current) => (current === entry.entryId ? null : current))}
                          // A stray scroll over a focused number input would change the batch.
                          onWheel={(event) => event.currentTarget.blur()}
                          onChange={(event) =>
                            patch(entry.entryId, { actualBatches: event.target.value === '' ? null : Number(event.target.value) })
                          }
                        />
                      </td>
                      <td className="td num text-ink-700">{formatPercent(row.percent)}</td>
                      <td className="td num">
                        <ScoreCell score={row.score} overridden={entry.scoreOverride !== null} />
                      </td>
                      <td className="td">
                        <EntryBadge status={entry.status} />
                        {isDirty && <div className="mt-0.5 text-[11px] text-brand-700">unsaved</div>}
                      </td>
                      <td className="td text-right">
                        <GuardedButton
                          decision={allow('entry.delete', { entryStatus: entry.status })}
                          variant="ghost"
                          size="sm"
                          hideWhenDenied={false}
                          onClick={() =>
                            setConfirm({
                              title: 'Delete this draft row?',
                              body: (
                                <p>
                                  {entry.empId} {displayName(employee, entry.empId)} · {pointById(state, entry.pointId)?.name ?? 'no point'} ·{' '}
                                  {formatBatches(entry.actualBatches)} batches. The deletion is written to the audit log.
                                </p>
                              ),
                              confirmLabel: 'Delete row',
                              variant: 'bad',
                              onConfirm: () => write({ kind: 'entry.delete', entryId: entry.entryId }),
                            })
                          }
                        >
                          <Icon name="trash" className="h-3.5 w-3.5" />
                          <span className="sr-only">Delete row</span>
                        </GuardedButton>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Open issues, one compact line each. "Not typed yet" is left out — the
                empty input already says it. */}
            {otherIssues > 0 && (
              <ul className="divide-y divide-ink-100 border-t border-ink-200">
                {rowViews.flatMap((row) =>
                  row.open
                    .filter((issue) => issue.code !== ISSUE.ACTUAL_MISSING)
                    .map((issue) => {
                      const employee = employeeById(state, row.entry.empId)
                      return (
                        <li key={`${row.entry.entryId}-${issue.code}`} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
                          <Icon
                            name="alert"
                            className={`h-3.5 w-3.5 shrink-0 ${issue.severity === 'error' ? 'text-bad-600' : 'text-warn-600'}`}
                          />
                          <span className="font-medium text-ink-800">
                            {row.entry.empId} {displayName(employee, row.entry.empId)}
                          </span>
                          <span className="min-w-0 flex-1 text-ink-600">{issue.message}</span>
                          {issue.acknowledgeable && (
                            <GuardedButton
                              decision={editDecision(row.entry)}
                              size="sm"
                              variant="default"
                              onClick={() =>
                                setConfirm({
                                  title: 'Confirm this row',
                                  body: <p>{issue.message}</p>,
                                  confirmLabel: 'Confirm and keep',
                                  commentLabel: 'Reason',
                                  onConfirm: (comment) =>
                                    write({ kind: 'entry.acknowledge', entryId: row.entry.entryId, code: issue.code, note: comment }),
                                })
                              }
                            >
                              Confirm
                            </GuardedButton>
                          )}
                        </li>
                      )
                    }),
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* --- Employees with no row -------------------------------------------- */}
      {anyEditable && employeesWithoutRow.length > 0 && (
        <div className="card card-pad mt-4">
          <h2 className="text-sm font-semibold text-ink-900">
            {employeesWithoutRow.length} employee{employeesWithoutRow.length > 1 ? 's' : ''} with no row today
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">Add one only if they worked — a missing day is not a zero.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {employeesWithoutRow.map((employee) => (
              <button
                key={employee.empId}
                type="button"
                className="btn btn-default btn-sm"
                onClick={() => addRows([{ empId: employee.empId, pointId: usual.get(employee.empId) ?? null }])}
              >
                <Icon name="plus" className="h-3 w-3" />
                {employee.empId} {displayName(employee)}
              </button>
            ))}
          </div>
        </div>
      )}

      {!anyEditable && rows.length > 0 && (
        <div className="mt-4">
          <InfoNote>
            {locked
              ? 'This period is locked. Entries are read-only until the Operations Manager or MD reopens the month with a reason.'
              : saveDecision.reason || 'You have view-only access to these entries.'}
          </InfoNote>
        </div>
      )}

      {/* --- Dialogs ----------------------------------------------------------- */}
      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
      <AddRowsDialog open={addOpen} date={date} existingRows={rows} onClose={() => setAddOpen(false)} onAdd={addRows} />
    </>
  )
}


