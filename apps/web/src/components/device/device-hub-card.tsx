import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { RadioTowerIcon } from "lucide-react"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

/**
 * Hub card. "Hub" is the product word (the API still calls the role anchor in
 * access mode); endpoints are network state, not revision content, so saving
 * repushes the devices that dial this one and creates no revision.
 *
 * The form is only editable while there are changes to save: Save and Cancel
 * appear when the draft differs from what the server has, so nobody wonders
 * whether typing already saved something.
 */
export function DeviceHubCard({ device }: { device: GetDevice200 }) {
  const { t } = useTranslation()
  const { canManage, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const saved = device.advertisedEndpoints.join("\n")
  // Baseline + draft in one state so a server-side update resets the form
  // without an effect (and without losing an in-progress edit).
  const [draft, setDraft] = useState({ base: saved, value: saved })
  const endpoints = draft.base === saved ? draft.value : saved
  const dirty = endpoints !== saved

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
        toast.success(t("devices.detail.endpoints.saved"))
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const updateHub = useUpdateDeviceHub({
    mutation: {
      onSuccess: async (_response, variables) => {
        toast.success(
          variables.data.isHub
            ? t("devices.detail.hub.enabled")
            : t("devices.detail.hub.disabled")
        )
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const empty = endpoints.trim() === ""

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

      <form
        className="flex flex-col gap-2 px-4 pb-4 sm:px-5"
        onSubmit={(event) => {
          event.preventDefault()
          updateEndpoints.mutate({
            deviceId: device.id,
            data: {
              endpoints: endpoints
                .split("\n")
                .map((entry) => entry.trim())
                .filter(Boolean),
            },
          })
        }}
      >
        <label
          className="text-[13px] font-medium"
          htmlFor={`endpoints-${device.id}`}
        >
          {t("devices.detail.endpoints.title")}
        </label>
        <Textarea
          aria-describedby={`endpoints-hint-${device.id}`}
          className="min-h-[88px] font-mono text-xs"
          disabled={!canManage || updateEndpoints.isPending}
          id={`endpoints-${device.id}`}
          onChange={(event) =>
            setDraft({ base: saved, value: event.target.value })
          }
          placeholder={t("devices.detail.endpoints.placeholder")}
          rows={3}
          value={endpoints}
        />
        <p
          className={empty ? "text-xs text-warn" : "text-xs text-fg-3"}
          id={`endpoints-hint-${device.id}`}
        >
          {empty
            ? t("devices.detail.endpoints.emptyHint")
            : device.isHub
              ? t("devices.detail.endpoints.hint")
              : t("device.hub.endpointsInactive")}
        </p>
        {canManage && dirty ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={updateEndpoints.isPending}
              size="sm"
              type="submit"
              variant="outline"
            >
              {updateEndpoints.isPending
                ? t("common.loading")
                : t("devices.detail.endpoints.save")}
            </Button>
            <Button
              disabled={updateEndpoints.isPending}
              onClick={() => setDraft({ base: saved, value: saved })}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  )
}
