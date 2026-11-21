import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import {
  GlobeIcon,
  InfoIcon,
  PlusIcon,
  RouteIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getListDeviceRoutesQueryKey,
  getListDeviceRevisionsQueryKey,
  getListDevicesQueryKey,
  getListNetworkRoutesQueryKey,
  useCreateDeviceRevision,
  useDecideDeviceRoute,
  useListDeviceRevisions,
  useRequestDeviceRoute,
} from "@/api/generated/easyplane"
import type {
  GetDevice200,
  ListDeviceRoutes200Item,
} from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Chip } from "@/components/ui/chip"
import { Input } from "@/components/ui/input"
import { Segmented } from "@/components/ui/segmented"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { retryableQuery } from "@/lib/query-retry"

function stateVariant(state: ListDeviceRoutes200Item["state"]) {
  return state === "approved" ? "ok" : state === "rejected" ? "err" : "warn"
}

/**
 * Routes a device shares with the mesh. The decision actions are isolated here
 * (and the chips in device-route-chips) so the upcoming "declared by device"
 * proposal changes have one place to land.
 */
export function DeviceRoutesCard({
  device,
  routes,
}: {
  device: GetDevice200
  routes: ListDeviceRoutes200Item[]
}) {
  const { t } = useTranslation()
  const { isAdmin, canManage } = useAuth()
  const queryClient = useQueryClient()
  const revisionsQuery = useListDeviceRevisions(device.id, {
    query: retryableQuery,
  })
  const [requestOpen, setRequestOpen] = useState(false)
  const [kind, setKind] = useState<"subnet" | "exit_node">("subnet")
  const [cidr, setCidr] = useState("")
  const [note, setNote] = useState("")

  const latest = revisionsQuery.data?.data?.[0]
  const latestConfig = (latest?.config ?? {}) as Record<string, unknown>
  const acceptRoutes = latestConfig.acceptRoutes === true

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: getListDeviceRoutesQueryKey(device.id),
    })
    await queryClient.invalidateQueries({
      queryKey: getListDeviceRevisionsQueryKey(device.id),
    })
    await queryClient.invalidateQueries({
      queryKey: getGetDeviceQueryKey(device.id),
    })
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
    await queryClient.invalidateQueries({
      queryKey: getListNetworkRoutesQueryKey(device.networkId),
    })
  }

  const decide = useDecideDeviceRoute({
    mutation: {
      onSuccess: async () => {
        toast.success(t("routes.decided"))
        await invalidate()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const request = useRequestDeviceRoute({
    mutation: {
      onSuccess: async () => {
        toast.success(t("routes.requested"))
        setCidr("")
        setNote("")
        setRequestOpen(false)
        await invalidate()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const createRevision = useCreateDeviceRevision({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.detail.revisionCreated"))
        await invalidate()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const ordered = [...routes].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "exit_node" ? -1 : 1
  )

  const decideRoute = (
    route: ListDeviceRoutes200Item,
    state: "approved" | "rejected"
  ) => decide.mutate({ routeId: route.id, data: { state } })

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:gap-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
            {t("routes.deviceTitle")}
          </h2>
          <p className="text-[13px] text-fg-3">{t("routes.deviceHint")}</p>
        </div>
        {canManage ? (
          <Button
            className="max-sm:w-full max-sm:justify-center"
            onClick={() => setRequestOpen((open) => !open)}
            size="sm"
            variant="ghost"
          >
            <PlusIcon className="size-4" />
            {t("routes.request")}
          </Button>
        ) : null}
      </div>

      {ordered.length === 0 ? (
        <p className="border-t border-line px-4 py-5 text-[13px] text-fg-3 sm:px-5">
          {t("routes.deviceEmpty")}
        </p>
      ) : (
        <div>
          {ordered.map((route) => {
            const exitNode = route.kind === "exit_node"
            return (
              <div
                className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-2.5 sm:flex-nowrap sm:px-5"
                key={route.id}
              >
                <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
                  {exitNode ? (
                    <GlobeIcon aria-hidden="true" className="size-4" />
                  ) : (
                    <RouteIcon aria-hidden="true" className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {exitNode ? t("routes.exitNode") : t("routes.subnet")}
                    </span>
                    <span className="font-mono text-xs text-fg-3">
                      {exitNode ? "0.0.0.0/0" : route.cidr}
                    </span>
                    <Chip variant={stateVariant(route.state)}>
                      {t(`routes.state.${route.state}`)}
                    </Chip>
                    {route.source === "device_declared" ? (
                      <Chip>{t("routes.declaredByDevice")}</Chip>
                    ) : null}
                    {route.source === "device_declared" && !route.advertised ? (
                      <Chip variant="warn">
                        {t("routes.noLongerAdvertised")}
                      </Chip>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-fg-3">
                    {route.note ||
                      (route.state === "approved"
                        ? t("routes.approvedRouteHint")
                        : t("routes.deviceRouteHint"))}
                  </p>
                </div>

                {isAdmin ? (
                  <label className="flex flex-none items-center gap-2 text-[13px] text-fg-2">
                    <span className="max-sm:sr-only">
                      {t("routes.allow")}
                    </span>
                    <Switch
                      aria-label={t("routes.allowFor", {
                        route: exitNode
                          ? t("routes.exitNode")
                          : (route.cidr ?? t("routes.subnet")),
                      })}
                      checked={route.state === "approved"}
                      disabled={decide.isPending}
                      onCheckedChange={(checked) =>
                        decideRoute(route, checked ? "approved" : "rejected")
                      }
                    />
                  </label>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-start gap-2.5 border-t border-line px-4 py-3 sm:px-5">
        <Checkbox
          aria-label={t("devices.detail.acceptRoutes")}
          checked={acceptRoutes}
          className="mt-0.5"
          disabled={!canManage || createRevision.isPending}
          id={`accept-routes-${device.id}`}
          onCheckedChange={(checked) =>
            createRevision.mutate({
              deviceId: device.id,
              data: {
                config: { ...latestConfig, acceptRoutes: checked === true },
                note: t("routes.acceptRoutesNote"),
              },
            })
          }
        />
        <div className="min-w-0">
          <label
            className="text-[13px] font-medium"
            htmlFor={`accept-routes-${device.id}`}
          >
            {t("devices.detail.acceptRoutes")}
          </label>
          <p className="text-xs text-fg-3">{t("routes.acceptRoutesHint")}</p>
        </div>
      </div>

      {requestOpen && canManage ? (
        <form
          className="flex flex-col gap-3 border-t border-line px-4 py-4 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault()
            request.mutate({
              deviceId: device.id,
              data: {
                kind,
                ...(kind === "subnet" ? { cidr: cidr.trim() } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
              },
            })
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">
                {t("routes.kind")}
              </span>
              <Segmented
                label={t("routes.kind")}
                onValueChange={setKind}
                options={[
                  { value: "subnet", label: t("routes.subnet") },
                  { value: "exit_node", label: t("routes.exitNode") },
                ]}
                value={kind}
              />
            </div>
            {kind === "subnet" ? (
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-[13px] font-medium">
                  {t("routes.cidr")}
                </span>
                <Input
                  className="font-mono"
                  onChange={(event) => setCidr(event.target.value)}
                  placeholder="192.168.50.0/24"
                  required
                  value={cidr}
                />
              </label>
            ) : null}
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[13px] font-medium">
                {t("routes.noteLabel")}
              </span>
              <Input
                onChange={(event) => setNote(event.target.value)}
                value={note}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={
                request.isPending || (kind === "subnet" && cidr.trim() === "")
              }
              type="submit"
            >
              {request.isPending ? t("common.loading") : t("routes.request")}
            </Button>
            <Button
              onClick={() => setRequestOpen(false)}
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="flex items-start gap-2 border-t border-line px-4 py-2.5 sm:px-5">
        <p className="min-w-0 flex-1 text-xs text-fg-3">
          {t("routes.deviceHonestNote")}
        </p>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                aria-label={t("routes.technicalDetails")}
                className="grid size-7 flex-none cursor-pointer place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                type="button"
              />
            }
          >
            <InfoIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-sm text-pretty">
            {t("routes.deviceTechnicalNote")}
          </TooltipContent>
        </Tooltip>
      </div>
    </section>
  )
}
