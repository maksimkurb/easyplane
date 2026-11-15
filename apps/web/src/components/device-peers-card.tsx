import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { NetworkIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  useUpdateDeviceEndpoints,
  useUpdateDeviceHub,
} from "@/api/generated/easyplane"
import type { GetDevice200 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { SectionCard } from "@/components/shared/section-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

/**
 * Advertised endpoints + the hub switch. Both are network state, not revision
 * content: saving repushes the devices that dial this one (idempotent, audited)
 * without creating a revision. The hub switch adds/removes the device-backed
 * entry in the network's peer list.
 */
export function DevicePeersCard({ device }: { device: GetDevice200 }) {
  const { t } = useTranslation()
  const { canManage, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [endpoints, setEndpoints] = useState(device.advertisedEndpoints.join("\n"))

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: getGetDeviceQueryKey(device.id) })
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

  return (
    <SectionCard
      action={<NetworkIcon className="size-4 text-muted-foreground" />}
      description={t("devices.detail.endpoints.hint")}
      title={t("devices.detail.endpoints.title")}
    >
      <form
        className="grid gap-3"
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
        <Textarea
          aria-label={t("devices.detail.endpoints.title")}
          disabled={!canManage || updateEndpoints.isPending}
          onChange={(event) => setEndpoints(event.target.value)}
          placeholder={t("devices.detail.endpoints.placeholder")}
          rows={3}
          value={endpoints}
        />
        {canManage ? (
          <Button
            className="w-fit"
            disabled={updateEndpoints.isPending}
            size="sm"
            type="submit"
          >
            {updateEndpoints.isPending
              ? t("common.loading")
              : t("devices.detail.endpoints.save")}
          </Button>
        ) : null}
      </form>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3 border-t pt-4">
        <div className="max-w-xl space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {t("devices.detail.hub.title")}
            {device.isHub ? (
              <Badge variant="default">{t("devices.detail.hub.badge")}</Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("devices.detail.hub.hint")}
          </p>
        </div>
        <Button
          disabled={!isAdmin || updateHub.isPending}
          onClick={() =>
            updateHub.mutate({
              deviceId: device.id,
              data: { isHub: !device.isHub },
            })
          }
          type="button"
          variant={device.isHub ? "default" : "outline"}
        >
          {device.isHub ? t("devices.detail.hub.badge") : t("devices.detail.hub.title")}
        </Button>
      </div>
    </SectionCard>
  )
}
