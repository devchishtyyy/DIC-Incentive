/**
 * People — the SAP directory, the incentive list, and the master data behind them.
 *
 * The SAP directory is the master data: everyone SuccessFactors knows about, kept apart
 * from the incentive list. The Admin picks from it, which proposes those people to the MD
 * (policy section 10) — nobody reaches the incentive list without that approval.
 *
 * The Admin and the MD both come here and see different tabs: the Admin proposes people,
 * the MD approves them. Every list uses the same selection pattern as the Daily Entry
 * grid — a tick box per row, a tick-all covering only the eligible rows, and a bar saying
 * what will happen.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { formatDate, formatWeekday } from '../domain/dates'
import type { AppState, Department, Employee, Point, User } from '../domain/types'
import { ROLE_LABELS, type RoleId } from '../domain/types'
import { GRADES } from '../data/masters'
import { useApp } from '../store/AppStore'
import { displayName, periodWorkingDays } from '../store/selectors'
import { BulkBar, SelectAllCell, SelectCell, useBulkSelection } from '../components/BulkSelect'
import { NameCell } from '../components/NameCell'
import SapImport from './SapImport'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  Field,
  GuardedButton,
  Icon,
  InfoNote,
  Modal,
  PageHeader,
  Tooltip,
  type ConfirmConfig,
} from '../components/ui'

/** A Point's name for display, falling back to its id if it has been deleted. */
function pointName(state: AppState, pointId: string): string {
  return state.points.find((point) => point.pointId === pointId)?.name ?? pointId
}

type Tab = 'directory' | 'employees' | 'departments' | 'import' | 'points' | 'users' | 'calendar'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'directory', label: 'SAP directory' },
  { id: 'employees', label: 'Incentive list' },
  { id: 'departments', label: 'Departments' },
  { id: 'import', label: 'Sync from SAP' },
  { id: 'points', label: 'Points' },
  { id: 'users', label: 'Users' },
  { id: 'calendar', label: 'Day calendar' },
]

export default function People() {
  const { allow } = useApp()
  const [params, setParams] = useSearchParams()

  const canManage = allow('masterdata.manage').allowed
  const tabs = TABS.filter((item) => canManage || item.id === 'employees')
  const requested = (params.get('tab') as Tab) ?? tabs[0].id
  const tab = tabs.some((item) => item.id === requested) ? requested : tabs[0].id
  const setTab = (next: Tab) => {
    const copy = new URLSearchParams(params)
    copy.set('tab', next)
    setParams(copy, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="People"
        subtitle={
          canManage
            ? 'The SAP directory is master data. Pick who belongs on the incentive list; the MD approves them.'
            : 'Approve who joins the incentive list.'
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-ink-200">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === item.id ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-ink-600 hover:text-ink-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'directory' && <DirectoryTab />}
      {tab === 'employees' && <EmployeesTab />}
      {tab === 'import' && <SapImport />}
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'points' && <PointsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'calendar' && <CalendarTab />}
    </>
  )
}

// ---------------------------------------------------------------------------

function useSearch<T>(items: T[], matches: (item: T, needle: string) => boolean) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const filtered = needle ? items.filter((item) => matches(item, needle)) : items

  const box = (
    <div className="relative">
      <Icon name="search" className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-ink-400" />
      <input className="input w-56 pl-8" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search" />
    </div>
  )

  return { filtered, box }
}

// ---------------------------------------------------------------------------
// The SAP directory — master data, and where the incentive list is drawn from
// ---------------------------------------------------------------------------

function DirectoryTab() {
  const { state, allow, write } = useApp()
  const decision = allow('masterdata.manage')
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)

  const onList = useMemo(() => new Set(state.employees.map((employee) => employee.empId)), [state.employees])
  const { filtered, box } = useSearch(
    state.directory,
    (entry, needle) => String(entry.empId).includes(needle) || entry.name.toLowerCase().includes(needle),
  )

  // Only people not already on the incentive list can be added.
  const eligible = useMemo(() => filtered.filter((entry) => !onList.has(entry.empId)).map((entry) => entry.empId), [filtered, onList])
  const selection = useBulkSelection(eligible)

  return (
    <>
      <InfoNote>
        This is what SAP holds — <strong>{state.directory.length} people</strong>, refreshed by the weekly sync. Nobody here is scored or paid anything.
        Pick the ones who belong on the incentive list and the MD approves them (policy section 10).
      </InfoNote>

      <div className="my-3 flex flex-wrap items-center justify-between gap-2">
        {box}
        <span className="text-xs text-ink-500">
          {filtered.length} shown · {onList.size} already on the incentive list
        </span>
      </div>

      <BulkBar selection={selection} noun="person">
        <GuardedButton
          decision={decision}
          variant="primary"
          size="sm"
          onClick={() =>
            setConfirm({
              title: `Send ${selection.count} to the MD for approval?`,
              body: (
                <div className="space-y-2">
                  <p>
                    They join the incentive list as <strong>Pending MD approval</strong> and stay out of the monthly roll-up until the MD approves them.
                  </p>
                  <ul className="max-h-48 overflow-y-auto rounded border border-ink-200 text-xs scroll-slim">
                    {selection.selected.map((empId) => {
                      const entry = state.directory.find((item) => item.empId === empId)
                      return (
                        <li key={empId} className="border-b border-ink-100 px-2 py-1 last:border-0">
                          <span className="font-mono tabular-nums">{empId}</span> · {displayName(entry)}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ),
              confirmLabel: `Send ${selection.count} for approval`,
              onConfirm: () => {
                write({ kind: 'employee.addFromDirectory', empIds: selection.selected })
                selection.clear()
              },
            })
          }
        >
          <Icon name="plus" className="h-3.5 w-3.5" /> Add to the incentive list
        </GuardedButton>
      </BulkBar>

      <div className="card overflow-hidden">
        {state.directory.length === 0 ? (
          <EmptyState
            title="The directory is empty"
            body="Run a sync from SAP and everyone SuccessFactors knows about will appear here, ready to be picked."
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="Nobody matches that search" body="Clear the search to see the whole directory." />
        ) : (
          <div className="max-h-[60vh] overflow-auto scroll-slim">
            <table className="w-full min-w-[56rem] border-collapse">
              <thead>
                <tr>
                  <SelectAllCell selection={selection} label={`Select all ${eligible.length} not yet on the list`} />
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-24">Emp ID</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50">Name</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-28">Pay grade</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-24">Site</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-28">Joined</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50">Points</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-32">On the list</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const employee = state.employees.find((item) => item.empId === entry.empId)
                  return (
                    <tr key={entry.empId} className={selection.isSelected(entry.empId) ? 'bg-brand-50/60' : undefined}>
                      <SelectCell
                        selection={selection}
                        itemKey={entry.empId}
                        label={`Select ${entry.empId} ${entry.name}`}
                        blockedReason={employee ? 'Already on the incentive list.' : undefined}
                      />
                      <td className="td num">{entry.empId}</td>
                      <td className="td font-medium">{displayName(entry)}</td>
                      <td className="td text-ink-600">{entry.grade}</td>
                      <td className="td text-ink-600">{entry.site}</td>
                      <td className="td text-ink-600">{entry.joinDate ? formatDate(entry.joinDate) : '—'}</td>
                      <td className="td text-xs text-ink-600">
                        {entry.pointIds.length === 0 ? (
                          <span className="text-warn-700">none on file</span>
                        ) : (
                          entry.pointIds.map((id) => pointName(state, id)).join(', ')
                        )}
                      </td>
                      <td className="td">
                        {!employee ? (
                          <span className="text-xs text-ink-400">—</span>
                        ) : employee.incentiveListStatus === 'Approved' ? (
                          <Badge tone="good">Approved</Badge>
                        ) : (
                          <Badge tone="warn">Pending MD</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// The incentive list itself
// ---------------------------------------------------------------------------

function EmployeesTab() {
  const { state, period, allow, write } = useApp()
  const decision = allow('masterdata.manage')
  const approveDecision = allow('employee.approveAdd')
  const reviewDecision = allow('override.review')

  const pending = useMemo(
    () => state.employees.filter((employee) => employee.incentiveListStatus === 'Pending MD approval'),
    [state.employees],
  )
  const pendingIds = useMemo(() => pending.map((employee) => employee.empId), [pending])
  const pendingSelection = useBulkSelection(pendingIds)

  // Somebody with no Point cannot be posted for at all, so it is worth saying out loud
  // rather than leaving them to be discovered missing from the Add row dialog.
  const withoutPoints = useMemo(
    () => state.employees.filter((employee) => employee.active && employee.pointIds.length === 0),
    [state.employees],
  )

  const overrides = state.monthOverrides.filter((override) => override.periodId === period.periodId)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)

  const entryCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const entry of state.entries) counts.set(entry.empId, (counts.get(entry.empId) ?? 0) + 1)
    return counts
  }, [state.entries])

  const { filtered, box } = useSearch(
    state.employees,
    (employee, needle) => String(employee.empId).includes(needle) || employee.name.toLowerCase().includes(needle),
  )

  const active = useMemo(() => filtered.filter((employee) => employee.active).map((employee) => employee.empId), [filtered])
  const selection = useBulkSelection(active)

  return (
    <>
      {/* --- Waiting for the MD ------------------------------------------- */}
      {pending.length > 0 && (
        <div className="card mb-4 overflow-hidden border-warn-100">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warn-100 bg-warn-50 px-4 py-2.5">
            <div>
              <h2 className="text-sm font-semibold text-warn-700">{pending.length} waiting for MD approval</h2>
              <p className="mt-0.5 text-xs text-warn-700">Policy section 10. Excluded from the roll-up until approved.</p>
            </div>
            <GuardedButton
              decision={approveDecision}
              variant="good"
              size="sm"
              onClick={() =>
                setConfirm({
                  title: `Approve all ${pending.length} for the incentive list`,
                  body: <p>Everyone waiting is approved at once and starts counting in the monthly roll-up. Each approval is audited separately.</p>,
                  confirmLabel: `Approve all ${pending.length}`,
                  variant: 'good',
                  commentLabel: 'Comment',
                  onConfirm: (comment) => {
                    write({ kind: 'employee.approveAdd', empIds: pending.map((employee) => employee.empId), comment })
                    pendingSelection.clear()
                  },
                })
              }
            >
              <Icon name="check" className="h-3.5 w-3.5" /> Approve all {pending.length}
            </GuardedButton>
          </div>

          <div className="px-4 pt-3">
            <BulkBar selection={pendingSelection} noun="person">
              <GuardedButton
                decision={approveDecision}
                variant="good"
                size="sm"
                onClick={() =>
                  setConfirm({
                    title: `Approve ${pendingSelection.count} for the incentive list`,
                    body: <p>They start counting in the monthly roll-up from now on. Each approval is audited separately.</p>,
                    confirmLabel: `Approve ${pendingSelection.count}`,
                    variant: 'good',
                    commentLabel: 'Comment',
                    onConfirm: (comment) => {
                      write({ kind: 'employee.approveAdd', empIds: pendingSelection.selected, comment })
                      pendingSelection.clear()
                    },
                  })
                }
              >
                <Icon name="check" className="h-3.5 w-3.5" /> Approve
              </GuardedButton>
            </BulkBar>
          </div>

          <div className="max-h-[22rem] overflow-auto scroll-slim">
            <table className="w-full min-w-[40rem] border-collapse">
              <thead>
                <tr>
                  <SelectAllCell selection={pendingSelection} label={`Select all ${pending.length} waiting`} />
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-20">Emp ID</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50">Name</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-28">Pay grade</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-28">Joined</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50">Points</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((employee) => (
                  <tr key={employee.empId} className={pendingSelection.isSelected(employee.empId) ? 'bg-brand-50/60' : undefined}>
                    <SelectCell selection={pendingSelection} itemKey={employee.empId} label={`Select ${employee.empId} ${employee.name}`} />
                    <td className="td num">{employee.empId}</td>
                    <td className="td">
                      <NameCell employee={employee} empId={employee.empId} />
                    </td>
                    <td className="td text-ink-600">{employee.grade}</td>
                    <td className="td text-ink-600">{employee.joinDate ? formatDate(employee.joinDate) : '—'}</td>
                    <td className="td text-xs text-ink-600">
                      {employee.pointIds.length === 0 ? (
                        <Badge tone="warn">No Point yet</Badge>
                      ) : (
                        employee.pointIds.map((id) => pointName(state, id)).join(', ')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- Nobody can be posted for without a Point ---------------------- */}
      {withoutPoints.length > 0 && (
        <InfoNote tone="warn">
          {withoutPoints.length} {withoutPoints.length === 1 ? 'person has' : 'people have'} no Point assigned —{' '}
          <span className="font-mono">{withoutPoints.map((employee) => employee.empId).join(', ')}</span>. They cannot be entered against a Daily
          Target until the HOD or an executive gives them one, on this screen under Edit.
        </InfoNote>
      )}

      {/* --- Full-marks awards the MD reviews ------------------------------ */}
      {overrides.length > 0 && (
        <div className="card mb-4 overflow-hidden">
          <div className="border-b border-ink-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink-800">Full-marks awards in {period.label}</h2>
            <p className="mt-0.5 text-xs text-ink-500">Awarded by the HOD for extraordinary performance. The MD reviews each one.</p>
          </div>
          <ul className="divide-y divide-ink-200">
            {overrides.map((override) => (
              <li key={override.overrideId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium text-ink-900">
                    <span className="font-mono tabular-nums">{override.empId}</span> ·{' '}
                    {displayName(state.employees.find((e) => e.empId === override.empId), override.empId)} — score set to {override.score}
                  </div>
                  <p className="text-xs text-ink-600 italic">{override.reason}</p>
                </div>
                {override.mdReviewed ? (
                  <Badge tone="good">Reviewed</Badge>
                ) : (
                  <GuardedButton
                    decision={reviewDecision}
                    variant="default"
                    size="sm"
                    onClick={() => write({ kind: 'month.reviewOverride', overrideId: override.overrideId })}
                  >
                    Mark as reviewed
                  </GuardedButton>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {box}
        <span className="text-xs text-ink-500">
          {state.employees.filter((e) => e.incentiveListStatus === 'Approved').length} approved · {pending.length} waiting for the MD
        </span>
      </div>

      <BulkBar selection={selection} noun="employee">
        <GuardedButton
          decision={decision}
          variant="bad"
          size="sm"
          onClick={() =>
            setConfirm({
              title: `Deactivate ${selection.count} employees?`,
              body: (
                <p>
                  They stop appearing on the entry screen and in the roll-up. Their existing entries are kept, so history and locked months are
                  unaffected.
                </p>
              ),
              confirmLabel: `Deactivate ${selection.count}`,
              variant: 'bad',
              commentRequired: true,
              commentLabel: 'Reason',
              onConfirm: (reason) => {
                for (const empId of selection.selected) write({ kind: 'employee.setActive', empId, active: false, reason })
                selection.clear()
              },
            })
          }
        >
          <Icon name="trash" className="h-3.5 w-3.5" /> Deactivate
        </GuardedButton>

        <GuardedButton
          decision={decision}
          variant="default"
          size="sm"
          onClick={() =>
            setConfirm({
              title: `Mark ${selection.count} as not measured on output`,
              body: (
                <p>
                  They take the <strong>department average</strong> as their Production Score instead of their own rows.
                  This is for people whose job has no measured output — not for a month somebody happened to post nothing.
                </p>
              ),
              confirmLabel: `Use department average for ${selection.count}`,
              commentRequired: true,
              commentLabel: 'Why their output is not measured',
              onConfirm: (reason) => {
                write({ kind: 'employee.setOutputNotMeasured', empIds: selection.selected, value: true, reason })
                selection.clear()
              },
            })
          }
        >
          Use department average
        </GuardedButton>

        <GuardedButton
          decision={decision}
          variant="default"
          size="sm"
          onClick={() =>
            setConfirm({
              title: `Score ${selection.count} on their own output`,
              body: <p>They go back to being scored on their own production rows, and a period with no rows will block sign-off.</p>,
              confirmLabel: 'Score on own output',
              commentRequired: true,
              commentLabel: 'Reason',
              onConfirm: (reason) => {
                write({ kind: 'employee.setOutputNotMeasured', empIds: selection.selected, value: false, reason })
                selection.clear()
              },
            })
          }
        >
          Score on own output
        </GuardedButton>
      </BulkBar>

      <div className="card overflow-hidden">
        {state.employees.length === 0 ? (
          <EmptyState title="Nobody on the incentive list yet" body="Pick people from the SAP directory and the MD approves them." />
        ) : (
          <div className="max-h-[60vh] overflow-auto scroll-slim">
            <table className="w-full min-w-[58rem] border-collapse">
              <thead>
                <tr>
                  <SelectAllCell selection={selection} label={`Select all ${active.length} active`} />
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-20">Emp ID</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50">Name</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-28">Pay grade</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-24">Site</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-40">Department</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-28">Scored on</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-28">Status</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-32">Incentive list</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-20 text-right">Entries</th>
                  <th scope="col" className="th sticky top-0 bg-ink-50 w-24 text-right">Edit</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((employee) => (
                  <tr
                    key={employee.empId}
                    className={employee.active ? (selection.isSelected(employee.empId) ? 'bg-brand-50/60' : undefined) : 'opacity-55'}
                  >
                    <SelectCell
                      selection={selection}
                      itemKey={employee.empId}
                      label={`Select ${employee.empId} ${employee.name}`}
                      blockedReason={employee.active ? undefined : 'Already deactivated.'}
                    />
                    <td className="td num">{employee.empId}</td>
                    <td className="td">
                      <NameCell employee={employee} empId={employee.empId} />
                    </td>
                    <td className="td text-ink-600">{employee.grade || '—'}</td>
                    <td className="td text-ink-600">
                      {state.departments.find((d) => d.departmentId === employee.departmentId)?.name ?? '—'}
                    </td>
                    <td className="td">
                      {employee.outputNotMeasured ? (
                        <Tooltip label="Takes the department average instead of their own production rows.">
                          <Badge tone="neutral">Dept average</Badge>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-ink-500">Own output</span>
                      )}
                    </td>
                    <td className="td">
                      <Badge tone={employee.status === 'Active' ? 'good' : employee.status === 'Probation' ? 'warn' : 'neutral'}>
                        {employee.status}
                      </Badge>
                    </td>
                    <td className="td">
                      {employee.incentiveListStatus === 'Approved' ? <Badge tone="good">Approved</Badge> : <Badge tone="warn">Pending MD</Badge>}
                    </td>
                    <td className="td num text-ink-600">{entryCounts.get(employee.empId) ?? 0}</td>
                    <td className="td text-right">
                      <GuardedButton decision={decision} size="sm" variant="default" onClick={() => setEditing(employee)}>
                        Edit
                      </GuardedButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EmployeeDialog employee={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

function EmployeeDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const { state, write } = useApp()
  const [draft, setDraft] = useState<Employee | null>(null)

  useEffect(() => setDraft(employee), [employee])
  if (!employee || !draft) return null

  const set = (change: Partial<Employee>) => setDraft({ ...draft, ...change })
  const togglePoint = (pointId: string) =>
    set({ pointIds: draft.pointIds.includes(pointId) ? draft.pointIds.filter((id) => id !== pointId) : [...draft.pointIds, pointId] })

  return (
    <Modal
      open
      title={`Edit ${displayName(employee)}`}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <Tooltip label={draft.name.trim().length < 2 ? 'A name is required.' : ''}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={draft.name.trim().length < 2}
              onClick={() => {
                write({ kind: 'employee.upsert', employee: { ...draft, name: draft.name.trim() }, isNew: false })
                if (draft.pointIds.join() !== employee.pointIds.join()) {
                  write({ kind: 'employee.setPoints', empId: draft.empId, pointIds: draft.pointIds })
                }
                onClose()
              }}
            >
              Save changes
            </button>
          </Tooltip>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Emp ID" hint="The key, and what the Employee KPI sheet expects.">
          <input className="input" value={draft.empId} disabled />
        </Field>
        <Field label="Name">
          <input className="input" value={draft.name} onChange={(event) => set({ name: event.target.value })} />
        </Field>
        <Field label="Pay grade">
          <select className="input" value={draft.grade} onChange={(event) => set({ grade: event.target.value })}>
            <option value={draft.grade}>{draft.grade}</option>
            {GRADES.filter((grade) => grade.grade !== draft.grade).map((grade) => (
              <option key={grade.grade} value={grade.grade}>
                {grade.grade} (band {grade.band})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Site">
          <select className="input" value={draft.site} onChange={(event) => set({ site: event.target.value as Employee['site'] })}>
            {(['Kasur', 'Karachi', 'Inplant'] as const).map((site) => (
              <option key={site} value={site}>
                {site}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role" hint="Everyone imports as an Operator; promote the few who supervise.">
          <select className="input" value={draft.role} onChange={(event) => set({ role: event.target.value as Employee['role'] })}>
            <option value="Operator">Operator</option>
            <option value="Supervisor">Supervisor</option>
          </select>
        </Field>
        <Field label="Status" hint="SAP has no probation flag — set it here.">
          <select className="input" value={draft.status} onChange={(event) => set({ status: event.target.value as Employee['status'] })}>
            <option value="Active">Active</option>
            <option value="Probation">Probation</option>
            <option value="Left">Left</option>
          </select>
        </Field>
        <Field label="Joining date">
          <input type="date" className="input" value={draft.joinDate} onChange={(event) => set({ joinDate: event.target.value })} />
        </Field>

        <Field label="Department" hint="Decides whose marks apply and which rate column pays them.">
          <select
            className="input"
            value={draft.departmentId}
            onChange={(event) => set({ departmentId: event.target.value })}
          >
            {state.departments
              .filter((department) => department.active)
              .map((department) => (
                <option key={department.departmentId} value={department.departmentId}>
                  {department.name} · {department.rateGroup}
                </option>
              ))}
          </select>
        </Field>

        <Field
          label="Production Score"
          hint="Somebody whose job has no measured output takes the department average. Never set this to cover a month where entries were simply missed."
        >
          <label className="flex items-center gap-2 text-sm text-ink-800">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={draft.outputNotMeasured}
              onChange={(event) => set({ outputNotMeasured: event.target.checked })}
            />
            Output not measured — use the department average
          </label>
        </Field>
        <Field label="Leaving date" hint="Leave blank while in service.">
          <input type="date" className="input" value={draft.leaveDate ?? ''} onChange={(event) => set({ leaveDate: event.target.value || null })} />
        </Field>
      </div>

      <div className="mt-4">
        <span className="label">Points they work</span>
        <div className="mt-1 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-ink-200 p-2 scroll-slim">
          {state.points
            .filter((point) => point.active)
            .map((point) => (
              <label
                key={point.pointId}
                className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                  draft.pointIds.includes(point.pointId) ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-600'
                }`}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={draft.pointIds.includes(point.pointId)}
                  onChange={() => togglePoint(point.pointId)}
                />
                {point.name}
              </label>
            ))}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function PointsTab() {
  const { state, allow, write } = useApp()
  const decision = allow('masterdata.manage')
  const [editing, setEditing] = useState<Point | null>(null)
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of state.entries) if (entry.pointId) map.set(entry.pointId, (map.get(entry.pointId) ?? 0) + 1)
    return map
  }, [state.entries])

  const { filtered, box } = useSearch(state.points, (point, needle) => point.name.toLowerCase().includes(needle))
  const active = useMemo(() => filtered.filter((point) => point.active).map((point) => point.pointId), [filtered])
  const selection = useBulkSelection(active)

  const unset = state.points.filter((point) => point.active && !point.defaultTargetSet).length

  return (
    <>
      {unset > 0 && (
        <InfoNote>
          <strong>{unset} points still have a placeholder Daily Target of 1.</strong> Any score against them is meaningless until the real target is set
          here or on the Targets screen.
        </InfoNote>
      )}

      <div className="my-3 flex flex-wrap items-center justify-between gap-2">
        {box}
        <GuardedButton
          decision={decision}
          variant="primary"
          onClick={() => setEditing({ pointId: '', name: '', defaultTarget: 1, defaultTargetSet: false, active: true })}
        >
          <Icon name="plus" className="h-3.5 w-3.5" /> Add point
        </GuardedButton>
      </div>

      <BulkBar selection={selection} noun="point">
        <GuardedButton
          decision={decision}
          variant="bad"
          size="sm"
          onClick={() =>
            setConfirm({
              title: `Deactivate ${selection.count} points?`,
              body: <p>They disappear from the entry dropdowns. Existing rows keep them, so nothing is lost.</p>,
              confirmLabel: `Deactivate ${selection.count}`,
              variant: 'bad',
              onConfirm: () => {
                for (const pointId of selection.selected) write({ kind: 'point.setActive', pointId, active: false })
                selection.clear()
              },
            })
          }
        >
          <Icon name="trash" className="h-3.5 w-3.5" /> Deactivate
        </GuardedButton>
      </BulkBar>

      <div className="card overflow-hidden">
        <div className="max-h-[60vh] overflow-auto scroll-slim">
          <table className="w-full min-w-[42rem] border-collapse">
            <thead>
              <tr>
                <SelectAllCell selection={selection} label={`Select all ${active.length} active`} />
                <th scope="col" className="th sticky top-0 bg-ink-50">Point</th>
                <th scope="col" className="th sticky top-0 bg-ink-50 w-40 text-right">Default target</th>
                <th scope="col" className="th sticky top-0 bg-ink-50 w-24 text-right">Entries</th>
                <th scope="col" className="th sticky top-0 bg-ink-50 w-24">Status</th>
                <th scope="col" className="th sticky top-0 bg-ink-50 w-24 text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((point) => (
                <tr
                  key={point.pointId}
                  className={point.active ? (selection.isSelected(point.pointId) ? 'bg-brand-50/60' : undefined) : 'opacity-55'}
                >
                  <SelectCell
                    selection={selection}
                    itemKey={point.pointId}
                    label={`Select ${point.name}`}
                    blockedReason={point.active ? undefined : 'Already deactivated.'}
                  />
                  <td className="td font-medium">
                    {point.name}
                    {point.createdOnTheFloor && (
                      <Tooltip label="Typed in on the Daily Entry screen">
                        <Badge tone="neutral" className="ml-1.5">
                          added on the floor
                        </Badge>
                      </Tooltip>
                    )}
                  </td>
                  <td className="td num">
                    {point.defaultTarget}
                    {!point.defaultTargetSet && (
                      <Tooltip label="Still the placeholder — the real target has not been set.">
                        <Badge tone="warn" className="ml-1.5">
                          not set
                        </Badge>
                      </Tooltip>
                    )}
                  </td>
                  <td className="td num text-ink-600">{counts.get(point.pointId) ?? 0}</td>
                  <td className="td">{point.active ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
                  <td className="td text-right">
                    <GuardedButton decision={decision} size="sm" variant="default" onClick={() => setEditing(point)}>
                      Edit
                    </GuardedButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PointDialog point={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

function PointDialog({ point, onClose }: { point: Point | null; onClose: () => void }) {
  const { write } = useApp()
  const [draft, setDraft] = useState<Point | null>(null)

  useEffect(() => setDraft(point), [point])
  if (!point || !draft) return null

  const isNew = point.pointId === ''
  const valid = draft.name.trim().length > 1 && draft.defaultTarget > 0

  return (
    <Modal
      open
      title={isNew ? 'Add a point' : `Edit ${point.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <Tooltip label={valid ? '' : 'A name and a target greater than zero are required.'}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!valid}
              onClick={() => {
                if (isNew) {
                  write({ kind: 'point.create', name: draft.name.trim() })
                } else {
                  if (draft.defaultTarget !== point.defaultTarget) {
                    write({ kind: 'target.setDefault', pointId: point.pointId, target: draft.defaultTarget, reason: 'Set in Master Data' })
                  }
                  write({ kind: 'point.upsert', point: { ...draft, name: draft.name.trim(), defaultTargetSet: true }, isNew: false })
                }
                onClose()
              }}
            >
              {isNew ? 'Add point' : 'Save changes'}
            </button>
          </Tooltip>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </Field>
        {!isNew && (
          <Field label="Default Daily Target" hint="The HOD can still change it for a specific date on the Targets screen.">
            <input
              type="number"
              min="0.01"
              step="0.01"
              className="input"
              value={draft.defaultTarget}
              onChange={(event) => setDraft({ ...draft, defaultTarget: Number(event.target.value) })}
            />
          </Field>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function UsersTab() {
  const { state, allow, write } = useApp()
  const decision = allow('masterdata.manage')
  const [editing, setEditing] = useState<{ user: User; isNew: boolean } | null>(null)

  return (
    <>
      <div className="mb-3 flex justify-end">
        <GuardedButton
          decision={decision}
          variant="primary"
          onClick={() =>
            setEditing({ user: { userId: `U-NEW-${Date.now().toString(36).toUpperCase()}`, name: '', role: 'OFFICE_EXEC' }, isNew: true })
          }
        >
          <Icon name="plus" className="h-3.5 w-3.5" /> Add user
        </GuardedButton>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className="th">Name</th>
              <th scope="col" className="th w-56">Role</th>
              <th scope="col" className="th w-28 text-right">Edit</th>
            </tr>
          </thead>
          <tbody>
            {state.users.map((user) => (
              <tr key={user.userId}>
                <td className="td font-medium">{user.name}</td>
                <td className="td text-ink-600">{ROLE_LABELS[user.role]}</td>
                <td className="td text-right">
                  <GuardedButton decision={decision} size="sm" variant="default" onClick={() => setEditing({ user, isNew: false })}>
                    Edit
                  </GuardedButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserDialog
          user={editing.user}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={(user) => {
            write({ kind: 'user.upsert', user, isNew: editing.isNew })
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function UserDialog({ user, isNew, onClose, onSave }: { user: User; isNew: boolean; onClose: () => void; onSave: (user: User) => void }) {
  const [draft, setDraft] = useState(user)

  return (
    <Modal
      open
      title={isNew ? 'Add a user' : `Edit ${user.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <Tooltip label={draft.name.trim().length < 2 ? 'A name is required.' : ''}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={draft.name.trim().length < 2}
              onClick={() => onSave({ ...draft, name: draft.name.trim() })}
            >
              {isNew ? 'Add user' : 'Save changes'}
            </button>
          </Tooltip>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </Field>
        <Field label="Role">
          <select className="input" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as RoleId })}>
            {(Object.keys(ROLE_LABELS) as RoleId[]).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function CalendarTab() {
  const { state, period, allow, write } = useApp()
  const decision = allow('masterdata.manage')
  const [note, setNote] = useState<Record<string, string>>({})

  const days = state.calendar.filter((day) => day.date >= period.startDate && day.date <= period.endDate)
  const workingDays = periodWorkingDays(state, period)

  if (days.length === 0) {
    return (
      <div className="card">
        <EmptyState title="No calendar days in this period" body="Pick another period in the top bar." />
      </div>
    )
  }

  return (
    <>
      <InfoNote>
        {workingDays.length} working days in {period.label}. Sundays and declared holidays are non-working.
      </InfoNote>

      <div className="card mt-3 overflow-hidden">
        <div className="max-h-[60vh] overflow-auto scroll-slim">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className="th sticky top-0 bg-ink-50 w-32">Date</th>
                <th scope="col" className="th sticky top-0 bg-ink-50 w-20">Day</th>
                <th scope="col" className="th sticky top-0 bg-ink-50 w-32">Working day</th>
                <th scope="col" className="th sticky top-0 bg-ink-50">Note</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date} className={day.isWorkingDay ? undefined : 'bg-ink-50'}>
                  <td className="td font-mono tabular-nums">{formatDate(day.date)}</td>
                  <td className="td text-ink-600">{formatWeekday(day.date)}</td>
                  <td className="td">
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={day.isWorkingDay}
                        disabled={!decision.allowed}
                        onChange={(event) =>
                          write({ kind: 'calendar.set', date: day.date, isWorkingDay: event.target.checked, note: note[day.date] ?? day.note })
                        }
                      />
                      {day.isWorkingDay ? 'Working' : 'Non-working'}
                    </label>
                  </td>
                  <td className="td">
                    <input
                      className="input py-1"
                      value={note[day.date] ?? day.note}
                      disabled={!decision.allowed}
                      aria-label={`Note for ${day.date}`}
                      onChange={(event) => setNote((current) => ({ ...current, [day.date]: event.target.value }))}
                      onBlur={(event) => {
                        if (event.target.value !== day.note) {
                          write({ kind: 'calendar.set', date: day.date, isWorkingDay: day.isWorkingDay, note: event.target.value })
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

/**
 * A department decides two things: whose marks apply to you, and which column of the rate
 * table pays you. Changing the scoring mode changes where a whole department's total comes
 * from, so it says plainly what each mode means rather than leaving two words to guess at.
 */
function DepartmentsTab() {
  const { state, allow, write } = useApp()
  const decision = allow('masterdata.manage')

  const headcount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const employee of state.employees) {
      counts.set(employee.departmentId, (counts.get(employee.departmentId) ?? 0) + 1)
    }
    return counts
  }, [state.employees])

  return (
    <>
      <InfoNote>
        <strong>Computed</strong> builds a total out of the seven KPIs. <strong>Submitted total</strong> takes one figure
        out of 100 per person, entered on Period Marks — Maintenance and the support departments work that way. The rate
        group picks the Production or Support column out of the rate table.
      </InfoNote>

      <div className="card mt-3 overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className="th">Department</th>
              <th scope="col" className="th w-36">Rate group</th>
              <th scope="col" className="th w-48">Scored by</th>
              <th scope="col" className="th w-24 text-right">People</th>
              <th scope="col" className="th w-24">Active</th>
            </tr>
          </thead>
          <tbody>
            {state.departments.map((department) => (
              <tr key={department.departmentId} className={department.active ? undefined : 'opacity-55'}>
                <td className="td font-medium text-ink-900">{department.name}</td>
                <td className="td">
                  <select
                    className="input py-1 text-xs"
                    value={department.rateGroup}
                    disabled={!decision.allowed}
                    onChange={(event) =>
                      write({
                        kind: 'department.upsert',
                        department: { ...department, rateGroup: event.target.value as Department['rateGroup'] },
                        isNew: false,
                      })
                    }
                  >
                    <option value="Production">Production</option>
                    <option value="Support">Support</option>
                  </select>
                </td>
                <td className="td">
                  <select
                    className="input py-1 text-xs"
                    value={department.scoringMode}
                    disabled={!decision.allowed}
                    onChange={(event) =>
                      write({
                        kind: 'department.upsert',
                        department: { ...department, scoringMode: event.target.value as Department['scoringMode'] },
                        isNew: false,
                      })
                    }
                  >
                    <option value="computed">Computed from the 7 KPIs</option>
                    <option value="submittedTotal">Submitted total /100</option>
                  </select>
                </td>
                <td className="td num text-ink-600">{headcount.get(department.departmentId) ?? 0}</td>
                <td className="td">
                  {department.active ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
