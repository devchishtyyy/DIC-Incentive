/**
 * The roster sync.
 *
 * **On every start.** Opening the app pulls the roster, so the names, pay grades and
 * joining dates on screen are the ones SuccessFactors holds right now and nobody has to
 * remember to press anything.
 *
 * On top of that, the weekly slot still exists as a catch-up for a session left open for
 * days: a browser has no cron, so the app re-checks every few minutes and syncs when the
 * scheduled time has passed.
 *
 * No credentials are involved here. The app asks its own server for the roster and the
 * server does the SAML assertion, the token exchange and the OData read — see
 * `server/sapRoster.ts`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRoster, SapError } from '../data/sapClient'
import { mapSapUsers, mappingIsComplete, suggestMapping, type FieldMapping } from '../data/sapImport'
import { isDue, rosterChangeIsSafe } from '../domain/syncSchedule'
import type { AppState } from '../domain/types'
import type { WriteOp } from './writes'

/** How often to re-check while the app is sitting open. */
const CHECK_EVERY_MS = 5 * 60 * 1000

export interface SyncRunner {
  running: boolean
  message: string
  /** Runs the sync regardless of the schedule — the "Sync now" button. */
  runNow: () => void
}

export function useRosterSync(
  state: AppState,
  write: (op: WriteOp) => void,
  pushToast: (kind: 'success' | 'error' | 'info', message: string) => void,
): SyncRunner {
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')

  // The loop reads these through a ref so it can stay on an empty dependency list and
  // not restart its timer every time the state object changes.
  const latest = useRef({ state, write, pushToast })
  latest.current = { state, write, pushToast }
  const inFlight = useRef(false)

  const run = useCallback(async (manual: boolean) => {
    if (inFlight.current) return
    const { state: current, write: send, pushToast: toast } = latest.current

    inFlight.current = true
    setRunning(true)
    const at = new Date().toISOString()

    try {
      setMessage('Connecting to SuccessFactors…')
      const users = await fetchRoster((progress) => setMessage(progress.message))

      // The mapping confirmed during the first manual import. Without one, fall back to
      // the guess — good enough to get a roster in, and the preview screen refines it.
      const saved = current.sapMapping as FieldMapping | null
      const fields = [...new Set(users.flatMap((user) => Object.keys(user)))].filter((key) => key !== '__metadata')
      const mapping = saved && mappingIsComplete(saved) ? saved : suggestMapping(fields)

      if (!mappingIsComplete(mapping)) {
        throw new SapError('The SAP fields could not be mapped automatically.', 'done', 'Run one manual import so the mapping is confirmed, then the weekly sync can reuse it.')
      }

      const result = mapSapUsers(users, mapping)

      const safety = rosterChangeIsSafe(current.directory.length, result.mapped.length)
      if (!safety.safe) {
        send({ kind: 'sync.record', status: 'failed', message: safety.reason, count: result.mapped.length, at })
        setMessage('')
        toast('error', safety.reason)
        return
      }

      send({
        kind: 'directory.sync',
        entries: result.mapped.map(({ employee }) => ({
          empId: employee.empId,
          sapUserId: employee.sapUserId,
          name: employee.name,
          grade: employee.grade,
          site: employee.site,
          joinDate: employee.joinDate,
          pointIds: employee.pointIds,
          syncedAt: at,
        })),
        source: manual ? 'Manual directory sync from SAP' : 'Scheduled weekly directory sync from SAP',
      })

      const summary =
        `${result.mapped.length} people synced into the directory` +
        (result.rejected.length > 0 ? `, ${result.rejected.length} skipped` : '') +
        '.'
      send({ kind: 'sync.record', status: 'ok', message: summary, count: result.mapped.length, at })
      setMessage('')
      toast('success', summary)
    } catch (error) {
      const detail = error instanceof SapError ? `${error.message} ${error.detail}`.trim() : String(error)
      send({ kind: 'sync.record', status: 'failed', message: detail, count: 0, at })
      setMessage('')
      // A background failure is reported quietly; a manual one the user is watching for.
      if (manual) toast('error', detail)
    } finally {
      inFlight.current = false
      setRunning(false)
    }
  }, [])

  // Start-up sync, then the weekly catch-up for a session left open.
  useEffect(() => {
    // Slightly delayed so the first paint is not competing with a network call.
    const first = window.setTimeout(() => void run(false), 1200)
    const timer = window.setInterval(() => {
      if (isDue(latest.current.state.rosterSync, new Date())) void run(false)
    }, CHECK_EVERY_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [run])

  return { running, message, runNow: () => void run(true) }
}
