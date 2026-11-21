import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useSearch } from "wouter"

import {
  useGetNetwork,
  useListDevices,
  useListInvites,
  useListNetworkRoutes,
} from "@/api/generated/easyplane"
import type {
  GetNetwork200,
  ListDevices200Item,
  ListInvites200Item,
  ListNetworkRoutes200RoutesItem,
} from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { AddDeviceDialog } from "@/components/invites/add-device-dialog"
import { NetworkHero, type NetworkTab } from "@/components/network/network-hero"
import { SetupChecklist } from "@/components/network/setup-checklist"
import { PageContainer } from "@/components/layout/page-container"
import { Skeleton } from "@/components/ui/skeleton"

export type NetworkShellData = {
  network: GetNetwork200
  devices: ListDevices200Item[]
  routes: ListNetworkRoutes200RoutesItem[]
  invites: ListInvites200Item[]
  /** Approved devices, the denominator of "x of y online". */
  total: number
  online: number
  /** Pending devices plus pending routes. */
  waiting: number
  /** Opens the Add device invite dialog (it lives in the shell). */
  openAddDevice: () => void
}

/**
 * Shared frame for the four network sections: loads the network, its devices,
 * routes and invites once, renders the hero/tabs and offers Add device on
 * every tab.
 */
export function NetworkShell({
  networkId,
  tab,
  children,
}: {
  networkId: string
  tab: NetworkTab
  children: (data: NetworkShellData) => ReactNode
}) {
  const { t } = useTranslation()
  const { canManage } = useAuth()
  const networkQuery = useGetNetwork(networkId)
  const devicesQuery = useListDevices({ networkId })
  const routesQuery = useListNetworkRoutes(networkId)
  const invitesQuery = useListInvites(networkId)
  const [addOpen, setAddOpen] = useState(false)
  const search = useSearch()
  const [location, navigate] = useLocation()

  // Creating a network redirects here with ?addDevice=1 so the invite flow
  // opens straight away. Closing it removes the flag, so the back button and
  // a reload do not reopen the dialog.
  const addFromLink = new URLSearchParams(search ?? "").get("addDevice") === "1"
  const addVisible = addOpen || addFromLink

  const network = networkQuery.data?.data
  const devices = devicesQuery.data?.data ?? []
  const routes = routesQuery.data?.data?.routes ?? []
  const invites = invitesQuery.data?.data ?? []

  if (networkQuery.isLoading) {
    return (
      <>
        <section className="border-b border-line bg-card">
          <PageContainer className="pt-7">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="mt-3 h-4 w-96 max-w-full" />
            <Skeleton className="mt-5 h-10 w-full max-w-md" />
          </PageContainer>
        </section>
        <PageContainer className="pt-5 pb-10">
          <Skeleton className="h-64 w-full rounded-xl" />
        </PageContainer>
      </>
    )
  }

  if (!network) {
    return (
      <PageContainer className="py-10">
        <p className="text-sm text-fg-3">{t("common.notFound")}</p>
      </PageContainer>
    )
  }

  const approved = devices.filter((device) => device.state === "approved")
  const online = approved.filter((device) => device.online === "online").length
  const waiting =
    devices.filter((device) => device.state === "pending").length +
    routes.filter((route) => route.state === "pending").length

  return (
    <>
      <NetworkHero
        active={tab}
        deviceCount={
          devices.filter((device) => device.state !== "pending").length
        }
        devicesLoading={devicesQuery.isLoading}
        network={network}
        onAddDevice={() => setAddOpen(true)}
        online={online}
        total={approved.length}
        waiting={waiting}
      />
      <PageContainer className="pt-5 pb-10">
        {/* The checklist is the network's overview; on the Map, Access and
            Settings tabs it would push the content the user came for down. */}
        {canManage && tab === "devices" ? (
          <SetupChecklist
            devices={devices}
            network={network}
            openAddDevice={() => setAddOpen(true)}
          />
        ) : null}
        {children({
          network,
          devices,
          routes,
          invites,
          total: approved.length,
          online,
          waiting,
          openAddDevice: () => setAddOpen(true),
        })}
      </PageContainer>
      <AddDeviceDialog
        network={network}
        onOpenChange={(next) => {
          setAddOpen(next)
          if (!next && addFromLink) navigate(location, { replace: true })
        }}
        open={addVisible}
      />
    </>
  )
}
