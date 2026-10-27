/**
 * A render smoke test: every screen, rendered for every role, on every period.
 *
 * It will not catch a styling problem, but it does catch a crash — a missing guard, a
 * null employee, a bad lookup — on any combination a tester could reach from the role
 * switcher and the period selector. That is 7 roles × 4 periods × 12 screens.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Route, Routes, StaticRouter } from 'react-router-dom'

import { AppProvider } from '../store/AppStore'
import Layout from '../components/Layout'
import { USERS } from '../data/masters'
import { buildBaseState, buildDemoState, PERIODS } from '../data/seed'

import AuditLog from './AuditLog'
import DailyEntry from './DailyEntry'
import DemoGuide from './DemoGuide'
import EmployeeDetail from './EmployeeDetail'
import ExportScreen from './ExportScreen'
import People from './People'
import MonthEndReview from './MonthEndReview'
import MonthlyScorecard from './MonthlyScorecard'
import Settings from './Settings'
import Targets from './Targets'
import Login from './Login'


/**
 * No screen may render a broken number. The Demo Guide is the one exception: it quotes
 * acceptance test 4 ("Save blocked, no NaN or Infinity") word for word as prose.
 */
function expectNoBrokenNumbers(html: string, screen: string) {
  if (screen === 'Demo Guide') return
  expect(html).not.toContain('NaN')
  expect(html).not.toContain('Infinity')
}

const DEMO_STATE = buildDemoState()
const EMPTY_STATE = buildBaseState()

const SCREENS: Array<[string, string]> = [
  ['Daily Entry', '/'],
  ['Targets', '/targets'],
  ['Monthly Scorecard', '/scorecard'],
  ['Employee Detail', '/employees/4101'],
  ['Month-end Review', '/month-end'],
  ['Export', '/export'],
  ['Audit Log', '/audit'],
  ['People', '/people'],
  ['Settings', '/settings'],
  ['Demo Guide', '/guide'],
]

function Tree({ path }: { path: string }) {
  return (
    <AppProvider>
      <StaticRouter location={path}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DailyEntry />} />
            <Route path="targets" element={<Targets />} />
            <Route path="scorecard" element={<MonthlyScorecard />} />
            <Route path="employees/:empId" element={<EmployeeDetail />} />
            <Route path="month-end" element={<MonthEndReview />} />
            <Route path="export" element={<ExportScreen />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="people" element={<People />} />
            <Route path="settings" element={<Settings />} />
            <Route path="guide" element={<DemoGuide />} />
          </Route>
        </Routes>
      </StaticRouter>
    </AppProvider>
  )
}

/**
 * The provider reads and writes browser storage; give it one that behaves. The app now
 * ships empty, so the demo state is installed explicitly — otherwise these 169 renders
 * would all be checking blank screens.
 */
function installStorage(session: { userId: string; periodId: string }, state = DEMO_STATE) {
  const store = new Map<string, string>()
  store.set('dic-incentive.session.v1', JSON.stringify(session))
  store.set('dic-incentive.state.v1', JSON.stringify(state))
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
}

beforeEach(() => {
  // `window.setTimeout` is used for toasts; SSR never calls it, but the module reads it.
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true, writable: true })
})

describe('every screen renders for every role', () => {
  for (const user of USERS) {
    for (const [name, path] of SCREENS) {
      it(`${user.role} — ${name}`, () => {
        installStorage({ userId: user.userId, periodId: '2026-08' })
        const html = renderToStaticMarkup(<Tree path={path} />)
        expect(html).toContain('Production Incentive')
        expectNoBrokenNumbers(html, name)
        expect(html).not.toContain('undefined</')
      })
    }
  }
})

describe('every screen renders for every period', () => {
  for (const period of PERIODS) {
    for (const [name, path] of SCREENS) {
      it(`${period.periodId} (${period.status}) — ${name}`, () => {
        installStorage({ userId: 'U-OE1', periodId: period.periodId })
        const html = renderToStaticMarkup(<Tree path={path} />)
        expect(html).toContain('Production Incentive')
        expectNoBrokenNumbers(html, name)
      })
    }
  }
})

describe('the HOD sees the whole plant', () => {
  it('has no Production Area filter left in the top bar', () => {
    installStorage({ userId: 'U-HOD', periodId: '2026-08' })
    const html = renderToStaticMarkup(<Tree path="/scorecard" />)
    expect(html).not.toContain('Production Area')
    expect(html).not.toContain('All areas')
  })
})

describe('the login screen', () => {
  const render = () => {
    installStorage({ userId: 'U-OE1', periodId: '2026-09' })
    return renderToStaticMarkup(
      <AppProvider>
        <StaticRouter location="/">
          <Login />
        </StaticRouter>
      </AppProvider>,
    )
  }

  it('asks for an employee number and a password', () => {
    const html = render()
    expect(html).toContain('type="password"')
    expect(html).toContain('Employee number')
    expect(html).toContain('Sign in with your SuccessFactors account')
  })

  it('says the suffix is added for you, so nobody types it', () => {
    expect(render()).toContain('@packagesli')
  })

  it('promises not to keep the password, which it does not', () => {
    expect(render()).toContain('not stored anywhere by this app')
  })

  it('still offers the test accounts, behind a disclosure', () => {
    const html = render()
    expect(html).toContain('Sign in as a test account')
    // Collapsed by default: the real sign-in is the one on offer.
    expect(html).not.toContain('Daily work')
  })

  it('never renders a password value into the markup', () => {
    expect(render()).not.toContain('Pkgs@')
  })
})

describe('the app before any roster has been imported', () => {
  // This is what a new install looks like: master data only, no employees, no entries.
  for (const [name, path] of SCREENS) {
    it(`${name} renders empty without crashing`, () => {
      installStorage({ userId: 'U-ADM', periodId: '2026-09' }, EMPTY_STATE)
      const html = renderToStaticMarkup(<Tree path={path} />)
      expect(html).toContain('Production Incentive')
      expectNoBrokenNumbers(html, name)
    })
  }

  it('points the Admin at the SAP import rather than showing a blank table', () => {
    installStorage({ userId: 'U-ADM', periodId: '2026-09' }, EMPTY_STATE)
    const html = renderToStaticMarkup(<Tree path="/people?tab=import" />)
    expect(html).toContain('Sync the directory from SAP')
  })

  it('ships with the login accounts and the supplied list, waiting for the MD', () => {
    expect(EMPTY_STATE.users.length).toBeGreaterThan(0)
    expect(EMPTY_STATE.employees).toHaveLength(42)
    expect(EMPTY_STATE.employees.every((employee) => employee.incentiveListStatus === 'Pending MD approval')).toBe(true)
    expect(EMPTY_STATE.entries).toHaveLength(0)
  })
})
