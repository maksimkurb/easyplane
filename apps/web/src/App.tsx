import { Suspense, lazy } from "react"
import { Redirect, Route, Switch } from "wouter"

import { useAuth } from "@/auth/auth-context"
import { LoginPage } from "@/auth/login-page"
import { AppShell } from "@/components/layout/app-shell"
import { AuditPage } from "@/pages/audit-page"
import { DeviceDetailPage } from "@/pages/device-detail-page"
import { DevicesPage } from "@/pages/devices-page"
import { NetworkAccessPage } from "@/pages/network-access-page"
import { NetworkDevicesPage } from "@/pages/network-devices-page"
import { NetworkImportPage } from "@/pages/network-import-page"
import { NetworkSettingsPage } from "@/pages/network-settings-page"
import { NetworksPage } from "@/pages/networks-page"
import { useTranslation } from "react-i18next"

// The map pulls in @xyflow/react; load it only when a map is opened so the
// rest of the panel keeps its small bundle.
const NetworkMapPage = lazy(() =>
  import("@/pages/network-map-page").then((module) => ({
    default: module.NetworkMapPage,
  }))
)
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
          <Route path="/networks/:id/map">
            {(params) => <NetworkMapPage networkId={params.id ?? ""} />}
          </Route>
          <Route path="/networks/:id/access">
            {(params) => <NetworkAccessPage networkId={params.id ?? ""} />}
          </Route>
          <Route path="/networks/:id/settings">
            {(params) => <NetworkSettingsPage networkId={params.id ?? ""} />}
          </Route>
          <Route path="/networks/:id/policy">
            {(params) => <Redirect to={`/networks/${params.id ?? ""}/access`} />}
          </Route>
          <Route path="/networks/:id">
            {(params) => <NetworkDevicesPage networkId={params.id ?? ""} />}
          </Route>
          <Route path="/topology" component={TopologyPage} />
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
