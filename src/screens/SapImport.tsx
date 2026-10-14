/**
 * Master Data → Import. Loads the employee roster from a SAP SuccessFactors OData
 * `User` response.
 *
 * Nothing about the mapping is hard-coded: the screen reads whatever fields the payload
 * actually contains, guesses the mapping, shows the guess for confirmation, and previews
 * every row — including the ones it cannot resolve — before a single employee is written.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  distinctValues,
  EMPTY_MAPPING,
  mapSapUsers,
  mappingIsComplete,
  parseSapPayload,
  suggestMapping,
  type FieldMapping,
  type ParsedPayload,
  type SapUser,
} from '../data/sapImport'
import type { Site } from '../domain/types'
import { formatDate } from '../domain/dates'
import { useApp } from '../store/AppStore'
import { fetchRoster, fetchStatus, SapError, type FetchProgress, type SapStatus } from '../data/sapClient'
import { Badge, ErrorNote, Field, GuardedButton, Icon, InfoNote, PageHeader, Tooltip, WarnNote } from '../components/ui'

const SITES: Site[] = ['Kasur', 'Karachi', 'Inplant']

export default function SapImport() {
  const { state, allow, write } = useApp()
  // Whether a live sync is possible is the server's answer, not something the browser can
  // work out — it holds no credentials to check. Until it replies, assume the live tab.
  const [status, setStatus] = useState<SapStatus | null>(null)
  const canFetchLive = status?.configured ?? true
  const [source, setSource] = useState<'live' | 'file'>('live')
  const [progress, setProgress] = useState<FetchProgress | null>(null)
  const [fetchError, setFetchError] = useState<{ message: string; detail: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedPayload | null>(null)
  const [mapping, setMapping] = useState<FieldMapping>(EMPTY_MAPPING)
  const fileRef = useRef<HTMLInputElement>(null)

  const decision = allow('masterdata.manage')

  useEffect(() => {
    const abort = new AbortController()
    void fetchStatus(abort.signal).then((result) => {
      setStatus(result)
      if (!result.configured) setSource('file')
    })
    return () => abort.abort()
  }, [])

  const load = (raw: string) => {
    setText(raw)
    const result = parseSapPayload(raw)
    setParsed(result)
    if (result.users.length > 0) {
      setMapping(suggestMapping(result.fields))
    }
  }

  const runFetch = () => {
    setBusy(true)
    setFetchError(null)
    setProgress({ stage: 'assertion', message: 'Starting…', count: 0 })

    fetchRoster(setProgress)
      .then((users) => {
        // Straight into the same parse → map → preview path a dropped file takes.
        load(JSON.stringify({ d: { results: users } }))
        if (users.length === 0) {
          setFetchError({
            message: 'The call succeeded but matched no users.',
            detail: status
              ? `No active user has an Emp ID between ${status.range.fromUserId} and ${status.range.toUserId}.`
              : 'No active user matched the configured Emp ID range.',
          })
        }
      })
      .catch((error: unknown) => {
        setProgress(null)
        if (error instanceof SapError) setFetchError({ message: error.message, detail: error.detail })
        else setFetchError({ message: 'The fetch failed.', detail: String(error) })
      })
      .finally(() => setBusy(false))
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    void file.text().then(load)
  }

  const result = useMemo(
    () => (parsed && parsed.users.length > 0 ? mapSapUsers(parsed.users, mapping) : null),
    [parsed, mapping],
  )

  const siteOptions = useMemo(() => distinctValues(parsed?.users ?? [], mapping.siteField), [parsed, mapping.siteField])

  const ready = result !== null && result.mapped.length > 0 && mappingIsComplete(mapping)

  const doImport = () => {
    if (!result) return
    // The scheduled sync has nobody to confirm a mapping, so it reuses this one.
    write({ kind: 'sync.saveMapping', mapping })
    write({
      kind: 'directory.sync',
      entries: result.mapped.map(({ employee }) => ({
        empId: employee.empId,
        sapUserId: employee.sapUserId,
        name: employee.name,
        grade: employee.grade,
        site: employee.site,
        joinDate: employee.joinDate,
        pointIds: employee.pointIds,
        syncedAt: new Date().toISOString(),
      })),
      source: 'Synced from SAP SuccessFactors (OData User)',
    })
    setText('')
    setParsed(null)
  }

  return (
    <>
      <PageHeader
        title="Sync the directory from SAP"
        subtitle="SuccessFactors OData v2 — the User entity. Nothing is written until the mapping below is confirmed."
      />

      {/* --- Step 1: get the data ----------------------------------------- */}
      <section className="card mb-4 overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-ink-200 px-3 pt-2">
          {(
            [
              ['live', 'Fetch from SAP'],
              ['file', 'Load a file'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSource(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                source === id ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-ink-600 hover:text-ink-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {source === 'live' ? (
          <div className="card-pad">
            {!canFetchLive && (
              <div className="mb-3">
                <WarnNote>
                  {status?.reason ||
                    'The server has no SAP credentials configured. Put them in .env.local as SF_CLIENT_ID, SF_COMPANY_ID, SF_USER_ID and SF_PRIVATE_KEY, then restart the dev server.'}
                </WarnNote>
              </div>
            )}

            <p className="text-sm text-ink-600">
              The server signs a SAML assertion, exchanges it for an access token and reads the User entity with that token as a
              bearer. All three steps happen in Node.
            </p>
            <p className="mt-1 text-xs text-ink-500">
              The browser never sees the client ID or the signing key — that key can mint an assertion for any user in the tenant,
              so it stays on the server. This page just asks for the finished list.
            </p>

            {status?.configured && (
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex justify-between gap-3 border-b border-ink-100 py-1">
                  <dt className="text-ink-500">Tenant</dt>
                  <dd className="font-mono text-ink-800">{status.apiServer}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-ink-100 py-1">
                  <dt className="text-ink-500">Emp ID range</dt>
                  <dd className="font-mono text-ink-800">
                    {status.range.fromUserId} – {status.range.toUserId}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-ink-100 py-1">
                  <dt className="text-ink-500">Credentials</dt>
                  <dd className="text-good-700">Held on the server</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-ink-100 py-1">
                  <dt className="text-ink-500">Runs</dt>
                  <dd className="text-ink-800">On every app start, plus the weekly slot</dd>
                </div>
              </dl>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <GuardedButton
                decision={decision}
                variant="primary"
                onClick={runFetch}
                blockedReason={busy ? 'Fetching…' : !canFetchLive ? status?.reason || 'The server has no SAP credentials.' : undefined}
              >
                <Icon name="download" className="h-3.5 w-3.5" /> Fetch from SAP
              </GuardedButton>

              {progress && (
                <span className="flex items-center gap-1.5 text-sm text-ink-600">
                  {progress.stage !== 'done' && (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                  )}
                  {progress.message}
                </span>
              )}
            </div>

            {fetchError && (
              <div className="mt-3">
                <ErrorNote>
                  <p className="font-semibold">{fetchError.message}</p>
                  {fetchError.detail && <p className="mt-1 font-mono text-[11px] break-all">{fetchError.detail}</p>}
                </ErrorNote>
              </div>
            )}
          </div>
        ) : (
          <div className="card-pad">
            <p className="text-xs text-ink-500">
              For a built copy with no dev proxy. Run the script in <code className="font-mono">tools/</code> to produce{' '}
              <code className="font-mono">sap-users.json</code>, then load it here.
            </p>

            <div
              className="mt-2 rounded-md border-2 border-dashed border-ink-300 p-4 text-center"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                onFile(event.dataTransfer.files[0])
              }}
            >
              <p className="text-sm text-ink-600">Drop the JSON file here</p>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json,.txt"
                className="hidden"
                onChange={(event) => onFile(event.target.files?.[0])}
              />
              <button type="button" className="btn btn-default mt-2" onClick={() => fileRef.current?.click()}>
                Choose a file
              </button>
            </div>

            <Field label="Or paste the JSON" hint="The raw response, exactly as the API returned it.">
              <textarea
                className="input mt-1 min-h-24 font-mono text-xs"
                value={text}
                onChange={(event) => load(event.target.value)}
                placeholder='{"d":{"results":[{"userId":"40000001" }]}}'
              />
            </Field>
          </div>
        )}

        {parsed?.error && (
          <div className="px-4 pb-3">
            <ErrorNote>{parsed.error}</ErrorNote>
          </div>
        )}

        {parsed && parsed.users.length > 0 && (
          <p className="px-4 pb-3 text-sm text-good-700">
            Read {parsed.users.length} user{parsed.users.length === 1 ? '' : 's'} with {parsed.fields.length} fields.
          </p>
        )}
      </section>

      {/* --- Step 3: confirm the mapping ---------------------------------- */}
      {parsed && parsed.users.length > 0 && result && (
        <>
          <section className="card card-pad mb-4">
            <h2 className="text-sm font-semibold text-ink-900">2. Confirm the mapping</h2>
            <p className="mt-1 text-xs text-ink-500">
              Emp ID, name, joining date, pay grade and site come out of the User entity. <strong>Production Area is not imported</strong> — it is
              derived from the Points each employee works, so it follows the assignment list rather than SAP. Everyone arrives as an{' '}
              <strong>Operator</strong>, because the job title does not reliably say who supervises.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MapField label="Emp ID" required value={mapping.empId} fields={parsed.fields} onChange={(v) => setMapping({ ...mapping, empId: v })} />
              <MapField label="First name" value={mapping.firstName} fields={parsed.fields} onChange={(v) => setMapping({ ...mapping, firstName: v })} />
              <MapField label="Last name" value={mapping.lastName} fields={parsed.fields} onChange={(v) => setMapping({ ...mapping, lastName: v })} />
              <MapField label="Full name (fallback)" value={mapping.fullName} fields={parsed.fields} onChange={(v) => setMapping({ ...mapping, fullName: v })} />
              <MapField label="Joining date" value={mapping.hireDate} fields={parsed.fields} onChange={(v) => setMapping({ ...mapping, hireDate: v })} />
              <MapField label="Pay grade" value={mapping.gradeField} fields={parsed.fields} onChange={(v) => setMapping({ ...mapping, gradeField: v })} />
              <MapField label="Site" value={mapping.siteField} fields={parsed.fields} onChange={(v) => setMapping({ ...mapping, siteField: v, siteValues: {} })} />
            </div>

            {/* Value lookups */}
            {siteOptions.length > 0 && (
              <div className="mt-4">
                <h3 className="label">Site — {siteOptions.length} distinct value(s) in the payload</h3>
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  {siteOptions.map((value) => (
                    <label key={value} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-700" title={value}>
                        {value}
                      </span>
                      <Icon name="chevron" className="h-3 w-3 shrink-0 text-ink-400" />
                      <select
                        className="input w-40 py-1"
                        value={mapping.siteValues[value] ?? ''}
                        onChange={(event) =>
                          setMapping({ ...mapping, siteValues: { ...mapping.siteValues, [value]: event.target.value as Site } })
                        }
                      >
                        <option value="">— not mapped —</option>
                        {SITES.map((site) => (
                          <option key={site} value={site}>
                            {site}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

          </section>

          {/* --- Step 4: preview ------------------------------------------ */}
          <section className="card mb-4 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink-900">3. Preview</h2>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone="good">{result.mapped.length} ready</Badge>
                {result.rejected.length > 0 && <Badge tone="bad">{result.rejected.length} rejected</Badge>}
                {result.mapped.some((row) => row.warnings.length > 0) && (
                  <Badge tone="warn">{result.mapped.filter((row) => row.warnings.length > 0).length} with warnings</Badge>
                )}
              </div>
            </div>

            {result.pointsMatched < result.mapped.length && (
              <div className="p-3">
                <WarnNote>
                  <p className="font-semibold">
                    {result.mapped.length - result.pointsMatched} of {result.mapped.length} have no Point assignment on file.
                  </p>
                  <p className="mt-0.5">
                    They import fine, but with no Points they have no Production Area and cannot be posted for. Assign their Points in Master Data →
                    Employees, or on the Daily Entry screen.
                  </p>
                </WarnNote>
              </div>
            )}

            {result.matchedOnSuffix && (
              <div className="px-3 pb-3">
                <InfoNote>
                  The SAP Emp IDs are longer than the ones on the assignment list, so they were matched on their trailing digits — SAP{' '}
                  <code className="font-mono">40001295</code> to floor Emp ID <code className="font-mono">1295</code>. Check a couple of rows below
                  before importing.
                </InfoNote>
              </div>
            )}

            <div className="max-h-96 overflow-auto scroll-slim">
              <table className="w-full min-w-[52rem] border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className="th sticky top-0 bg-ink-50 w-24">Emp ID</th>
                    <th scope="col" className="th sticky top-0 bg-ink-50">Name</th>
                    <th scope="col" className="th sticky top-0 bg-ink-50 w-24">Pay grade</th>
                    <th scope="col" className="th sticky top-0 bg-ink-50 w-28">Site</th>
                    <th scope="col" className="th sticky top-0 bg-ink-50">Points</th>
                    <th scope="col" className="th sticky top-0 bg-ink-50 w-28">Joined</th>
                    <th scope="col" className="th sticky top-0 bg-ink-50">Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {result.mapped.slice(0, 200).map(({ employee, warnings }) => (
                    <tr key={employee.empId} className={warnings.length > 0 ? 'bg-warn-50/40' : undefined}>
                      <td className="td num">{employee.empId}</td>
                      <td className="td font-medium">{employee.name}</td>
                      <td className="td text-ink-600">{employee.grade}</td>
                      <td className="td text-ink-600">{employee.site}</td>
                      <td className="td text-xs text-ink-600">
                        {employee.pointIds.length === 0 ? (
                          <span className="text-warn-700">none on file</span>
                        ) : (
                          employee.pointIds
                            .map((pointId) => state.points.find((point) => point.pointId === pointId)?.name ?? pointId)
                            .join(', ')
                        )}
                      </td>
                      <td className="td text-ink-600">{employee.joinDate ? formatDate(employee.joinDate) : '—'}</td>
                      <td className="td text-xs text-warn-700">{warnings.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.mapped.length > 200 && (
              <p className="border-t border-ink-200 px-4 py-2 text-xs text-ink-500">
                Showing the first 200 of {result.mapped.length}. All of them are imported.
              </p>
            )}

            {result.rejected.length > 0 && (
              <div className="border-t border-ink-200 p-3">
                <ErrorNote>
                  <p className="font-semibold">{result.rejected.length} record(s) cannot be imported</p>
                  <ul className="mt-1 list-disc pl-4">
                    {[...new Set(result.rejected.map((row) => row.reason))].slice(0, 5).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </ErrorNote>
              </div>
            )}
          </section>

          {/* --- Step 5: import ------------------------------------------- */}
          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-ink-900">4. Sync</h2>

            <div className="mt-3">
              <InfoNote>
                This fills the <strong>SAP directory</strong> — master data, not the incentive list. Nobody here is scored or paid anything until the
                Admin picks them and the MD approves (policy section 10).
              </InfoNote>
            </div>

            <div className="mt-3">
              <GuardedButton
                decision={decision}
                variant="primary"
                onClick={doImport}
                blockedReason={!ready ? 'Map at least the Emp ID and a name before importing.' : undefined}
              >
                Sync {result.mapped.length} {result.mapped.length === 1 ? 'person' : 'people'} into the directory
              </GuardedButton>
            </div>
          </section>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------

function MapField({
  label,
  value,
  fields,
  onChange,
  required = false,
}: {
  label: string
  value: string
  fields: string[]
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <Field label={`${label}${required ? ' (required)' : ''}`}>
      <Tooltip label={required && !value ? 'This one is needed before anything can be imported.' : ''}>
        <select className={`input ${required && !value ? 'input-error' : ''}`} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">— not mapped —</option>
          {fields.map((field) => (
            <option key={field} value={field}>
              {field}
            </option>
          ))}
        </select>
      </Tooltip>
    </Field>
  )
}

export type { SapUser }
