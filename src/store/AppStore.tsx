/**
 * The single state container. Everything the app knows lives here, loaded from the seed
 * and persisted to browser storage so a tester can refresh without losing their work.
 *
 * Components never mutate state directly — they call `write(op)`, which runs `applyWrite`
 * and appends the audit rows it produces.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEMO_TODAY } from '../config/policy'
import { can, type Action, type Resource } from '../domain/permissions'
import type { AppState, MonthPeriod, User } from '../domain/types'
import { buildBaseState, buildDemoState, DEFAULT_PERIOD_ID, generateEntriesForRoster, SCHEMA_VERSION } from '../data/seed'
import { applyWrite, type WriteOp } from './writes'
import { useRosterSync, type SyncRunner } from './useRosterSync'

const STATE_KEY = 'dic-incentive.state.v1'
const SESSION_KEY = 'dic-incentive.session.v1'

interface Session {
  /** Null until someone picks a test account on the login screen. */
  userId: string | null
  periodId: string
}

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

interface AppContextValue {
  state: AppState
  /** True once a test account has been chosen on the login screen. */
  signedIn: boolean
  /** The account being tested. Falls back to the first user before sign-in. */
  user: User
  period: MonthPeriod
  today: string
  storageWarning: string | null

  signIn: (userId: string) => void
  signOut: () => void
  setPeriodId: (periodId: string) => void

  write: (op: WriteOp) => void
  /** Back to master data only — no employees, no entries. */
  resetToEmpty: () => void
  /** The full invented demo: roster, ~780 entries, approval history, seeded scenarios. */
  loadDemoData: () => void
  /** Demo production history for whatever roster is loaded, real staff included. */
  generateDemoEntries: () => void
  /** The weekly SAP roster sync — its live status and a manual trigger. */
  rosterSync: SyncRunner

  /** `can(...)` with the current user's role and area filled in. */
  allow: (action: Action, resource?: Resource) => ReturnType<typeof can>

  toasts: Toast[]
  pushToast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: number) => void
}

const AppContext = createContext<AppContextValue | null>(null)

/**
 * Reads the saved state, laid over a fresh base.
 *
 * The overlay matters: a collection added to AppState after someone last loaded the app
 * would otherwise be `undefined` in their saved copy, and the first `.length` on it takes
 * the screen down with no error anyone can act on. Merging over the base means a missing
 * key is simply empty, and only a genuine version change discards anything.
 */
function loadState(): { state: AppState; warning: string | null } {
  const base = buildBaseState()

  let raw: string | null = null
  try {
    raw = localStorage.getItem(STATE_KEY)
  } catch {
    return { state: base, warning: null }
  }
  if (!raw) return { state: base, warning: null }

  try {
    const parsed = JSON.parse(raw) as Partial<AppState>
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      return { state: base, warning: 'The saved data was from an older version of the app, so it has been rebuilt.' }
    }
    return { state: { ...base, ...parsed, schemaVersion: SCHEMA_VERSION }, warning: null }
  } catch {
    return { state: base, warning: 'Saved data could not be read, so it has been rebuilt.' }
  }
}

function loadSession(seed: AppState): Session {
  const fallback: Session = { userId: null, periodId: DEFAULT_PERIOD_ID }
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Session
    const userOk = parsed.userId !== null && seed.users.some((u) => u.userId === parsed.userId)
    const periodOk = seed.periods.some((p) => p.periodId === parsed.periodId)
    return {
      userId: userOk ? parsed.userId : null,
      periodId: periodOk ? parsed.periodId : fallback.periodId,
          }
  } catch {
    return fallback
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  // Lazy initialisers — building the seed is expensive and must happen once, not per render.
  const [initial] = useState(loadState)
  const [state, setState] = useState<AppState>(initial.state)
  const [session, setSession] = useState<Session>(() => loadSession(initial.state))
  const [toasts, setToasts] = useState<Toast[]>([])
  const [storageWarning, setStorageWarning] = useState<string | null>(initial.warning)
  const toastSeq = useRef(0)

  // --- Persistence --------------------------------------------------------
  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state))
      setStorageWarning((current) => (current?.startsWith('Changes are not being saved') ? null : current))
    } catch {
      setStorageWarning('Changes are not being saved to this browser — the demo data is larger than the available storage. Everything still works until you refresh.')
    }
  }, [state])

  useEffect(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } catch {
      /* session persistence is a convenience only */
    }
  }, [session])

  // --- Derived ------------------------------------------------------------
  const signedIn = session.userId !== null
  const user = useMemo(
    () => state.users.find((u) => u.userId === session.userId) ?? state.users[0],
    [state.users, session.userId],
  )

  const period = useMemo(
    () => state.periods.find((p) => p.periodId === session.periodId) ?? state.periods[state.periods.length - 1],
    [state.periods, session.periodId],
  )

  // --- Actions ------------------------------------------------------------
  const pushToast = useCallback((kind: Toast['kind'], message: string) => {
    if (!message) return
    toastSeq.current += 1
    const id = toastSeq.current
    setToasts((current) => [...current, { id, kind, message }])
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000)
  }, [])

  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((t) => t.id !== id)), [])

  const write = useCallback(
    (op: WriteOp) => {
      let toast = ''
      setState((current) => {
        const result = applyWrite(current, op, { actorUserId: session.userId ?? 'U-OE1', now: new Date().toISOString() })
        toast = result.message
        if (result.logs.length === 0 && result.state === current) return current
        return { ...result.state, auditLog: [...result.logs, ...result.state.auditLog] }
      })
      // Toast after the state update so the message reflects what actually happened.
      window.setTimeout(() => pushToast('success', toast), 0)
    },
    [session.userId, pushToast],
  )

  const resetToEmpty = useCallback(() => {
    setState(buildBaseState())
    setSession({ userId: session.userId, periodId: DEFAULT_PERIOD_ID })
    pushToast('info', 'Reset to master data only — no employees and no entries.')
  }, [session.userId, pushToast])

  const loadDemoData = useCallback(() => {
    setState(buildDemoState())
    setSession({ userId: session.userId, periodId: DEFAULT_PERIOD_ID })
    pushToast('info', 'Demo data loaded — 35 invented employees and their production history.')
  }, [session.userId, pushToast])

  const generateDemoEntries = useCallback(() => {
    setState((current) => {
      if (current.employees.length === 0) return current
      const entries = generateEntriesForRoster(current)
      const result = applyWrite(current, { kind: 'demo.setEntries', entries }, { actorUserId: session.userId ?? 'U-OE1', now: new Date().toISOString() })
      return { ...result.state, auditLog: [...result.logs, ...result.state.auditLog] }
    })
    pushToast('success', 'Demo entries generated for the current roster.')
  }, [session.userId, pushToast])

  const allow = useCallback(
    (action: Action, resource: Resource = {}) =>
      can(user.role, action, { periodStatus: period.status, ...resource }),
    [user, period.status],
  )

  // Runs on load and every few minutes while the app is open. Declared after `write` and
  // `pushToast` because it uses both.
  const rosterSync = useRosterSync(state, write, pushToast)

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      signedIn,
      user,
      period,
      today: DEMO_TODAY,
      storageWarning,
      signIn: (userId) => setSession((s) => ({ ...s, userId, periodId: DEFAULT_PERIOD_ID })),
      signOut: () => setSession((s) => ({ ...s, userId: null })),
      setPeriodId: (periodId) => setSession((s) => ({ ...s, periodId })),
      write,
      resetToEmpty,
      loadDemoData,
      generateDemoEntries,
      rosterSync,
      allow,
      toasts,
      pushToast,
      dismissToast,
    }),
    [state, signedIn, user, period, storageWarning, write, resetToEmpty, loadDemoData, generateDemoEntries, rosterSync, allow, toasts, pushToast, dismissToast],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside <AppProvider>')
  return context
}
