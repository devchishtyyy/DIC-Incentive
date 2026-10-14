/**
 * The weekly roster sync, as the Admin sees it: when it last ran, when it runs next, and
 * a button to run it now.
 */

import { Badge, Field, GuardedButton, Icon } from './ui'
import { formatDateTime } from '../domain/dates'
import { describeSchedule, dueAt, WEEKDAYS, type SyncSchedule } from '../domain/syncSchedule'
import { useApp } from '../store/AppStore'

export function RosterSyncPanel() {
  const { state, allow, write, rosterSync } = useApp()
  const decision = allow('settings.edit')
  const sync = state.rosterSync

  const next = dueAt(sync, new Date())
  const set = (patch: Partial<SyncSchedule>) => write({ kind: 'sync.setSchedule', schedule: { ...sync.schedule, ...patch } })

  const tone = sync.lastStatus === 'ok' ? 'good' : sync.lastStatus === 'failed' ? 'bad' : 'neutral'
  const label = sync.lastStatus === 'ok' ? 'Last sync succeeded' : sync.lastStatus === 'failed' ? 'Last sync failed' : 'Never run'

  return (
    <div className="card card-pad">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Weekly roster sync</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Pulls the employee roster from SAP SuccessFactors on a schedule. The app checks on every load and every five
            minutes while it is open, so a missed Saturday catches up the next time someone signs in.
          </p>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Run">
          <select
            className="input"
            value={sync.schedule.enabled ? 'on' : 'off'}
            disabled={!decision.allowed}
            onChange={(event) => set({ enabled: event.target.value === 'on' })}
          >
            <option value="on">Weekly</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <Field label="Day">
          <select
            className="input"
            value={sync.schedule.weekday}
            disabled={!decision.allowed || !sync.schedule.enabled}
            onChange={(event) => set({ weekday: Number(event.target.value) })}
          >
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Time">
          <input
            type="time"
            className="input"
            value={`${String(sync.schedule.hour).padStart(2, '0')}:${String(sync.schedule.minute).padStart(2, '0')}`}
            disabled={!decision.allowed || !sync.schedule.enabled}
            onChange={(event) => {
              const [hour, minute] = event.target.value.split(':').map(Number)
              if (Number.isFinite(hour) && Number.isFinite(minute)) set({ hour, minute })
            }}
          />
        </Field>
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="label">Schedule</dt>
          <dd className="mt-0.5 text-ink-700">{describeSchedule(sync.schedule)}</dd>
        </div>
        <div>
          <dt className="label">Last run</dt>
          <dd className="mt-0.5 text-ink-700">
            {sync.lastRunAt ? formatDateTime(sync.lastRunAt) : 'Never'}
            {sync.lastCount > 0 && <span className="text-ink-500"> · {sync.lastCount} users</span>}
          </dd>
        </div>
        <div>
          <dt className="label">Next run</dt>
          <dd className="mt-0.5 text-ink-700">{next ? (sync.lastRunAt ? formatDateTime(next.toISOString()) : 'As soon as the app loads') : '—'}</dd>
        </div>
      </dl>

      {sync.lastMessage && (
        <p className={`mt-2 rounded-md border px-2.5 py-1.5 text-xs ${sync.lastStatus === 'failed' ? 'border-bad-100 bg-bad-50 text-bad-700' : 'border-good-100 bg-good-50 text-good-700'}`}>
          {sync.lastMessage}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <GuardedButton
          decision={decision}
          variant="default"
          onClick={rosterSync.runNow}
          blockedReason={rosterSync.running ? 'A sync is already running.' : undefined}
        >
          <Icon name="undo" className="h-3.5 w-3.5" /> Sync now
        </GuardedButton>

        {rosterSync.running && (
          <span className="flex items-center gap-1.5 text-sm text-ink-600">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            {rosterSync.message || 'Syncing…'}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-500">
        The sync merges rather than replaces: new joiners are added as <strong>Pending MD approval</strong>, existing
        records are updated, and nobody is removed — a leaver is deactivated by hand so their history survives. A result
        that loses more than half the roster is refused as a likely fault rather than applied.
        {!state.sapMapping && ' Run one import from Master Data first so the field mapping is confirmed.'}
      </p>
    </div>
  )
}
