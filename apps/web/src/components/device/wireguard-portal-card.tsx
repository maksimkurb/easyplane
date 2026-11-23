import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import {
  ExternalLinkIcon,
  InfoIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getGetNetworkQueryKey,
  getListDevicesQueryKey,
  getListWireguardClientsQueryKey,
  useListWireguardClients,
  usePushDeviceConfig,
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
import { WireguardSharedConfigDialog } from "@/components/device/wireguard-shared-config-dialog"
import { useWireguardConfigDialogState } from "@/hooks/use-wireguard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const DEFAULT_WIREGUARD_PORT = 11013
const DEFAULT_LEGACY_CLIENT_CIDR = "10.14.14.0/24"

/**
 * Hub card for the built-in WireGuard server.
 *
 * EasyTier changed the portal model in 2.7.0: older builds serve one shared
 * `client_cidr` config and cannot receive portal settings over the
 * config-server protocol at all, newer builds take named clients with derived
 * keys. The card shows the detected generation and offers only what that
 * generation supports, so an operator on an OpenWrt 2.6.4 build never gets a
 * silent no-op.
 */
export function WireguardPortalCard({ device }: { device: GetDevice200 }) {
  const { t } = useTranslation()
  const { isAdmin, canManage } = useAuth()
  const queryClient = useQueryClient()
  const [portDraft, setPortDraft] = useState(
    device.wgListenPort === null ? String(DEFAULT_WIREGUARD_PORT) : String(device.wgListenPort)
  )
  const [cidrDraft, setCidrDraft] = useState(
    device.wgLegacyClientCidr ?? DEFAULT_LEGACY_CLIENT_CIDR
  )
  const [addOpen, setAddOpen] = useState(false)
  const [sharedConfigOpen, setSharedConfigOpen] = useState(false)
  const configState = useWireguardConfigDialogState()

  const mode = device.wgPortalMode
  const perClient = mode === "per-client"
  const portalVersionHint =
    mode === "per-client"
      ? t("wireguard.portal.modePerClient", { version: device.easytierVersion })
      : mode === "legacy"
        ? t("wireguard.portal.modeLegacy", { version: device.easytierVersion })
        : t("wireguard.portal.modeUnknown")

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

  const retry = usePushDeviceConfig({
    mutation: {
      onSuccess: async () => {
        toast.success(t("wireguard.drift.retried"))
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
  const cidrValid = /^(\d{1,3}\.){3}\d{1,3}\/(8|9|[12]\d|30)$/.test(cidrDraft.trim())
  const enabled = device.wgListenPort !== null
  const hubs = [{ id: device.id, name: device.dnsName ?? device.hostname }]

  const portalStateNotice = () => {
    if (!enabled) return null
    switch (device.wgPortalState) {
      case "unsupported":
        return {
          tone: "warn" as const,
          title: t("wireguard.portal.stateUnsupportedTitle"),
          body: [device.wgPortalError, t("wireguard.portal.stateUnsupported")]
            .filter(Boolean)
            .join(" "),
        }
      case "error":
        return {
          tone: "error" as const,
          title: t("wireguard.portal.stateErrorTitle"),
          body: device.wgPortalError ?? t("wireguard.portal.stateError"),
        }
      case "running":
        return {
          tone: "ok" as const,
          title: t("wireguard.portal.stateRunning"),
          body: perClient
            ? t("wireguard.portal.stateRunningPerClient")
            : t("wireguard.portal.stateRunningLegacy"),
        }
      default:
        return {
          tone: "muted" as const,
          title: t("wireguard.portal.stateStarting"),
          body: t("wireguard.portal.stateStartingHint"),
        }
    }
  }
  const notice = portalStateNotice()

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
            (enabled && perClient && clients.length > 0)
          }
          onCheckedChange={(checked) => {
            if (!checked) {
              update.mutate({ deviceId: device.id, data: { enabled: false } })
              return
            }
            update.mutate({
              deviceId: device.id,
              data: {
                enabled: true,
                port: portValid ? port : DEFAULT_WIREGUARD_PORT,
                ...(perClient
                  ? {}
                  : { clientCidr: cidrValid ? cidrDraft.trim() : DEFAULT_LEGACY_CLIENT_CIDR }),
              },
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
          <p className="text-xs text-fg-3">{portalVersionHint}</p>

          {notice ? (
            <div
              className={
                notice.tone === "warn"
                  ? "flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] text-warn"
                  : notice.tone === "error"
                    ? "flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-danger"
                    : "flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-fg-2"
              }
            >
              {notice.tone === "warn" || notice.tone === "error" ? (
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 flex-none"
                />
              ) : (
                <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 flex-none" />
              )}
              <span className="text-pretty">
                <span className="font-medium">{notice.title}</span>{" "}
                {notice.body}
              </span>
            </div>
          ) : null}

          {device.lastPushError ? (
            <div className="flex flex-col gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-2">
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 flex-none text-danger"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium text-danger">
                    {t("wireguard.deviceError.title")}
                  </span>
                  {/* The device's own words, exactly as reported. */}
                  <span className="break-words font-mono text-xs text-fg-2">
                    {device.lastPushError}
                  </span>
                </div>
              </div>
              <Button
                className="self-start"
                disabled={!canManage || retry.isPending}
                onClick={() => retry.mutate({ deviceId: device.id })}
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCwIcon className="size-4" />
                {t("wireguard.drift.retryNow")}
              </Button>
            </div>
          ) : null}

          {device.driftReason ? (
            <div className="flex flex-col gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-2">
                <RefreshCwIcon
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 flex-none text-fg-3"
                />
                <span className="text-pretty text-fg-2">
                  <span className="font-medium">{t("wireguard.drift.title")}</span>{" "}
                  {t("wireguard.drift.body", {
                    count: device.driftAttempts,
                  })}
                </span>
              </div>
              <Button
                className="self-start"
                disabled={!canManage || retry.isPending}
                onClick={() => retry.mutate({ deviceId: device.id })}
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCwIcon className="size-4" />
                {t("wireguard.drift.retryNow")}
              </Button>
            </div>
          ) : null}

          {enabled ? (
            <>
              <form
                className="flex flex-col gap-1.5 sm:max-w-[320px]"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!portValid || (!perClient && !cidrValid)) return
                  update.mutate({
                    deviceId: device.id,
                    data: {
                      enabled: true,
                      port,
                      ...(perClient ? {} : { clientCidr: cidrDraft.trim() }),
                    },
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
                  {!perClient ? (
                    <Input
                      aria-invalid={!cidrValid}
                      aria-label={t("wireguard.portal.legacyCidr")}
                      className="h-11 sm:h-10"
                      disabled={!isAdmin || update.isPending}
                      onChange={(event) => setCidrDraft(event.target.value)}
                      value={cidrDraft}
                    />
                  ) : null}
                  <Button
                    disabled={
                      !isAdmin ||
                      update.isPending ||
                      !portValid ||
                      (!perClient && !cidrValid) ||
                      (port === device.wgListenPort &&
                        (perClient || cidrDraft.trim() === device.wgLegacyClientCidr))
                    }
                    size="sm"
                    type="submit"
                    variant="outline"
                  >
                    {t("wireguard.portal.save")}
                  </Button>
                </div>
                <p
                  className={portValid && (perClient || cidrValid) ? "text-xs text-fg-3" : "text-xs text-warn"}
                  id={`wg-port-hint-${device.id}`}
                >
                  {!portValid
                    ? t("wireguard.portal.portInvalid")
                    : !perClient && !cidrValid
                      ? t("wireguard.portal.legacyCidrInvalid")
                      : perClient
                        ? t("wireguard.portal.portHint")
                        : t("wireguard.portal.legacyCidrHint")}
                </p>
              </form>

              {!perClient ? (
                <div className="flex flex-col gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-fg-2">
                  <p className="flex items-start gap-1.5 text-pretty">
                    <InfoIcon
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 flex-none text-fg-3"
                    />
                    {t("wireguard.portal.legacyHint", {
                      url: `wg://0.0.0.0:${portValid ? port : DEFAULT_WIREGUARD_PORT}/${cidrValid ? cidrDraft.trim() : DEFAULT_LEGACY_CLIENT_CIDR}`,
                    })}
                  </p>
                  <Button
                    className="self-start"
                    onClick={() => setSharedConfigOpen(true)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <ExternalLinkIcon className="size-4" />
                    {t("wireguard.portal.showSharedConfig")}
                  </Button>
                </div>
              ) : null}

              {perClient ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[13px] font-semibold">
                      {t("wireguard.portal.clients")}
                    </h3>
                    {canManage ? (
                      <Button
                        disabled={device.wgPortalState === "unsupported"}
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
              ) : (
                <p className="text-xs text-fg-3">{t("wireguard.portal.legacyNoClients")}</p>
              )}

              {enabled && perClient && clients.length > 0 ? (
                <p className="text-xs text-fg-3">
                  {t("wireguard.portal.disableBlocked")}
                </p>
              ) : null}

              <p className="flex items-start gap-1.5 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-pretty text-fg-2">
                <InfoIcon
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 flex-none text-fg-3"
                />
                {t("wireguard.portal.routerHint")}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-pretty text-fg-3">
              {perClient
                ? t("wireguard.portal.defaultPort", { port: DEFAULT_WIREGUARD_PORT })
                : t("wireguard.portal.defaultLegacyPort", {
                    port: DEFAULT_WIREGUARD_PORT,
                    cidr: DEFAULT_LEGACY_CLIENT_CIDR,
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
      <WireguardSharedConfigDialog
        deviceId={device.id}
        onOpenChange={setSharedConfigOpen}
        open={sharedConfigOpen}
      />
    </section>
  )
}
