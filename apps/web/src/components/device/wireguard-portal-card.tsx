import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { InfoIcon, PlusIcon, ShieldIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getGetNetworkQueryKey,
  getListDevicesQueryKey,
  getListWireguardClientsQueryKey,
  useListWireguardClients,
  useUpdateDeviceWireguardPortal,
} from "@/api/generated/easyplane"
import type {
  GetDevice200,
  ListWireguardClients200Item,
} from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { WireguardAddDialog } from "@/components/device/wireguard-add-dialog"
import {
  WireguardClientListSkeleton,
  WireguardClientRow,
  WireguardConfigDialogHost,
} from "@/components/device/wireguard-client-list"
import { useWireguardConfigDialogState } from "@/hooks/use-wireguard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const DEFAULT_WIREGUARD_PORT = 11013

/**
 * Hub card for the built-in WireGuard server: toggle, UDP port, router hint
 * and the clients this hub serves. The portal is refused by the API when the
 * device is not a hub or while clients still exist.
 */
export function WireguardPortalCard({ device }: { device: GetDevice200 }) {
  const { t } = useTranslation()
  const { isAdmin, canManage } = useAuth()
  const queryClient = useQueryClient()
  const [portDraft, setPortDraft] = useState(
    device.wgListenPort === null ? String(DEFAULT_WIREGUARD_PORT) : String(device.wgListenPort)
  )
  const [addOpen, setAddOpen] = useState(false)
  const configState = useWireguardConfigDialogState()

  const clientsQuery = useListWireguardClients(device.networkId)
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: getListWireguardClientsQueryKey(device.networkId),
    })
    await queryClient.invalidateQueries({
      queryKey: getGetDeviceQueryKey(device.id),
    })
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
    await queryClient.invalidateQueries({
      queryKey: getGetNetworkQueryKey(device.networkId),
    })
  }

  const update = useUpdateDeviceWireguardPortal({
    mutation: {
      onSuccess: async (_response, variables) => {
        toast.success(
          variables.data.enabled
            ? t("wireguard.portal.enabled")
            : t("wireguard.portal.disabled")
        )
        await invalidate()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const clients = useMemo(() => {
    const rows = Array.isArray(clientsQuery.data?.data)
      ? clientsQuery.data.data
      : []
    return rows.filter(
      (client: ListWireguardClients200Item) => client.hubDeviceId === device.id
    )
  }, [clientsQuery.data, device.id])

  const port = Number.parseInt(portDraft, 10)
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65535
  const enabled = device.wgListenPort !== null
  const hubs = [{ id: device.id, name: device.dnsName ?? device.hostname }]

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base leading-6 font-semibold tracking-[-0.006em]">
            <ShieldIcon aria-hidden="true" className="size-4 text-fg-2" />
            {t("wireguard.portal.title")}
          </h2>
          <p className="text-[13px] text-pretty text-fg-3">
            {t("wireguard.portal.description")}
          </p>
        </div>
        <Switch
          aria-label={t("wireguard.portal.title")}
          checked={enabled}
          disabled={
            !isAdmin ||
            update.isPending ||
            !device.isHub ||
            (enabled && clients.length > 0)
          }
          onCheckedChange={(checked) => {
            if (!checked) {
              update.mutate({ deviceId: device.id, data: { enabled: false } })
              return
            }
            update.mutate({
              deviceId: device.id,
              data: { enabled: true, port: portValid ? port : DEFAULT_WIREGUARD_PORT },
            })
          }}
        />
      </div>

      {!device.isHub ? (
        <p className="border-t border-line px-4 py-3 text-[13px] text-fg-3 sm:px-5">
          {t("wireguard.portal.needsHub")}
        </p>
      ) : (
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4 sm:px-5">
          {enabled ? (
            <>
              <form
                className="flex flex-col gap-1.5 sm:max-w-[220px]"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!portValid) return
                  update.mutate({
                    deviceId: device.id,
                    data: { enabled: true, port },
                  })
                }}
              >
                <Label className="text-[13px]" htmlFor={`wg-port-${device.id}`}>
                  {t("wireguard.portal.port")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    aria-describedby={`wg-port-hint-${device.id}`}
                    aria-invalid={!portValid}
                    className="h-11 sm:h-10"
                    disabled={!isAdmin || update.isPending}
                    id={`wg-port-${device.id}`}
                    inputMode="numeric"
                    max={65535}
                    min={1}
                    onChange={(event) => setPortDraft(event.target.value)}
                    type="number"
                    value={portDraft}
                  />
                  <Button
                    disabled={
                      !isAdmin || update.isPending || !portValid || port === device.wgListenPort
                    }
                    size="sm"
                    type="submit"
                    variant="outline"
                  >
                    {t("wireguard.portal.save")}
                  </Button>
                </div>
                <p
                  className={
                    portValid ? "text-xs text-fg-3" : "text-xs text-warn"
                  }
                  id={`wg-port-hint-${device.id}`}
                >
                  {portValid
                    ? t("wireguard.portal.portHint")
                    : t("wireguard.portal.portInvalid")}
                </p>
              </form>

              <p className="flex items-start gap-1.5 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-pretty text-fg-2">
                <InfoIcon
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 flex-none text-fg-3"
                />
                {t("wireguard.portal.routerHint")}
              </p>

              {enabled && clients.length > 0 ? (
                <p className="text-xs text-fg-3">
                  {t("wireguard.portal.disableBlocked")}
                </p>
              ) : null}

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold">
                    {t("wireguard.portal.clients")}
                  </h3>
                  {canManage ? (
                    <Button
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
                  <WireguardClientListSkeleton />
                ) : clients.length === 0 ? (
                  <p className="rounded-lg bg-surface-2 px-3 py-3 text-[13px] text-fg-3">
                    {t("wireguard.portal.noClients")}
                  </p>
                ) : (
                  <div className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5">
                    {clients.map((client) => (
                      <WireguardClientRow
                        client={client}
                        compact
                        key={client.id}
                        onChanged={invalidate}
                        onShowConfig={configState.show}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-pretty text-fg-3">
              {t("wireguard.portal.defaultPort", {
                port: DEFAULT_WIREGUARD_PORT,
              })}
            </p>
          )}
        </div>
      )}

      <WireguardAddDialog
        hubs={hubs}
        networkId={device.networkId}
        onCreated={(client) => {
          void invalidate()
          configState.show(client)
        }}
        onOpenChange={setAddOpen}
        open={addOpen}
      />
      <WireguardConfigDialogHost state={configState} />
    </section>
  )
}
