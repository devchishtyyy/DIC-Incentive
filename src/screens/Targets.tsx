/**
 * Screen 3 — Targets.
 *
 * Points with their default Daily Target, plus the HOD's dated changes.
 *
 * The default is typed straight into the column, the way Output Batch is typed on the daily
 * sheet — Enter drops to the next Point, nothing is written until Save. A standing target is
 * not an exception to anything, so it is not worth a modal and a reason each time; the audit
 * row records the before and after regardless.
 *
 * A *dated* change is an exception, and policy section 5 names the ones allowed — order
 * inflow, order volume, a stock-taking day, machine downtime — so that one still asks why.
 *
 * A dated change only rewrites rows in a period that is still Open or Submitted. A locked
 * or signed-off day keeps the target it was actually scored with.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { TARGET_CHANGE_REASONS } from '../config/policy'
import { targetForDate } from '../domain/calc'
import { formatDate } from '../domain/dates'
import type { Point, TargetRule } from '../domain/types'
import { useApp } from '../store/AppStore'
import { hasRow, nextRow } from '../domain/gridNav'
import { userName } from '../store/selectors'
import { Badge, ConfirmDialog, EmptyState, Field, GuardedButton, Icon, Modal, PageHeader, Tooltip, type ConfirmConfig } from '../components/ui'

export default function Targets() {
  const { state, period, today, allow, write, pushToast } = useApp()
  const [editing, setEditing] = useState<Point | null>(null)
  const [historyFor, setHistoryFor] = useState<Point | null>(null)
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)

  const points = useMemo(
    () =>
      state.points
        .filter((point) => point.active)
        .sort((a, b) => Number(a.defaultTargetSet) - Number(b.defaultTargetSet) || a.name.localeCompare(b.name)),
    [state],
  )

  const datedRules = useMemo(
    () => state.targetRules.filter((rule) => rule.effectiveTo !== null).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    [state.targetRules],
  )

  const inPeriodRules = datedRules.filter((rule) => rule.effectiveFrom <= period.endDate && rule.effectiveTo! >= period.startDate)

  // --- The default-target column ------------------------------------------
  //
  // Typed in place, exactly like Output Batch on the daily sheet: Enter drops to the next
  // Point, and nothing is written until Save. A default is the standing figure for a Point
  // rather than an exception to it, so it does not stop to ask why — the audit row records
  // the before and after regardless. Dated changes, which *are* exceptions, still do.
  const defaultDecision = allow('target.editDefault')
  const defaultRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  // A target changed elsewhere (or a Point added) should not leave a stale box behind.
  useEffect(() => setDrafts({}), [state.points])

  const draftValue = (point: Point) => drafts[point.pointId] ?? String(point.defaultTarget)

  const changed = points.filter((point) => {
    const typed = drafts[point.pointId]
    if (typed === undefined || typed.trim() === '') return false
    const value = Number(typed)
    return Number.isFinite(value) && value > 0 && value !== point.defaultTarget
  })
  const dirtyCount = changed.length
  const unsetCount = points.filter((point) => !point.defaultTargetSet).length

  const saveDefaults = () => {
    if (dirtyCount === 0) return
    for (const point of changed) {
      write({ kind: 'target.setDefault', pointId: point.pointId, target: Number(drafts[point.pointId]), reason: 'Default target set' })
    }
    setDrafts({})
    pushToast('success', `${dirtyCount} default target${dirtyCount === 1 ? '' : 's'} saved.`)
  }

  const defaultOrder = points.map((point) => point.pointId)

  const onDefaultKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, pointId: string) => {
    const step = (delta: number) => {
      const next = nextRow(defaultOrder, pointId, delta)
      const element = next ? defaultRefs.current.get(next) : undefined
      if (element) {
        element.focus()
        element.select()
      }
    }

    switch (event.key) {
      case 'Enter':
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        step(event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 1)
        break
      case 'Tab': {
        const delta = event.shiftKey ? -1 : 1
        if (hasRow(defaultOrder, pointId, delta)) {
          event.preventDefault()
          step(delta)
        }
        break
      }
      default:
        break
    }
  }

  return (
    <>
      <PageHeader
        title="Targets"
        subtitle="The Daily Target each Point is scored against. Type a default straight into the column; a change for particular dates still records why."
        actions={
          <GuardedButton
            decision={defaultDecision}
            variant={dirtyCount > 0 ? 'primary' : 'default'}
            onClick={saveDefaults}
            blockedReason={dirtyCount === 0 ? 'Nothing has changed yet.' : undefined}
          >
            Save {dirtyCount > 0 ? `${dirtyCount} target${dirtyCount === 1 ? '' : 's'}` : 'targets'}
          </GuardedButton>
        }
      />

      {unsetCount > 0 && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 border-warn-100 bg-warn-50 p-3">
          <Icon name="alert" className="h-5 w-5 shrink-0 text-warn-600" />
          <p className="min-w-0 flex-1 text-sm text-warn-700">
            <strong>{unsetCount} of {points.length} Points still carry a placeholder target of 1.</strong> Every score on those
            Points is meaningless until the real figure is in. Type down the Default target column — Enter moves to the next
            Point — then Save.
          </p>
        </div>
      )}

      {/* --- Point master ---------------------------------------------------- */}
      <div className="card mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink-800">Points and default targets</h2>
          <span className="text-xs text-ink-500">{points.length} active points</span>
        </div>

        {points.length === 0 ? (
          <EmptyState title="No points in this area" body="Add points on the Master Data screen." />
        ) : (
          <div className="overflow-x-auto scroll-slim">
            <table className="w-full min-w-[46rem] border-collapse">
              <thead>
                <tr>
                  <th scope="col" className="th">Point</th>
                  <th scope="col" className="th w-28 text-right">Default target</th>
                  <th scope="col" className="th w-40 text-right">Target today ({formatDate(today)})</th>
                  <th scope="col" className="th w-32">Dated changes</th>
                  <th scope="col" className="th w-44 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => {
                  const effective = targetForDate(state.targetRules, point.pointId, today)
                  const changed = effective && effective.target !== point.defaultTarget
                  const ownRules = datedRules.filter((rule) => rule.pointId === point.pointId)
                  const decision = allow('target.editDated')

                  return (
                    <tr key={point.pointId}>
                      <td className="td font-medium text-ink-900">
                        {point.name}
                        {!point.defaultTargetSet && (
                          <Tooltip label="This is the shipped placeholder, not a real target.">
                            <span className="ml-1.5 text-xs font-normal text-warn-700">· not set</span>
                          </Tooltip>
                        )}
                      </td>
                      <td className="td">
                        {defaultDecision.allowed ? (
                          <input
                            ref={(element) => {
                              if (element) defaultRefs.current.set(point.pointId, element)
                              else defaultRefs.current.delete(point.pointId)
                            }}
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            className={`input py-1 text-right font-mono tabular-nums ${
                              draftValue(point) !== '' && !(Number(draftValue(point)) > 0) ? 'input-error' : ''
                            }`}
                            value={draftValue(point)}
                            aria-label={`Default target for ${point.name}`}
                            onKeyDown={(event) => onDefaultKeyDown(event, point.pointId)}
                            onFocus={(event) => event.target.select()}
                            onWheel={(event) => event.currentTarget.blur()}
                            onChange={(event) => setDrafts((current) => ({ ...current, [point.pointId]: event.target.value }))}
                          />
                        ) : (
                          <Tooltip label={defaultDecision.reason}>
                            <span className="block text-right font-mono tabular-nums text-ink-700">{point.defaultTarget}</span>
                          </Tooltip>
                        )}
                      </td>
                      <td className="td num">
                        {changed ? (
                          <Tooltip label={`${effective.reason} — set by ${userName(state, (effective as TargetRule).changedBy ?? '')}`}>
                            <Badge tone="warn">{effective.target}</Badge>
                          </Tooltip>
                        ) : (
                          <span className="text-ink-600">{effective?.target ?? point.defaultTarget}</span>
                        )}
                      </td>
                      <td className="td">
                        {ownRules.length === 0 ? (
                          <span className="text-xs text-ink-400">None</span>
                        ) : (
                          <button type="button" className="link text-xs" onClick={() => setHistoryFor(point)}>
                            {ownRules.length} change{ownRules.length > 1 ? 's' : ''}
                          </button>
                        )}
                      </td>
                      <td className="td text-right">
                        <GuardedButton decision={decision} size="sm" variant="default" onClick={() => setEditing(point)}>
                          Set target for dates
                        </GuardedButton>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- Change history --------------------------------------------------- */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink-800">Target changes in {period.label}</h2>
          <span className="text-xs text-ink-500">{inPeriodRules.length} change(s)</span>
        </div>

        {inPeriodRules.length === 0 ? (
          <EmptyState title="No dated target changes in this period" body="Default targets applied on every working day." />
        ) : (
          <div className="overflow-x-auto scroll-slim">
            <table className="w-full min-w-[46rem] border-collapse">
              <thead>
                <tr>
                  <th scope="col" className="th">Point</th>
                  <th scope="col" className="th w-56">Dates</th>
                  <th scope="col" className="th w-24 text-right">Target</th>
                  <th scope="col" className="th w-40">Reason</th>
                  <th scope="col" className="th w-40">Changed by</th>
                  <th scope="col" className="th w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {inPeriodRules.map((rule) => {
                  const point = state.points.find((p) => p.pointId === rule.pointId)
                  const decision = allow('target.editDated')
                  return (
                    <tr key={rule.ruleId}>
                      <td className="td font-medium">{point?.name ?? rule.pointId}</td>
                      <td className="td">
                        {formatDate(rule.effectiveFrom)}
                        {rule.effectiveTo && rule.effectiveTo !== rule.effectiveFrom ? ` to ${formatDate(rule.effectiveTo)}` : ''}
                      </td>
                      <td className="td num">{rule.target}</td>
                      <td className="td">
                        <Badge tone="warn">{rule.reason}</Badge>
                      </td>
                      <td className="td text-ink-600">{userName(state, rule.changedBy)}</td>
                      <td className="td text-right">
                        <GuardedButton
                          decision={decision}
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setConfirm({
                              title: 'Remove this dated target?',
                              body: (
                                <p>
                                  {point?.name} returns to its default target of {point?.defaultTarget} for{' '}
                                  {formatDate(rule.effectiveFrom)}
                                  {rule.effectiveTo && rule.effectiveTo !== rule.effectiveFrom ? ` to ${formatDate(rule.effectiveTo)}` : ''}. Rows
                                  already scored keep the target they were scored with.
                                </p>
                              ),
                              confirmLabel: 'Remove',
                              variant: 'bad',
                              onConfirm: () => write({ kind: 'target.deleteRule', ruleId: rule.ruleId }),
                            })
                          }
                        >
                          <Icon name="trash" className="h-3.5 w-3.5" />
                          <span className="sr-only">Remove dated target</span>
                        </GuardedButton>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SetTargetDialog point={editing} onClose={() => setEditing(null)} />
      <HistoryDialog point={historyFor} onClose={() => setHistoryFor(null)} />
      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

// ---------------------------------------------------------------------------

function SetTargetDialog({ point, onClose }: { point: Point | null; onClose: () => void }) {
  const { state, period, write } = useApp()
  const [from, setFrom] = useState(period.startDate)
  const [to, setTo] = useState(period.startDate)
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState<string>(TARGET_CHANGE_REASONS[0])
  const [note, setNote] = useState('')

  const open = point !== null
  const value = Number(target)
  const validTarget = target !== '' && Number.isFinite(value) && value > 0
  const validRange = from <= to
  const needsNote = reason === 'Other'
  const ready = validTarget && validRange && (!needsNote || note.trim().length > 2)

  // Rows that would be rewritten — a locked or HOD-signed period is never touched.
  const affected = state.entries.filter(
    (entry) =>
      point &&
      entry.pointId === point.pointId &&
      entry.date >= from &&
      entry.date <= to &&
      entry.status !== 'Locked' &&
      ['Open', 'Submitted'].includes(state.periods.find((p) => p.periodId === entry.periodId)?.status ?? ''),
  ).length

  const frozen = state.entries.filter(
    (entry) =>
      point &&
      entry.pointId === point.pointId &&
      entry.date >= from &&
      entry.date <= to &&
      (entry.status === 'Locked' || !['Open', 'Submitted'].includes(state.periods.find((p) => p.periodId === entry.periodId)?.status ?? '')),
  ).length

  return (
    <Modal
      open={open}
      title={point ? `Set the Daily Target for ${point.name}` : ''}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <Tooltip
            label={
              !validTarget
                ? 'The target must be greater than zero.'
                : !validRange
                  ? 'The end date must be on or after the start date.'
                  : needsNote && note.trim().length < 3
                    ? 'Describe the reason.'
                    : ''
            }
          >
            <button
              type="button"
              className="btn btn-primary"
              disabled={!ready}
              onClick={() => {
                write({
                  kind: 'target.setDated',
                  pointId: point!.pointId,
                  from,
                  to,
                  target: value,
                  reason: needsNote ? `Other — ${note.trim()}` : reason,
                })
                onClose()
              }}
            >
              Set target
            </button>
          </Tooltip>
        </>
      }
    >
      {point && (
        <div className="space-y-3">
          <p className="text-sm text-ink-600">Default target {point.defaultTarget}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From">
              <input type="date" className="input" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="To">
              <input type="date" className="input" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>

          <Field label="Daily Target">
            <input type="number" min="0.01" step="0.01" className="input" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={String(point.defaultTarget)} />
          </Field>

          <Field label="Reason (required by policy section 5)">
            <select className="input" value={reason} onChange={(event) => setReason(event.target.value)}>
              {TARGET_CHANGE_REASONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          {needsNote && (
            <Field label="Describe the reason">
              <input className="input" value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          )}

          <div className="rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-600">
            <p>
              <strong>{affected}</strong> open row(s) in that range will pick up the new target.
            </p>
            {frozen > 0 && (
              <p className="mt-1">
                <strong>{frozen}</strong> row(s) are locked or already signed off and keep the target they were scored with. Reopen the month to change
                them.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function HistoryDialog({ point, onClose }: { point: Point | null; onClose: () => void }) {
  const { state } = useApp()
  if (!point) return null

  const rules = state.targetRules
    .filter((rule) => rule.pointId === point.pointId)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.changedAt.localeCompare(a.changedAt))

  return (
    <Modal open title={`Target history — ${point.name}`} onClose={onClose} width="max-w-2xl">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="th">Effective</th>
            <th className="th w-20 text-right">Target</th>
            <th className="th w-36">Reason</th>
            <th className="th w-36">Changed by</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.ruleId}>
              <td className="td">
                {formatDate(rule.effectiveFrom)}
                {rule.effectiveTo ? ` to ${formatDate(rule.effectiveTo)}` : ' onwards'}
              </td>
              <td className="td num">{rule.target}</td>
              <td className="td">
                <Badge tone={rule.reason === 'Default' ? 'neutral' : 'warn'}>{rule.reason}</Badge>
              </td>
              <td className="td text-ink-600">{userName(state, rule.changedBy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-ink-500">A row keeps the target it was scored with — a later rule change never rewrites history.</p>
    </Modal>
  )
}
