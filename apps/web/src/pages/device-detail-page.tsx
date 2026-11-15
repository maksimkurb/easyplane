import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "wouter"
import {
  ArrowLeftIcon,
  HistoryIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  WaypointsIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getListDeviceRevisionsQueryKey,
  useCreateDeviceRevision,
  useGetDevice,
  useListDeviceRevisions,
  usePushDeviceConfig,
  useRollbackDeviceRevision,
} from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { DevicePeersCard } from "@/components/device-peers-card"
import { DevicePolicyCard } from "@/components/device-policy-card"
import { DeviceStatusBadges } from "@/components/device-status"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Field, FieldGroup, FieldLabel } from "@/components/shared/field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function DeviceDetailPage() {
  const { t } = useTranslation()
  const { id = "" } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { canManage } = useAuth()

  const deviceQuery = useGetDevice(id)
  const revisionsQuery = useListDeviceRevisions(id)
  const push = usePushDeviceConfig({
    mutation: {
      onSuccess: () => toast.success(t("devices.pushRequested")),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const device = deviceQuery.data?.data
  const revisions = revisionsQuery.data?.data ?? []
  const latest = revisions[0]

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: getGetDeviceQueryKey(id) })
    await queryClient.invalidateQueries({ queryKey: getListDeviceRevisionsQueryKey(id) })
  }

  const rollback = useRollbackDeviceRevision({
    mutation: {
      onSuccess: async (_response, variables) => {
        toast.success(t("devices.detail.rolledBack", { revision: variables.revision }))
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  if (deviceQuery.isLoading) return <Skeleton className="h-64 w-full" />
  if (!device) return <p className="text-sm text-muted-foreground">{t("common.notFound")}</p>

  return (
    <>
      <PageHeader
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/topology?network=${device.networkId}`}>
              <Button variant="outline">
                <WaypointsIcon className="size-4" />
                {t("topology.title")}
              </Button>
            </Link>
            {canManage ? (
              <Button
                disabled={push.isPending}
                onClick={() => push.mutate({ deviceId: device.id })}
                variant="outline"
              >
                <RefreshCwIcon className="size-4" />
                {t("devices.push")}
              </Button>
            ) : null}
          </div>
        }
        description={device.machineId}
        title={
          <span className="flex items-center gap-2">
            <Link className="text-muted-foreground hover:text-foreground" href="/devices">
              <ArrowLeftIcon className="size-5" />
            </Link>
            {device.hostname || t("devices.detail.title")}
          </span>
        }
      />

      <div className="grid gap-4">
        <SectionCard title={t("devices.detail.overview")}>
          <div className="mb-3">
            <DeviceStatusBadges
              online={device.online}
              state={device.state}
              sync={device.sync}
            />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Info label={t("devices.hostname")} value={device.hostname} />
            <Info label={t("networks.title")} value={device.networkName} />
            <Info label={t("devices.virtualIp")} value={device.virtualIpv4} mono />
            <Info label={t("devices.os")} value={`${device.os.distribution || device.os.type} ${device.os.version}`.trim()} />
            <Info label={t("devices.version")} value={device.easytierVersion} mono />
            <Info label={t("devices.sourceIp")} value={device.sourceIp} mono />
            <Info
              label={t("devices.lastSeen")}
              value={
                device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : null
              }
            />
            <Info label={t("devices.desiredRevision")} value={device.desiredRevision?.toString()} />
            <Info label={t("devices.appliedRevision")} value={device.appliedRevision?.toString()} />
          </dl>
          {device.lastPushError ? (
            <p className="mt-3 rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-300">
              {t("devices.pushError")}: {device.lastPushError}
            </p>
          ) : null}
        </SectionCard>

        <DevicePeersCard device={device} />

        <DevicePolicyCard deviceId={device.id} />

        {canManage && device.state === "approved" ? (
          <SectionCard
            description={t("devices.detail.editHint")}
            title={t("devices.detail.newRevision")}
          >
            <RevisionForm
              deviceId={device.id}
              initial={latest?.config as Record<string, unknown> | undefined}
              key={latest?.id ?? "none"}
              onSaved={refresh}
            />
          </SectionCard>
        ) : null}

        <SectionCard
          action={<HistoryIcon className="size-4 text-muted-foreground" />}
          title={t("devices.detail.history")}
        >
          {revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("common.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>{t("devices.detail.source.manual")}</TableHead>
                    <TableHead>{t("devices.detail.note")}</TableHead>
                    <TableHead>{t("devices.detail.createdBy")}</TableHead>
                    <TableHead>{t("common.created")}</TableHead>
                    <TableHead className="text-right">{t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revisions.map((revision) => (
                    <TableRow key={revision.id}>
                      <TableCell className="font-mono">{revision.revision}</TableCell>
                      <TableCell className="text-xs">
                        {t(`devices.detail.source.${revision.source}`)}
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-xs">
                        {revision.note || t("common.none")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {revision.createdByEmail ?? t("devices.detail.system")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(revision.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage ? (
                          <Button
                            disabled={rollback.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("devices.detail.rollbackConfirm", {
                                    revision: revision.revision,
                                  })
                                )
                              ) {
                                rollback.mutate({
                                  deviceId: device.id,
                                  revision: revision.revision,
                                })
                              }
                            }}
                            size="sm"
                            variant="outline"
                          >
                            <RotateCcwIcon className="size-4" />
                            {t("devices.detail.rollback")}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        {latest ? (
          <SectionCard title={t("devices.detail.config")}>
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
              {JSON.stringify(latest.config, null, 2)}
            </pre>
            <p className="text-xs text-muted-foreground">{t("networks.secretHidden")}</p>
          </SectionCard>
        ) : null}
      </div>
    </>
  )
}

function RevisionForm({
  deviceId,
  initial,
  onSaved,
}: {
  deviceId: string
  initial?: Record<string, unknown>
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [noTun, setNoTun] = useState(initial?.noTun === true)
  const [acceptRoutes, setAcceptRoutes] = useState(initial?.acceptRoutes === true)
  const [note, setNote] = useState("")

  const createRevision = useCreateDeviceRevision({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.detail.revisionCreated"))
        setNote("")
        await onSaved()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        createRevision.mutate({
          deviceId,
          data: {
            config: {
              noTun,
              acceptRoutes,
            },
            note: note || undefined,
          },
        })
      }}
    >
      <FieldGroup className="gap-4">
        <Field className="gap-2 sm:max-w-64">
          <FieldLabel htmlFor="revision-note">{t("devices.detail.note")}</FieldLabel>
          <Input
            id="revision-note"
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
        </Field>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={noTun}
              onCheckedChange={(checked) => setNoTun(checked === true)}
            />
            {t("devices.detail.noTun")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={acceptRoutes}
              onCheckedChange={(checked) => setAcceptRoutes(checked === true)}
            />
            {t("devices.detail.acceptRoutes")}
          </label>
        </div>
        <Button className="w-fit" disabled={createRevision.isPending} type="submit">
          {createRevision.isPending
            ? t("common.loading")
            : t("devices.detail.newRevision")}
        </Button>
      </FieldGroup>
    </form>
  )
}

function Info({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : ""}>
        {value && value.length > 0 ? value : t("common.none")}
      </dd>
    </div>
  )
}
