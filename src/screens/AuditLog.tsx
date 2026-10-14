/**
 * Screen 8 — Audit Log.
 *
 * Who, when, what changed, old value, new value and the reason. A HOD sees only their own
 * Production Area; the Office Executive and the EHS Representative have no access at all.
 */

import { useEffect, useMemo, useState } from 'react'
import { Badge, EmptyState, Icon, PageHeader } from '../components/ui'
import { formatDateTime } from '../domain/dates'
import { downloadCsv } from '../domain/exporters'
import type { AuditEntity } from '../domain/types'
import { ROLE_SHORT } from '../domain/types'
import { useApp } from '../store/AppStore'

const ENTITIES: Array<AuditEntity | 'All'> = [
  'All',
  'DailyEntry',
  'TargetRule',
  'MonthPeriod',
  'MonthOverride',
  'Employee',
  'Point',
  'Area',
  'User',
  'DayCalendar',
  'Settings',
]

const PAGE_SIZE = 50

export default function AuditLog() {
  const { state, period } = useApp()
  const [query, setQuery] = useState('')
  const [entity, setEntity] = useState<AuditEntity | 'All'>('All')
  const [actor, setActor] = useState('All')
  /**
   * The log opens on the month you are looking at, not on everything ever.
   *
   * A question about the audit trail is nearly always a question about one month-end —
   * "why is this person's September different" — and the whole log across every period
   * buries that under hundreds of rows from months nobody is asking about.
   */
  const [periodId, setPeriodId] = useState<string>(period.periodId)
  const [limit, setLimit] = useState(PAGE_SIZE)

  // Following the period picker in the top bar is what somebody expects; they changed the
  // month precisely because that is the month they now care about.
  useEffect(() => setPeriodId(period.periodId), [period.periodId])

  const scoped = state.auditLog

  const actors = useMemo(() => [...new Set(scoped.map((row) => row.userId))], [scoped])

  /** Every period that has a log row, newest first, plus the ones the app holds. */
  const periodOptions = useMemo(() => {
    const ids = new Set(scoped.map((row) => row.periodId).filter(Boolean))
    for (const candidate of state.periods) ids.add(candidate.periodId)
    return [...ids].sort((a, b) => b.localeCompare(a))
  }, [scoped, state.periods])

  const labelFor = (id: string) => state.periods.find((candidate) => candidate.periodId === id)?.label ?? id

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scoped.filter((row) => {
      if (periodId !== 'All' && row.periodId !== periodId) return false
      if (entity !== 'All' && row.entity !== entity) return false
      if (actor !== 'All' && row.userId !== actor) return false
      if (!needle) return true
      return [row.field, row.oldValue, row.newValue, row.reason, row.entityId].some((value) => value.toLowerCase().includes(needle))
    })
  }, [scoped, periodId, entity, actor, query])

  const countForPeriod = useMemo(
    () => (periodId === 'All' ? scoped.length : scoped.filter((row) => row.periodId === periodId).length),
    [scoped, periodId],
  )

  const nameOf = (userId: string) => {
    const found = state.users.find((u) => u.userId === userId)
    return found ? `${found.name} (${ROLE_SHORT[found.role]})` : userId
  }

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle={
          <span>
            Every create, edit, target change, override, approval and reopen.{' '}
            {periodId === 'All'
              ? `${filtered.length} of ${scoped.length} rows across every month.`
              : `${filtered.length} of ${countForPeriod} rows in ${labelFor(periodId)}.`}
          </span>
        }
        actions={
          <button
            type="button"
            className="btn btn-default"
            onClick={() =>
              downloadCsv('DIC-audit-log.csv', [
                ['Timestamp', 'User', 'Entity', 'Entity ID', 'Field', 'Old value', 'New value', 'Reason'],
                ...filtered.map((row) => [row.timestamp, nameOf(row.userId), row.entity, row.entityId, row.field, row.oldValue, row.newValue, row.reason]),
              ])
            }
            disabled={filtered.length === 0}
          >
            <Icon name="download" className="h-3.5 w-3.5" /> Export CSV
          </button>
        }
      />

      <div className="card card-pad mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="label" htmlFor="audit-search">
              Search
            </label>
            <div className="relative mt-1">
              <Icon name="search" className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-ink-400" />
              <input
                id="audit-search"
                className="input pl-8"
                placeholder="Field, value, reason or ID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="audit-period">
              Month
            </label>
            <select id="audit-period" className="input mt-1 w-auto" value={periodId} onChange={(event) => setPeriodId(event.target.value)}>
              <option value="All">All months</option>
              {periodOptions.map((option) => (
                <option key={option} value={option}>
                  {labelFor(option)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="audit-entity">
              Entity
            </label>
            <select id="audit-entity" className="input mt-1 w-auto" value={entity} onChange={(event) => setEntity(event.target.value as AuditEntity | 'All')}>
              {ENTITIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="audit-actor">
              User
            </label>
            <select id="audit-actor" className="input mt-1 w-auto" value={actor} onChange={(event) => setActor(event.target.value)}>
              <option value="All">All users</option>
              {actors.map((userId) => (
                <option key={userId} value={userId}>
                  {nameOf(userId)}
                </option>
              ))}
            </select>
          </div>

          {(query || entity !== 'All' || actor !== 'All' || periodId !== 'All') && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setQuery('')
                setEntity('All')
                setActor('All')
                setPeriodId('All')
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState title="No audit rows match" body="Clear the filters, or make a change in the app and it will appear here immediately." />
        ) : (
          <>
            <div className="overflow-x-auto scroll-slim">
              <table className="w-full min-w-[60rem] border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className="th w-40">When</th>
                    <th scope="col" className="th w-48">Who</th>
                    <th scope="col" className="th w-28">Entity</th>
                    <th scope="col" className="th">What changed</th>
                    <th scope="col" className="th w-32">Old value</th>
                    <th scope="col" className="th w-32">New value</th>
                    <th scope="col" className="th">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, limit).map((row) => (
                    <tr key={row.logId}>
                      <td className="td whitespace-nowrap text-ink-600">{formatDateTime(row.timestamp)}</td>
                      <td className="td">{nameOf(row.userId)}</td>
                      <td className="td">
                        <Badge tone="neutral">{row.entity}</Badge>
                      </td>
                      <td className="td">{row.field}</td>
                      <td className="td font-mono text-xs text-ink-600">{row.oldValue || '—'}</td>
                      <td className="td font-mono text-xs font-semibold">{row.newValue || '—'}</td>
                      <td className="td text-ink-600 italic">{row.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filtered.length > limit && (
              <div className="border-t border-ink-200 p-3 text-center">
                <button type="button" className="btn btn-default" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, filtered.length - limit)} more of {filtered.length - limit} remaining
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
