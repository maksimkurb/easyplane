import { Suspense, lazy } from "react"
import { Redirect, Route, Switch } from "wouter"

import { useAuth } from "@/auth/auth-context"
import { LoginPage } from "@/auth/login-page"
import { AppShell } from "@/components/layout/app-shell"
import { AuditPage } from "@/pages/audit-page"
import { DeviceDetailPage } from "@/pages/device-detail-page"
import { DevicesPage } from "@/pages/devices-page"
import { NetworkDetailPage } from "@/pages/network-detail-page"
import { NetworkImportPage } from "@/pages/network-import-page"
import { NetworksPage } from "@/pages/networks-page"
import { PolicyPage } from "@/pages/policy-page"
import { useTranslation } from "react-i18next"

// The map pulls in @xyflow/react; load it only when the page is opened so the
// rest of the panel keeps its small bundle.
const TopologyPage = lazy(() =>
  import("@/pages/topology-page").then((module) => ({ default: module.TopologyPage }))
)

function App() {
  return (
    <AppShell>
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">…</div>}>
      <Switch>
        <Route path="/">
          <Redirect to="/networks" />
        </Route>
        <Route component={NetworksPage} path="/networks" />
        <Route component={NetworkImportPage} path="/networks/import" />
        <Route component={NetworkDetailPage} path="/networks/:id" />
        <Route component={PolicyPage} path="/networks/:id/policy" />
        <Route component={TopologyPage} path="/topology" />
        <Route path="/devices">
          <DevicesPage />
        </Route>
        <Route component={DeviceDetailPage} path="/devices/:id" />
        <Route path="/pending">
          <DevicesPage pendingOnly />
        </Route>
        <Route component={AuditPage} path="/audit" />
        <Route>
          <Redirect to="/networks" />
        </Route>
      </Switch>
      </Suspense>
    </AppShell>
  )
}

export function AuthenticatedRoot() {
  const { me, loading } = useAuth()
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {t("auth.loading")}
      </div>
    )
  }
  if (!me) return <LoginPage />
  return <App />
}

export default App
