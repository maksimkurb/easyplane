import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  FileSearchIcon,
  FileUpIcon,
  LinkIcon,
  MonitorSmartphoneIcon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  getListNetworksQueryKey,
  useCommitNetworkImport,
  useListAdoptableInstances,
  useListDevices,
  useListNetworks,
  usePreviewNetworkImport,
} from "@/api/generated/easyplane"
import type { PreviewNetworkImport200 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { Field, FieldDescription, FieldLabel } from "@/components/shared/field"
import { OptionSelect } from "@/components/shared/option-select"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type ImportTab = "toml" | "shareLink" | "device"

const TABS: Array<{ id: ImportTab; icon: typeof FileUpIcon; label: string }> = [
  { id: "toml", icon: FileUpIcon, label: "toml" },
  { id: "shareLink", icon: LinkIcon, label: "shareLink" },
  { id: "device", icon: MonitorSmartphoneIcon, label: "device" },
]

/**
 * Import a network from EasyTier TOML, a `comp_cfg` share link, or the config a
 * connected device is actually running. The preview is produced and stored
 * server-side; the browser never receives the network secret. This used to be
 * a dialog, but source, diff and warnings need a full page to stay readable.
 */
export function NetworkImportPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<ImportTab>("toml")
  const [toml, setToml] = useState("")
  const [link, setLink] = useState("")
  const [deviceId, setDeviceId] = useState("")
  const [instanceId, setInstanceId] = useState("managed")
  const [existingId, setExistingId] = useState("none")
  const [preview, setPreview] = useState<PreviewNetworkImport200 | null>(null)
  const [name, setName] = useState("")
  const [cidr, setCidr] = useState("")

  const devicesQuery = useListDevices()
  const networksQuery = useListNetworks()
  const instancesQuery = useListAdoptableInstances(
    deviceId || "00000000-0000-0000-0000-000000000000",
    { query: { enabled: tab === "device" && deviceId !== "" } }
  )

  const eligibleDevices = useMemo(
    () =>
      (devicesQuery.data?.data ?? []).filter(
        (device) => device.online === "online" && device.state !== "blocked"
      ),
    [devicesQuery.data]
  )

  const previewMutation = usePreviewNetworkImport({
    mutation: {
      onSuccess: (result) => {
        const data = result.data
        setPreview(data)
        setName(data.network.name)
        setCidr(data.network.ipv4Cidr)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const commitMutation = useCommitNetworkImport({
    mutation: {
      onSuccess: async (result) => {
        toast.success(t("networks.import.committed"))
        await queryClient.invalidateQueries({ queryKey: getListNetworksQueryKey() })
        navigate("/networks")
        return result
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  function reset() {
    setPreview(null)
    setToml("")
    setLink("")
    setDeviceId("")
    setInstanceId("managed")
    setExistingId("none")
    setName("")
    setCidr("")
    previewMutation.reset()
    commitMutation.reset()
  }

  function sourcePayload() {
    if (tab === "toml") {
      return { type: "toml" as const, text: toml }
    }
    if (tab === "shareLink") {
      return { type: "shareLink" as const, link }
    }
    return {
      type: "device" as const,
      deviceId,
      ...(instanceId !== "managed" ? { instanceId } : {}),
    }
  }

  const ready =
    (tab === "toml" && toml.trim().length > 0) ||
    (tab === "shareLink" && link.trim().length > 0) ||
    (tab === "device" && deviceId !== "")

  const networks = networksQuery.data?.data ?? []

  if (!isAdmin) {
    return (
      <>
        <PageHeader
          description={t("networks.import.description")}
          title={t("networks.import.title")}
        />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("common.forbidden")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </>
    )
  }

  return (
    <>
      <PageHeader
        actions={
          <Button onClick={reset} type="button" variant="outline">
            {t("networks.import.reset")}
          </Button>
        }
        description={t("networks.import.description")}
        title={
          <span className="flex items-center gap-2">
            <Link
              aria-label={t("networks.import.back")}
              className="text-muted-foreground hover:text-foreground"
              href="/networks"
            >
              <ArrowLeftIcon className="size-5" />
            </Link>
            {t("networks.import.title")}
          </span>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <SectionCard
          description={t("networks.import.sourceDescription")}
          title={t("networks.import.sourceTitle")}
        >
          <div
            aria-label={t("networks.import.sourceTitle")}
            className="flex flex-col gap-1 rounded-lg bg-muted p-1 sm:flex-row"
            role="tablist"
          >
            {TABS.map((entry) => {
              const Icon = entry.icon
              return (
                <button
                  aria-selected={tab === entry.id}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    tab === entry.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  key={entry.id}
                  onClick={() => {
                    setTab(entry.id)
                    setPreview(null)
                  }}
                  role="tab"
                  type="button"
                >
                  <Icon className="size-4" />
                  {t(`networks.import.tabs.${entry.label}`)}
                </button>
              )
            })}
          </div>

          {tab === "toml" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="import-toml">
                  {t("networks.import.tomlLabel")}
                </FieldLabel>
                <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary hover:underline">
                  <UploadIcon className="size-3.5" />
                  {t("networks.import.upload")}
                  <input
                    accept=".toml,.txt,text/plain"
                    className="hidden"
                    onChange={async (event) => {
                      const file = event.target.files?.[0]
                      if (!file) return
                      setToml(await file.text())
                      setPreview(null)
                    }}
                    type="file"
                  />
                </label>
              </div>
              <Textarea
                className="min-h-64 font-mono text-xs lg:min-h-[22rem]"
                id="import-toml"
                onChange={(event) => setToml(event.target.value)}
                placeholder={`[network_identity]\nnetwork_name = "..."\nnetwork_secret = "..."`}
                value={toml}
              />
              <p className="text-xs text-muted-foreground">
                {t("networks.import.tomlHint")}
              </p>
            </div>
          ) : null}

          {tab === "shareLink" ? (
            <div className="space-y-2">
              <FieldLabel htmlFor="import-link">
                {t("networks.import.linkLabel")}
              </FieldLabel>
              <Input
                id="import-link"
                onChange={(event) => {
                  setLink(event.target.value)
                  setPreview(null)
                }}
                placeholder="https://easytier.cn/comp_cfg?cfg=…"
                value={link}
              />
              <p className="text-xs text-muted-foreground">
                {t("networks.import.linkHint")}
              </p>
            </div>
          ) : null}

          {tab === "device" ? (
            <div className="space-y-3">
              <Field className="gap-2">
                <FieldLabel htmlFor="import-device">
                  {t("networks.import.deviceLabel")}
                </FieldLabel>
                <OptionSelect
                  empty={
                    devicesQuery.isLoading ? undefined : (
                      <>
                        {t("networks.import.noDevices")}{" "}
                        <Link href="/devices">
                          {t("networks.import.openDevices")}
                        </Link>
                      </>
                    )
                  }
                  id="import-device"
                  onValueChange={(value) => {
                    setDeviceId(value)
                    setInstanceId("managed")
                    setPreview(null)
                  }}
                  options={eligibleDevices.map((device) => ({
                    value: device.id,
                    label: `${device.dnsName || device.hostname || device.machineId}${
                      device.networkName ? ` · ${device.networkName}` : ""
                    }`,
                  }))}
                  placeholder={t("networks.import.devicePlaceholder")}
                  triggerClassName="sm:max-w-none"
                  value={deviceId}
                />
              </Field>

              {deviceId && (instancesQuery.data?.data.length ?? 0) > 1 ? (
                <Field className="gap-2">
                  <FieldLabel htmlFor="import-instance">
                    {t("networks.import.instanceLabel")}
                  </FieldLabel>
                  <OptionSelect
                    id="import-instance"
                    onValueChange={setInstanceId}
                    options={[
                      {
                        value: "managed",
                        label: t("networks.import.instanceAuto"),
                      },
                      ...(instancesQuery.data?.data ?? []).map((instance) => ({
                        value: instance.instanceId,
                        label: `${instance.instanceId}${
                          instance.managed
                            ? ` · ${t("networks.import.instanceManaged")}`
                            : ""
                        }`,
                      })),
                    ]}
                    triggerClassName="sm:max-w-none"
                    value={instanceId}
                  />
                </Field>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {t("networks.import.deviceHint")}
              </p>
            </div>
          ) : null}

          <Field className="gap-2">
            <FieldLabel htmlFor="import-compare">
              {t("networks.import.compareLabel")}
            </FieldLabel>
            <OptionSelect
              id="import-compare"
              onValueChange={(value) => {
                setExistingId(value)
                setPreview(null)
              }}
              options={[
                { value: "none", label: t("networks.import.compareNone") },
                ...networks.map((network) => ({
                  value: network.id,
                  label: `${network.name} · ${network.networkName}`,
                })),
              ]}
              triggerClassName="sm:max-w-none"
              value={existingId}
            />
            <FieldDescription>{t("networks.import.compareHint")}</FieldDescription>
          </Field>

          <Button
            className="w-full sm:w-auto"
            disabled={!ready || previewMutation.isPending}
            onClick={() =>
              previewMutation.mutate({
                data: {
                  source: sourcePayload(),
                  ...(existingId !== "none" ? { existingNetworkId: existingId } : {}),
                },
              })
            }
            type="button"
            variant="secondary"
          >
            {previewMutation.isPending
              ? t("common.loading")
              : preview
                ? t("networks.import.previewAgain")
                : t("networks.import.preview")}
          </Button>
        </SectionCard>

        <SectionCard
          action={
            preview ? (
              <Badge className="max-w-56 truncate" variant="outline">
                {preview.source.detail}
              </Badge>
            ) : undefined
          }
          description={t("networks.import.previewDescription")}
          title={t("networks.import.previewTitle")}
        >
          {!preview ? (
            <Empty className="border-dashed py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSearchIcon />
                </EmptyMedia>
                <EmptyTitle>{t("networks.import.previewEmptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("networks.import.previewEmptyHint")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={preview.secret.present ? "success" : "warning"}>
                  {preview.secret.present
                    ? t("networks.import.secretPresent")
                    : t("networks.import.secretAbsent")}
                </Badge>
                {preview.secret.sameAsExisting !== null ? (
                  <Badge variant={preview.secret.sameAsExisting ? "success" : "warning"}>
                    {preview.secret.sameAsExisting
                      ? t("networks.import.secretSame")
                      : t("networks.import.secretDifferent")}
                  </Badge>
                ) : null}
                {preview.networkNameTaken ? (
                  <Badge variant="destructive">{t("networks.import.nameTaken")}</Badge>
                ) : null}
                {preview.network.magicDnsEnabled ? (
                  <Badge variant="outline">MagicDNS</Badge>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field className="gap-1">
                  <FieldLabel htmlFor="import-name">{t("networks.name")}</FieldLabel>
                  <Input
                    id="import-name"
                    onChange={(event) => setName(event.target.value)}
                    value={name}
                  />
                </Field>
                <Field className="gap-1">
                  <FieldLabel htmlFor="import-cidr">{t("networks.cidr")}</FieldLabel>
                  <Input
                    id="import-cidr"
                    onChange={(event) => setCidr(event.target.value)}
                    value={cidr}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("networks.import.networkName")}:{" "}
                <span className="font-mono">{preview.network.networkName}</span>
              </p>

              {preview.warnings.length > 0 ? (
                <Alert>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4 text-xs">
                      {preview.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {preview.unsupported.length > 0 ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    <p className="text-xs font-medium">
                      {t("networks.import.notImported")}
                    </p>
                    <ul className="list-disc space-y-1 pl-4 text-xs">
                      {preview.unsupported.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {preview.diff.length > 0 ? (
                <div className="overflow-x-auto">
                  <p className="mb-1 text-xs font-medium">
                    {t("networks.import.diffTitle")}
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">
                          {t("networks.import.field")}
                        </TableHead>
                        <TableHead className="text-xs">
                          {t("networks.import.current")}
                        </TableHead>
                        <TableHead className="text-xs">
                          {t("networks.import.incoming")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.diff.map((entry) => (
                        <TableRow key={entry.field}>
                          <TableCell className="font-mono text-xs">
                            {entry.field}
                          </TableCell>
                          <TableCell className="max-w-48 truncate text-xs">
                            {entry.current ?? t("common.none")}
                          </TableCell>
                          <TableCell className="max-w-48 truncate text-xs">
                            {entry.incoming ?? t("common.none")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">
                    {t("networks.import.peers")}
                  </dt>
                  <dd>{preview.summary.peerUrls.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t("networks.import.listeners")}
                  </dt>
                  <dd>{preview.summary.listenerUrls.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t("networks.import.routes")}
                  </dt>
                  <dd>{preview.summary.routes.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">ACL</dt>
                  <dd>{preview.summary.aclChains}</dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                <Button
                  render={<Link href="/networks" />}
                  type="button"
                  variant="ghost"
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  disabled={
                    commitMutation.isPending ||
                    name.trim() === "" ||
                    cidr.trim() === ""
                  }
                  onClick={() =>
                    commitMutation.mutate({
                      draftId: preview.draftId,
                      data: { name, ipv4Cidr: cidr },
                    })
                  }
                  type="button"
                >
                  {commitMutation.isPending
                    ? t("common.loading")
                    : t("networks.import.commit")}
                </Button>
              </div>
            </>
          )}
        </SectionCard>
      </div>
    </>
  )
}
