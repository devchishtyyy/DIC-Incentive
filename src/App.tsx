import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { canSeeScreenAny } from './domain/permissions'
import { ROLE_LABELS } from './domain/types'
import { AppProvider, useApp } from './store/AppStore'
import { EmptyState, PageHeader } from './components/ui'

import DailyEntry from './screens/DailyEntry'
import Targets from './screens/Targets'
import MonthlyScorecard from './screens/MonthlyScorecard'
import EmployeeDetail from './screens/EmployeeDetail'
import MonthEndReview from './screens/MonthEndReview'
import ExportScreen from './screens/ExportScreen'
import AuditLog from './screens/AuditLog'
import People from './screens/People'
import PeriodMarks from './screens/PeriodMarks'
import Settings from './screens/Settings'
import DemoGuide from './screens/DemoGuide'
import Login from './screens/Login'

/** A screen the role cannot open is replaced with the reason, not a blank page. */
function Screen({ name, children }: { name: string; children: React.ReactNode }) {
  const { user } = useApp()
  if (canSeeScreenAny(user.roles, name)) return <>{children}</>
  return (
    <>
      <PageHeader title="No access" />
      <div className="card">
        <EmptyState
          title={`${user.roles.map((role) => ROLE_LABELS[role]).join(' / ')} has no access to this screen`}
          body="Switch account from the menu in the top right to test another role."
        />
      </div>
    </>
  )
}

/** Nothing is reachable until a test account is chosen. */
function Gate() {
  const { signedIn } = useApp()
  if (!signedIn) return <Login />
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Daily Entry is the landing page — it is what most people open the app to do. */}
        <Route index element={<Screen name="daily-entry"><DailyEntry /></Screen>} />
        <Route path="daily-entry" element={<Navigate to="/" replace />} />
        <Route path="targets" element={<Targets />} />
        <Route path="scorecard" element={<MonthlyScorecard />} />
        <Route path="employees/:empId" element={<EmployeeDetail />} />
        <Route path="period-marks" element={<Screen name="period-marks"><PeriodMarks /></Screen>} />
        <Route path="month-end" element={<MonthEndReview />} />
        <Route path="export" element={<Screen name="export"><ExportScreen /></Screen>} />
        <Route path="audit" element={<Screen name="audit"><AuditLog /></Screen>} />
        <Route path="people" element={<Screen name="people"><People /></Screen>} />
        <Route path="settings" element={<Settings />} />
        <Route path="guide" element={<DemoGuide />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AppProvider>
      {/* Hash routing so the built app works from any static host or subfolder,
          with no server-side rewrite rules to configure. */}
      <HashRouter>
        <Gate />
      </HashRouter>
    </AppProvider>
  )
}
