/**
 * Screen 8 — Audit Log.
 *
 * Who, when, what changed, old value, new value and the reason. A HOD sees only their own
 * Production Area; the Office Executive and the EHS Representative have no access at all.
 */

import { useMemo, useState } from 'react'
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
  const { state } = useApp()
  const [query, setQuery] = useState('')
  const [entity, setEntity] = useState<AuditEntity | 'All'>('All')
  const [actor, setActor] = useState('All')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const scoped = state.auditLog

  const actors = useMemo(() => [...new Set(scoped.map((row) => row.userId))], [scoped])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scoped.filter((row) => {
      if (entity !== 'All' && row.entity !== entity) return false
      if (actor !== 'All' && row.userId !== actor) return false
      if (!needle) return true
      return [row.field, row.oldValue, row.newValue, row.reason, row.entityId].some((value) => value.toLowerCase().includes(needle))
    })
  }, [scoped, entity, actor, query])

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
            Every create, edit, target change, override, approval and reopen. {filtered.length} of {scoped.length} rows shown.
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

          {(query || entity !== 'All' || actor !== 'All') && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setQuery('')
                setEntity('All')
                setActor('All')
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
