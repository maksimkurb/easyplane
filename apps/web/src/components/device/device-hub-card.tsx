import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { InfoIcon, RadioTowerIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getGetNetworkQueryKey,
  getListNetworkPeersQueryKey,
  useUpdateDeviceEndpoints,
  useUpdateDeviceHub,
} from "@/api/generated/easyplane"
import type { GetDevice200 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** Port EasyTier binds when the listen port field is empty. */
const DEFAULT_LISTEN_PORT = 11010

const ADDRESS_KINDS = [
  { scheme: "tcp", example: "tcp://example.com:11010" },
  { scheme: "udp", example: "udp://203.0.113.5:11010" },
  { scheme: "ws", example: "ws://example.com:11011" },
  { scheme: "wss", example: "wss://example.com:443" },
  { scheme: "quic", example: "quic://example.com:11012" },
  { scheme: "wg", example: "wg://example.com:11013" },
] as const

type PortDraft = number | null | "invalid"

function parsePort(value: string): PortDraft {
  const trimmed = value.trim()
  if (trimmed === "") return null
  if (!/^\d+$/.test(trimmed)) return "invalid"
  const port = Number(trimmed)
  return port >= 1 && port <= 65535 ? port : "invalid"
}

function portText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value)
}

interface Draft {
  endpoints: string
  listenPort: string
  externalPort: string
}

/**
 * Hub card. "Hub" is the product word (the API still calls the role anchor in
 * access mode); endpoints are network state, not revision content, so saving
 * repushes the devices that dial this one and creates no revision.
 *
 * A hub listens on its port and advertises the public address detected for it;
 * the extra addresses are only for DDNS names or other transports. The public
 * IPv4 is found automatically, so most users only flip the switch.
 */
export function DeviceHubCard({ device }: { device: GetDevice200 }) {
  const { t } = useTranslation()
  const { canManage, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const saved: Draft = {
    endpoints: device.advertisedEndpoints.join("\n"),
    listenPort: portText(device.listenPort),
    externalPort: portText(device.externalPort),
  }
  // Baseline + draft in one state so a server-side update resets the form
  // without an effect (and without losing an in-progress edit).
  const savedKey = JSON.stringify(saved)
  const [draftState, setDraftState] = useState({ base: savedKey, value: saved })
  const [addressInfoOpen, setAddressInfoOpen] = useState(false)
  const draft = draftState.base === savedKey ? draftState.value : saved
  const dirty = JSON.stringify(draft) !== savedKey

  const updateDraft = (patch: Partial<Draft>) =>
    setDraftState({ base: savedKey, value: { ...draft, ...patch } })

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: getGetDeviceQueryKey(device.id),
    })
    await queryClient.invalidateQueries({
      queryKey: getListNetworkPeersQueryKey(device.networkId),
    })
    await queryClient.invalidateQueries({
      queryKey: getGetNetworkQueryKey(device.networkId),
    })
  }

  const updateEndpoints = useUpdateDeviceEndpoints({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.detail.hub.endpointsSaved"))
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const updateHub = useUpdateDeviceHub({
    mutation: {
      onSuccess: async (_response, variables) => {
        if (device.isHub === variables.data.isHub) {
          toast.success(t("devices.detail.hub.saved"))
        } else {
          toast.success(
            variables.data.isHub
              ? t("devices.detail.hub.enabled")
              : t("devices.detail.hub.disabled")
          )
        }
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const listenPort = parsePort(draft.listenPort)
  const externalPort = parsePort(draft.externalPort)
  const portsInvalid = listenPort === "invalid" || externalPort === "invalid"
  const effectiveListenPort =
    typeof listenPort === "number" ? listenPort : DEFAULT_LISTEN_PORT
  const effectiveExternalPort =
    typeof externalPort === "number" ? externalPort : effectiveListenPort
  const autoEndpoints = device.publicIps.map(
    (address) => `tcp://${address}:${effectiveExternalPort}`
  )
  const externalPlaceholder =
    draft.listenPort.trim() !== ""
      ? draft.listenPort.trim()
      : String(DEFAULT_LISTEN_PORT)

  const endpoints = draft.endpoints
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
  const saving = isAdmin ? updateHub.isPending : updateEndpoints.isPending

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base leading-6 font-semibold tracking-[-0.006em]">
            <RadioTowerIcon aria-hidden="true" className="size-4 text-fg-2" />
            {t("devices.detail.hub.title")}
          </h2>
          <p className="text-[13px] text-fg-3">{t("device.hub.description")}</p>
        </div>
        <Switch
          aria-label={t("devices.detail.hub.title")}
          checked={device.isHub}
          disabled={!isAdmin || updateHub.isPending}
          onCheckedChange={(checked) =>
            updateHub.mutate({ deviceId: device.id, data: { isHub: checked } })
          }
        />
      </div>

      {device.isHub ? (
        <form
          className="flex flex-col gap-4 px-4 pb-4 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (portsInvalid) return
            if (isAdmin) {
              updateHub.mutate({
                deviceId: device.id,
                data: {
                  isHub: true,
                  listenPort,
                  externalPort,
                  endpoints,
                },
              })
            } else {
              updateEndpoints.mutate({
                deviceId: device.id,
                data: { endpoints },
              })
            }
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[13px]"
                htmlFor={`listen-port-${device.id}`}
              >
                {t("devices.detail.hub.listenPort.label")}
              </Label>
              <Input
                aria-describedby={`listen-port-hint-${device.id}`}
                aria-invalid={listenPort === "invalid"}
                className="h-11 sm:h-10"
                disabled={!isAdmin || saving}
                id={`listen-port-${device.id}`}
                inputMode="numeric"
                min={1}
                max={65535}
                onChange={(event) =>
                  updateDraft({ listenPort: event.target.value })
                }
                placeholder={String(DEFAULT_LISTEN_PORT)}
                type="number"
                value={draft.listenPort}
              />
              <p
                className={
                  listenPort === "invalid"
                    ? "text-xs text-warn"
                    : "text-xs text-fg-3"
                }
                id={`listen-port-hint-${device.id}`}
              >
                {listenPort === "invalid"
                  ? t("devices.detail.hub.listenPort.invalid")
                  : t("devices.detail.hub.listenPort.hint")}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[13px]"
                htmlFor={`external-port-${device.id}`}
              >
                {t("devices.detail.hub.externalPort.label")}
              </Label>
              <Input
                aria-describedby={`external-port-hint-${device.id}`}
                aria-invalid={externalPort === "invalid"}
                className="h-11 sm:h-10"
                disabled={!isAdmin || saving}
                id={`external-port-${device.id}`}
                inputMode="numeric"
                min={1}
                max={65535}
                onChange={(event) =>
                  updateDraft({ externalPort: event.target.value })
                }
                placeholder={externalPlaceholder}
                type="number"
                value={draft.externalPort}
              />
              <p
                className={
                  externalPort === "invalid"
                    ? "text-xs text-warn"
                    : "text-xs text-fg-3"
                }
                id={`external-port-hint-${device.id}`}
              >
                {externalPort === "invalid"
                  ? t("devices.detail.hub.externalPort.invalid")
                  : t("devices.detail.hub.externalPort.hint")}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-lg bg-surface-2 px-3 py-2.5">
            <span className="text-[13px] font-medium">
              {t("devices.detail.hub.auto.label")}
            </span>
            {autoEndpoints.length > 0 ? (
              <span className="font-mono text-xs break-all text-fg-2">
                {autoEndpoints.join(", ")}
              </span>
            ) : (
              <span className="text-xs text-fg-3">
                {t("devices.detail.hub.auto.unknown")}
              </span>
            )}
          </div>

          <p className="text-xs text-pretty text-fg-3">
            {t("devices.detail.hub.routerHint")}
          </p>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <Label
                className="text-[13px]"
                htmlFor={`endpoints-${device.id}`}
              >
                {t("devices.detail.hub.extra.label")}
              </Label>
              <Tooltip open={addressInfoOpen} onOpenChange={setAddressInfoOpen}>
                <TooltipTrigger
                  render={
                    <button
                      aria-label={t("devices.detail.hub.extra.infoLabel")}
                      className="grid size-11 flex-none cursor-pointer place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:size-8"
                      onClick={() =>
                        setAddressInfoOpen((open) => !open)
                      }
                      type="button"
                    />
                  }
                >
                  <InfoIcon className="size-4 sm:size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm text-pretty" side="bottom">
                  <span className="flex flex-col gap-1.5">
                    <span className="font-medium">
                      {t("devices.detail.hub.extra.infoTitle")}
                    </span>
                    <span className="flex flex-col gap-1">
                      {ADDRESS_KINDS.map((kind) => (
                        <span key={kind.scheme}>
                          <code>{kind.example}</code>{" "}
                          {t(
                            `devices.detail.hub.extra.kinds.${kind.scheme}` as const
                          )}
                        </span>
                      ))}
                    </span>
                  </span>
                </TooltipContent>
              </Tooltip>
            </div>
            <Textarea
              aria-describedby={`endpoints-hint-${device.id}`}
              className="min-h-[88px] font-mono text-xs break-all"
              disabled={!canManage || saving}
              id={`endpoints-${device.id}`}
              onChange={(event) =>
                updateDraft({ endpoints: event.target.value })
              }
              placeholder={t("devices.detail.hub.extra.placeholder")}
              rows={6}
              value={draft.endpoints}
            />
            <p
              className="text-xs text-pretty text-fg-3"
              id={`endpoints-hint-${device.id}`}
            >
              {t("devices.detail.hub.extra.hint")}
            </p>
          </div>

          {canManage && dirty ? (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={saving || portsInvalid}
                size="sm"
                type="submit"
                variant="outline"
              >
                {saving
                  ? t("common.loading")
                  : t("devices.detail.hub.save")}
              </Button>
              <Button
                disabled={saving}
                onClick={() =>
                  setDraftState({ base: savedKey, value: saved })
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  )
}
