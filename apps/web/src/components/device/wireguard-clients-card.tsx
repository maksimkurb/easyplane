import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { PlusIcon } from "lucide-react"

import { useListWireguardClients } from "@/api/generated/easyplane"
import type {
  ListDevices200Item,
  ListWireguardClients200Item,
} from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { WireguardAddDialog } from "@/components/device/wireguard-add-dialog"
import {
  WireguardClientListSkeleton,
  WireguardClientRow,
  WireguardConfigDialogHost,
} from "@/components/device/wireguard-client-list"
import {
  useInvalidateWireguardClients,
  useWireguardConfigDialogState,
} from "@/hooks/use-wireguard"
import { WireguardBadge } from "@/components/device/wireguard-badge"
import { Button } from "@/components/ui/button"

/** Network-level list of WireGuard portal clients, marked as a separate kind. */
export function WireguardClientsCard({
  networkId,
  devices,
}: {
  networkId: string
  devices: ListDevices200Item[]
}) {
  const { t } = useTranslation()
  const { canManage } = useAuth()
  const [addOpen, setAddOpen] = useState(false)
  const configState = useWireguardConfigDialogState()
  const invalidate = useInvalidateWireguardClients(networkId)
  const clientsQuery = useListWireguardClients(networkId)

  const hubs = useMemo(
    () =>
      devices
        .filter((device) => device.isHub && device.state === "approved")
        .map((device) => ({
          id: device.id,
          name: device.dnsName ?? device.hostname,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [devices]
  )

  const clients = Array.isArray(clientsQuery.data?.data)
    ? clientsQuery.data.data
    : []
  const created = (client: ListWireguardClients200Item) => {
    void invalidate()
    configState.show(client)
  }

  return (
    <section className="mt-5 rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="flex flex-wrap items-center gap-2 text-base leading-6 font-semibold tracking-[-0.006em]">
            {t("wireguard.networkTitle")}
            <WireguardBadge />
          </h2>
          <p className="text-[13px] text-pretty text-fg-3">
            {t("wireguard.networkDescription")}
          </p>
        </div>
        {canManage && hubs.length > 0 ? (
          <Button
            className="max-sm:w-full"
            onClick={() => setAddOpen(true)}
            size="sm"
            variant="outline"
          >
            <PlusIcon className="size-4" />
            {t("wireguard.add")}
          </Button>
        ) : null}
      </div>

      {clientsQuery.isLoading ? (
        <div className="border-t border-line">
          <WireguardClientListSkeleton />
        </div>
      ) : clients.length === 0 ? (
        <p className="border-t border-line px-4 py-6 text-center text-sm text-fg-3 sm:px-5">
          {t("wireguard.empty")}
        </p>
      ) : (
        <div className="divide-y divide-line border-t border-line">
          {clients.map((client) => (
            <WireguardClientRow
              client={client}
              key={client.id}
              onChanged={invalidate}
              onShowConfig={configState.show}
            />
          ))}
        </div>
      )}

      <WireguardAddDialog
        hubs={hubs}
        networkId={networkId}
        onCreated={created}
        onOpenChange={setAddOpen}
        open={addOpen}
      />
      <WireguardConfigDialogHost state={configState} />
    </section>
  )
}
