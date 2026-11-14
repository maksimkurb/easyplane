import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { PlusIcon, TagIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getListDeviceRoutesQueryKey,
  getListTagsQueryKey,
  useCreateTag,
  useGetDevice,
  useListDeviceRoutes,
  useListTags,
  useRenameDevice,
  useRequestDeviceRoute,
  useSetDeviceTags,
} from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { SectionCard } from "@/components/shared/section-card"
import { Field, FieldGroup, FieldLabel } from "@/components/shared/field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/** Device identity (unique DNS name), tags and route requests. */
export function DevicePolicyCard({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation()
  const { canManage, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const deviceQuery = useGetDevice(deviceId)
  const tagsQuery = useListTags()
  const routesQuery = useListDeviceRoutes(deviceId)
  const device = deviceQuery.data?.data
  const [dnsName, setDnsName] = useState("")
  const [newTag, setNewTag] = useState("")
  const [routeKind, setRouteKind] = useState<"subnet" | "exit_node">("subnet")
  const [cidr, setCidr] = useState("")
  const [note, setNote] = useState("")

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: getGetDeviceQueryKey(deviceId) })
    await queryClient.invalidateQueries({ queryKey: getListDeviceRoutesQueryKey(deviceId) })
  }

  const rename = useRenameDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("magicDns.renamed"))
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const setTags = useSetDeviceTags({
    mutation: {
      onSuccess: refresh,
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const createTag = useCreateTag({
    mutation: {
      onSuccess: async () => {
        setNewTag("")
        await queryClient.invalidateQueries({ queryKey: getListTagsQueryKey() })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const requestRoute = useRequestDeviceRoute({
    mutation: {
      onSuccess: async () => {
        toast.success(t("routes.requested"))
        setCidr("")
        setNote("")
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  if (!device) return null
  const tags = tagsQuery.data?.data ?? []
  const routes = routesQuery.data?.data ?? []
  const report = (device.reportedState as { routeReport?: Record<string, unknown> })
    .routeReport

  return (
    <SectionCard
      action={<TagIcon className="size-4 text-muted-foreground" />}
      description={t("devices.detail.identityHint")}
      title={t("devices.detail.identity")}
    >
      <FieldGroup className="gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field className="max-w-64 gap-1">
            <FieldLabel htmlFor="device-dns">{t("magicDns.label")}</FieldLabel>
            <Input
              className="font-mono text-xs"
              disabled={!canManage}
              id="device-dns"
              onChange={(event) => setDnsName(event.target.value)}
              placeholder={device.dnsName ?? ""}
              value={dnsName}
            />
          </Field>
          <span className="pb-1 font-mono text-xs text-muted-foreground">
            {device.magicDnsName ?? `${device.dnsName ?? ""}.${device.magicDnsZone}`}
          </span>
          {canManage ? (
            <Button
              disabled={dnsName.trim() === "" || rename.isPending}
              onClick={() => rename.mutate({ deviceId, data: { dnsName: dnsName.trim() } })}
              size="sm"
              variant="outline"
            >
              {t("magicDns.rename")}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t("policy.tags")}:</span>
          {tags.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t("common.empty")}</span>
          ) : (
            tags.map((tag) => (
              <label className="flex items-center gap-1.5 text-xs" key={tag.id}>
                <Checkbox
                  checked={device.tags.includes(tag.name)}
                  disabled={!canManage}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...device.tags, tag.name]
                      : device.tags.filter((name) => name !== tag.name)
                    setTags.mutate({ deviceId, data: { tags: next } })
                  }}
                />
                <span className="font-mono">{tag.name}</span>
              </label>
            ))
          )}
          {isAdmin ? (
            <span className="flex items-center gap-1">
              <Input
                className="h-8 w-36"
                onChange={(event) => setNewTag(event.target.value)}
                placeholder="tag:server"
                value={newTag}
              />
              <Button
                disabled={newTag.trim() === ""}
                onClick={() => createTag.mutate({ data: { name: newTag.trim() } })}
                size="sm"
                variant="ghost"
              >
                <PlusIcon className="size-4" />
              </Button>
            </span>
          ) : null}
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-40 gap-1">
              <FieldLabel>{t("routes.kind")}</FieldLabel>
              <Select
                onValueChange={(value) => value && setRouteKind(value as "subnet" | "exit_node")}
                value={routeKind}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subnet">{t("routes.subnet")}</SelectItem>
                  <SelectItem value="exit_node">{t("routes.exitNode")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {routeKind === "subnet" ? (
              <Field className="w-48 gap-1">
                <FieldLabel htmlFor="route-cidr">{t("routes.cidr")}</FieldLabel>
                <Input
                  className="font-mono text-xs"
                  id="route-cidr"
                  onChange={(event) => setCidr(event.target.value)}
                  placeholder="192.168.50.0/24"
                  value={cidr}
                />
              </Field>
            ) : null}
            <Field className="w-52 gap-1">
              <FieldLabel htmlFor="route-note">{t("policy.note")}</FieldLabel>
              <Input
                id="route-note"
                onChange={(event) => setNote(event.target.value)}
                value={note}
              />
            </Field>
            <Button
              disabled={requestRoute.isPending || (routeKind === "subnet" && cidr.trim() === "")}
              onClick={() =>
                requestRoute.mutate({
                  deviceId,
                  data: {
                    kind: routeKind,
                    ...(routeKind === "subnet" ? { cidr: cidr.trim() } : {}),
                    ...(note ? { note } : {}),
                  },
                })
              }
              size="sm"
              variant="outline"
            >
              {t("routes.request")}
            </Button>
          </div>
        ) : null}

        {routes.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("routes.kind")}</TableHead>
                  <TableHead>{t("routes.cidr")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("policy.note")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((route) => (
                  <TableRow key={route.id}>
                    <TableCell className="text-xs">
                      {route.kind === "subnet" ? t("routes.subnet") : t("routes.exitNode")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {route.cidr || "0.0.0.0/0"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          route.state === "approved"
                            ? "success"
                            : route.state === "rejected"
                              ? "destructive"
                              : "warning"
                        }
                      >
                        {t(`routes.state.${route.state}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-xs">{route.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {report ? (
          <div className="rounded border p-3 text-xs">
            <p className="mb-1 font-medium">{t("routes.reportTitle")}</p>
            <dl className="grid gap-1 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("routes.approved")}</dt>
                <dd className="font-mono">
                  {(report.approvedCidrs as string[] | undefined)?.join(", ") || t("common.none")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("routes.configured")}</dt>
                <dd className="font-mono">
                  {(report.configuredCidrs as string[] | undefined)?.join(", ") || t("common.none")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("routes.unapproved")}</dt>
                <dd className="font-mono">
                  {[
                    ...((report.unapprovedCidrs as string[] | undefined) ?? []),
                    ...((report.unapprovedObservedCidrs as string[] | undefined) ?? []),
                  ].join(", ") || t("common.none")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("routes.exitNodeSeen")}</dt>
                <dd>{report.reportedExitNode ? t("common.yes") : t("common.no")}</dd>
              </div>
            </dl>
            <p className="mt-2 text-muted-foreground">{t("routes.deviceHonestNote")}</p>
          </div>
        ) : (
          <Alert>
            <AlertDescription className="text-xs">{t("routes.noReportYet")}</AlertDescription>
          </Alert>
        )}
      </FieldGroup>
    </SectionCard>
  )
}
