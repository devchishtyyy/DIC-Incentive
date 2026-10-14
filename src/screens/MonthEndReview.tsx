/**
 * Screen 6 — Month-end Review.
 *
 * The workflow from section 4: the Office Executive submits, the HOD signs or returns, the
 * Operations Manager approves or returns, and approval locks the month. Every step is
 * blocked until the one before it is done, and the checklist must be fully green before
 * the month can be submitted.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { formatDate, formatDateTime } from '../domain/dates'
import { formatScore } from '../domain/format'
import type { ApprovalStep } from '../domain/types'
import { ROLE_SHORT } from '../domain/types'
import { useApp } from '../store/AppStore'
import { checklistComplete, monthChecklist, periodHealth, scorecard, userName } from '../store/selectors'
import { hodHasSigned } from '../store/writes'
import { Badge, ConfirmDialog, EmptyState, GuardedButton, Icon, InfoNote, PageHeader, PeriodBadge, Tooltip, type ConfirmConfig } from '../components/ui'

export default function MonthEndReview() {
  const { state, user, period, today, allow, write, setPeriodId } = useApp()
  const [params] = useSearchParams()
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)

  // A deep link from the Demo Guide can switch the active period.
  const linkedPeriod = params.get('period')
  useEffect(() => {
    if (linkedPeriod && linkedPeriod !== period.periodId && state.periods.some((p) => p.periodId === linkedPeriod)) {
      setPeriodId(linkedPeriod)
    }
  }, [linkedPeriod, period.periodId, state.periods, setPeriodId])

  const signed = useMemo(() => hodHasSigned(state, period.periodId), [state, period.periodId])
  const steps = useMemo(
    () => state.approvals.filter((step) => step.periodId === period.periodId).sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [state.approvals, period.periodId],
  )

  const checklist = monthChecklist(state, period, today)
  const ready = checklistComplete(checklist)
  const health = periodHealth(state, period, today)

  const { rows } = useMemo(() => scorecard(state, period.periodId), [state, period.periodId])
  const totals = rows.map((row) => row.total).filter((total): total is number => total !== null)
  const average = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : null

  const submitDecision = allow('month.submit')
  const signDecision = allow('month.hodSign', { alreadySigned: signed })
  const opsDecision = allow('month.opsApprove')
  const reopenDecision = allow('month.reopen')

  return (
    <>
      <PageHeader
        title="Month-end Review"
        subtitle={`${period.label} · ${formatDate(period.startDate)} to ${formatDate(period.endDate)} · due ${formatDate(health.deadline)}`}
        actions={<PeriodBadge status={period.status} />}
      />

      {/* --- The four steps -------------------------------------------------- */}
      <ol className="mb-5 grid gap-2 sm:grid-cols-4">
        {[
          {
            label: '1. Entries',
            done: health.missingDays.length === 0 && health.draftRows === 0,
            note: `${health.daysWithEntries.length} of ${health.workingDays.length} working days`,
          },
          {
            label: '2. Submitted',
            done: period.status !== 'Open',
            note: period.status === 'Open' ? 'Waiting for the Office Executive' : 'Submitted to the HOD',
          },
          {
            label: '3. HOD sign-off',
            done: period.status === 'HOD Signed' || period.status === 'Locked',
            note: signed ? 'Signed' : 'Waiting for the HOD',
          },
          {
            label: '4. Ops approval',
            done: period.status === 'Locked',
            note: period.status === 'Locked' ? 'Locked — Finance can export' : 'Waiting for the Operations Manager',
          },
        ].map((step) => (
          <li key={step.label} className={`card card-pad ${step.done ? 'border-good-100 bg-good-50' : ''}`}>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
              {step.done && <Icon name="check" className="h-4 w-4 text-good-600" />}
              {step.label}
            </div>
            <p className="mt-0.5 text-xs text-ink-600">{step.note}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          {/* --- Checklist ------------------------------------------------- */}
          <section className="card card-pad">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">Checklist</h2>
                <p className="mt-0.5 text-xs text-ink-500">All of it must be green before the month can be submitted.</p>
              </div>
              <div className="text-right text-sm">
                <div className="label">Average score</div>
                <div className="font-mono text-lg tabular-nums">{formatScore(average)}</div>
              </div>
            </div>

            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-start gap-1.5 text-xs">
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${item.ok ? 'bg-good-100 text-good-700' : 'bg-bad-100 text-bad-700'}`}>
                    <Icon name={item.ok ? 'check' : 'close'} className="h-3 w-3" />
                  </span>
                  <span>
                    <span className={`font-medium ${item.ok ? 'text-ink-700' : 'text-bad-700'}`}>{item.label}</span>
                    <span className="block text-ink-500">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/scorecard" className="btn btn-default btn-sm">
                Open the scorecard
              </Link>
              <Link to="/" className="btn btn-default btn-sm">
                Open Daily Entry
              </Link>
            </div>
          </section>

          {/* --- Step history ---------------------------------------------- */}
          <section className="card overflow-hidden">
            <div className="border-b border-ink-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink-900">Step history</h2>
            </div>
            {steps.length === 0 ? (
              <EmptyState title="No steps yet" body="The history fills in as the month is submitted, signed off and approved." />
            ) : (
              <ol className="divide-y divide-ink-200">
                {steps.map((step) => (
                  <StepRow key={step.stepId} step={step} />
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* --- Actions ------------------------------------------------------ */}
        <div className="space-y-4">
          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-ink-900">Your step</h2>

            <div className="mt-3 space-y-2">
              <GuardedButton
                decision={submitDecision}
                variant="primary"
                className="w-full"
                blockedReason={!ready && submitDecision.allowed ? 'The checklist must be fully green before the month can be submitted.' : undefined}
                onClick={() =>
                  setConfirm({
                    title: `Submit ${period.label} to the HOD`,
                    body: (
                      <p>
                        {health.totalRows} rows across {health.daysWithEntries.length} working days go to the HOD for sign-off. You will not be able to
                        edit entries while the month is Submitted — only the HOD can correct a row.
                      </p>
                    ),
                    confirmLabel: 'Submit month',
                    commentLabel: 'Note for the HOD',
                    onConfirm: (comment) => write({ kind: 'month.submit', periodId: period.periodId, comment }),
                  })
                }
              >
                Submit month to HOD
              </GuardedButton>

              <GuardedButton
                decision={signDecision}
                variant="good"
                className="w-full"
                blockedReason={!ready && signDecision.allowed ? 'The checklist is not fully green yet.' : undefined}
                onClick={() =>
                  setConfirm({
                    title: `Sign off ${period.label}`,
                    body: (
                      <p>
                        You are signing off {rows.length} employees with an average Production Score of{' '}
                        <strong className="font-mono">{formatScore(average)}</strong> out of {state.settings.scoreCap}. Entries become read-only.
                      </p>
                    ),
                    confirmLabel: 'Sign off the month',
                    variant: 'good',
                    commentLabel: 'Comment',
                    onConfirm: (comment) => write({ kind: 'month.hodSign', periodId: period.periodId, decision: 'Signed', comment }),
                  })
                }
              >
                Sign off the month
              </GuardedButton>

              <GuardedButton
                decision={signDecision}
                variant="bad"
                className="w-full"
                onClick={() =>
                  setConfirm({
                    title: `Return ${period.label} to the Office Executive`,
                    body: <p>The month returns to <strong>Open</strong> and the Office Executive can correct it. Your comment is recorded.</p>,
                    confirmLabel: 'Return with comment',
                    variant: 'bad',
                    commentRequired: true,
                    commentLabel: 'What needs correcting',
                    onConfirm: (comment) => write({ kind: 'month.hodSign', periodId: period.periodId, decision: 'Returned', comment }),
                  })
                }
              >
                Return to Office Executive
              </GuardedButton>

              <GuardedButton
                decision={opsDecision}
                variant="good"
                className="w-full"
                onClick={() =>
                  setConfirm({
                    title: `Approve and lock ${period.label}`,
                    body: (
                      <p>
                        Approving locks every row in the period, makes the month read-only and releases it to Finance. Only you or the MD can reopen it
                        afterwards, with a reason.
                      </p>
                    ),
                    confirmLabel: 'Approve and lock',
                    variant: 'good',
                    commentLabel: 'Comment',
                    onConfirm: (comment) => write({ kind: 'month.opsDecision', periodId: period.periodId, decision: 'Approved', comment }),
                  })
                }
              >
                Approve month
              </GuardedButton>

              <GuardedButton
                decision={opsDecision}
                variant="bad"
                className="w-full"
                onClick={() =>
                  setConfirm({
                    title: 'Return the month to the HOD',
                    body: <p>The month goes back to Submitted and the HOD sign-off is cleared, so they must review and sign again.</p>,
                    confirmLabel: 'Return to HOD',
                    variant: 'bad',
                    commentRequired: true,
                    commentLabel: 'What the HOD needs to look at',
                    onConfirm: (comment) => write({ kind: 'month.opsDecision', periodId: period.periodId, decision: 'Returned', comment }),
                  })
                }
              >
                Return to HOD
              </GuardedButton>

              <GuardedButton
                decision={reopenDecision}
                variant="default"
                className="w-full"
                onClick={() =>
                  setConfirm({
                    title: `Reopen ${period.label}`,
                    body: <p>The month returns to Open, locked rows become editable again and the HOD is notified. The reason is audited.</p>,
                    confirmLabel: 'Reopen month',
                    commentRequired: true,
                    commentLabel: 'Reason for reopening',
                    onConfirm: (reason) => write({ kind: 'month.reopen', periodId: period.periodId, reason }),
                  })
                }
              >
                Reopen locked month
              </GuardedButton>
            </div>

            <p className="mt-3 text-[11px] text-ink-500">
              Disabled buttons explain why on hover. Signed in as {ROLE_SHORT[user.role]}.
            </p>
          </section>

          {period.status === 'Locked' && (
            <InfoNote>
              This month is locked. Finance can export it from the <Link to="/export" className="link">Export screen</Link>.
            </InfoNote>
          )}
        </div>
      </div>

      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

// ---------------------------------------------------------------------------

function StepRow({ step }: { step: ApprovalStep }) {
  const { state } = useApp()
  const tone = step.decision === 'Returned' ? 'bad' : step.decision === 'Approved' ? 'brand' : step.decision === 'Signed' ? 'good' : 'neutral'

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      <Badge tone={tone}>{step.decision}</Badge>
      <div className="min-w-0 flex-1">
        <div className="text-ink-800">
          <strong>{userName(state, step.actorUserId)}</strong> · {step.step} step
        </div>
        {step.comment && <p className="mt-0.5 text-ink-600 italic">“{step.comment}”</p>}
      </div>
      <Tooltip label={step.timestamp}>
        <span className="text-xs whitespace-nowrap text-ink-500">{formatDateTime(step.timestamp)}</span>
      </Tooltip>
    </li>
  )
}
