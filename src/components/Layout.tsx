/**
 * App shell.
 *
 * Eight destinations, each one a job somebody actually does. The top bar carries only what
 * changes what you are looking at — the period and who you are.
 */

import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { canSeeScreen } from '../domain/permissions'
import { ROLE_LABELS } from '../domain/types'
import { useApp } from '../store/AppStore'
import { Icon, PeriodBadge, Toaster } from './ui'

type IconName = 'grid' | 'chart' | 'signoff' | 'download' | 'target' | 'people' | 'history' | 'gear' | 'clipboard'

interface NavItem {
  to: string
  label: string
  screen: string
  icon: IconName
  end?: boolean
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Every day',
    items: [
      { to: '/', label: 'Daily Entry', screen: 'daily-entry', icon: 'grid', end: true },
      { to: '/scorecard', label: 'Scorecard', screen: 'scorecard', icon: 'chart' },
    ],
  },
  {
    title: 'Month end',
    items: [
      { to: '/period-marks', label: 'Period marks', screen: 'period-marks', icon: 'clipboard' },
      { to: '/month-end', label: 'Review & sign-off', screen: 'month-end', icon: 'signoff' },
      { to: '/export', label: 'Export', screen: 'export', icon: 'download' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { to: '/targets', label: 'Targets', screen: 'targets', icon: 'target' },
      { to: '/people', label: 'People', screen: 'people', icon: 'people' },
      { to: '/audit', label: 'Audit log', screen: 'audit', icon: 'history' },
      { to: '/settings', label: 'Settings', screen: 'settings', icon: 'gear' },
    ],
  },
]

export default function Layout() {
  const { state, user, period, setPeriodId } = useApp()
  const location = useLocation()

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSeeScreen(user.role, item.screen)),
  })).filter((group) => group.items.length > 0)

  const flat = groups.flatMap((group) => group.items)

  return (
    <div className="min-h-dvh bg-ink-100">
      {/* --- Top bar ------------------------------------------------------ */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-ink-200 bg-white px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-[11px] font-bold text-white">DIC</div>
          <span className="hidden truncate text-sm font-semibold text-ink-900 sm:block">Production Incentive</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <PeriodBadge status={period.status} />
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Active period</span>
            <select
              className="input w-auto py-1.5 text-sm font-medium"
              value={period.periodId}
              onChange={(event) => setPeriodId(event.target.value)}
            >
              {state.periods.map((p) => (
                <option key={p.periodId} value={p.periodId}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <UserMenu />
        </div>
      </header>

      <div className="flex">
        {/* --- Sidebar ----------------------------------------------------- */}
        <nav aria-label="Main" className="hidden w-60 shrink-0 border-r border-ink-200 bg-white md:block">
          <div className="sticky top-14 space-y-5 p-3">
            {groups.map((group) => (
              <div key={group.title}>
                <h2 className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{group.title}</h2>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink to={item.to} end={item.end} className="nav-item group">
                        <span className="nav-rail" aria-hidden="true" />
                        <Icon name={item.icon} className="nav-icon" />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {/* Small screens: the same destinations as a scrolling strip. */}
        <nav aria-label="Main" className="fixed bottom-0 left-0 z-30 w-full overflow-x-auto border-t border-ink-200 bg-white md:hidden">
          <ul className="flex gap-1 p-1.5">
            {flat.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className="nav-item-compact">
                  <Icon name={item.icon} className="h-4 w-4" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 px-4 py-5 pb-24 md:px-6 md:pb-8" key={location.pathname}>
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      <Toaster />
    </div>
  )
}

// ---------------------------------------------------------------------------

function UserMenu() {
  const { user, signOut, loadDemoData, storageWarning } = useApp()
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const badge = user.name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-ink-200 py-1 pr-2.5 pl-1 text-sm transition-colors hover:bg-ink-50"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">{badge}</span>
        <span className="hidden max-w-32 truncate text-ink-800 lg:block">{user.name}</span>
        <Icon name="chevron" className="h-3.5 w-3.5 rotate-90 text-ink-400" />
      </button>

      {open && (
        <div role="menu" className="card absolute right-0 z-50 mt-1.5 w-64 overflow-hidden p-1 shadow-lg">
          <div className="border-b border-ink-200 px-3 py-2">
            <p className="text-sm font-medium text-ink-900">{user.name}</p>
            <p className="text-xs text-ink-500">{ROLE_LABELS[user.role]}</p>
          </div>

          {storageWarning && <p className="border-b border-ink-200 px-3 py-2 text-xs text-warn-700">{storageWarning}</p>}

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-700 transition-colors hover:bg-ink-50"
            onClick={() => {
              loadDemoData()
              setOpen(false)
            }}
          >
            <Icon name="undo" className="h-4 w-4 text-ink-400" /> Load demo data
          </button>

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-700 transition-colors hover:bg-ink-50"
            onClick={() => {
              setOpen(false)
              signOut()
            }}
          >
            <Icon name="chevron" className="h-4 w-4 text-ink-400" /> Switch account
          </button>
        </div>
      )}
    </div>
  )
}
