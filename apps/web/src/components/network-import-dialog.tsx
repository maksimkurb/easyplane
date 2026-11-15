import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { FileUpIcon, LinkIcon, MonitorSmartphoneIcon, UploadIcon } from "lucide-react"
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
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
 * server-side; the browser never receives the network secret.
 */
export function NetworkImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
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
        reset()
        onOpenChange(false)
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

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      open={open}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("networks.import.title")}</DialogTitle>
          <DialogDescription>{t("networks.import.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {TABS.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === entry.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={entry.id}
                onClick={() => {
                  setTab(entry.id)
                  setPreview(null)
                }}
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
              <Label htmlFor="import-toml">{t("networks.import.tomlLabel")}</Label>
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
              className="min-h-48 font-mono text-xs"
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
            <Label htmlFor="import-link">{t("networks.import.linkLabel")}</Label>
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
            <div className="space-y-2">
              <Label>{t("networks.import.deviceLabel")}</Label>
              <Select onValueChange={(value) => {
                setDeviceId(value as string)
                setInstanceId("managed")
                setPreview(null)
              }} value={deviceId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("networks.import.devicePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {eligibleDevices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.dnsName || device.hostname || device.machineId}
                      {device.networkName ? ` · ${device.networkName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {eligibleDevices.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("networks.import.noDevices")}
                </p>
              ) : null}
            </div>
            {deviceId && (instancesQuery.data?.data.length ?? 0) > 1 ? (
              <div className="space-y-2">
                <Label>{t("networks.import.instanceLabel")}</Label>
                <Select onValueChange={(value) => setInstanceId(value as string)} value={instanceId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="managed">
                      {t("networks.import.instanceAuto")}
                    </SelectItem>
                    {(instancesQuery.data?.data ?? []).map((instance) => (
                      <SelectItem key={instance.instanceId} value={instance.instanceId}>
                        {instance.instanceId}
                        {instance.managed ? ` · ${t("networks.import.instanceManaged")}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t("networks.import.deviceHint")}
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>{t("networks.import.compareLabel")}</Label>
          <Select onValueChange={(value) => setExistingId(value as string)} value={existingId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("networks.import.compareNone")}</SelectItem>
              {(networksQuery.data?.data ?? []).map((network) => (
                <SelectItem key={network.id} value={network.id}>
                  {network.name} · {network.networkName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
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

        {preview ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{preview.source.detail}</Badge>
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
              <div className="space-y-1">
                <Label htmlFor="import-name">{t("networks.name")}</Label>
                <Input
                  id="import-name"
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="import-cidr">{t("networks.cidr")}</Label>
                <Input
                  id="import-cidr"
                  onChange={(event) => setCidr(event.target.value)}
                  value={cidr}
                />
              </div>
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
                      <TableHead className="text-xs">{t("networks.import.field")}</TableHead>
                      <TableHead className="text-xs">{t("networks.import.current")}</TableHead>
                      <TableHead className="text-xs">{t("networks.import.incoming")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.diff.map((entry) => (
                      <TableRow key={entry.field}>
                        <TableCell className="font-mono text-xs">{entry.field}</TableCell>
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
                <dt className="text-muted-foreground">{t("networks.import.peers")}</dt>
                <dd>{preview.summary.peerUrls.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("networks.import.listeners")}</dt>
                <dd>{preview.summary.listenerUrls.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("networks.import.routes")}</dt>
                <dd>{preview.summary.routes.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">ACL</dt>
                <dd>{preview.summary.aclChains}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t("common.cancel")}
          </Button>
          <Button
            disabled={
              !preview ||
              commitMutation.isPending ||
              name.trim() === "" ||
              cidr.trim() === ""
            }
            onClick={() => {
              if (!preview) return
              commitMutation.mutate({
                draftId: preview.draftId,
                data: { name, ipv4Cidr: cidr },
              })
            }}
            type="button"
          >
            {commitMutation.isPending
              ? t("common.loading")
              : t("networks.import.commit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
