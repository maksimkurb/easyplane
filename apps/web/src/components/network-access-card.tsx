import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  KeyRoundIcon,
  LockKeyholeIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetNetworkQueryKey,
  getListDevicesQueryKey,
  getListNetworksQueryKey,
  useListDevices,
  usePreviewNetworkAccessMode,
  useSwitchNetworkAccessMode,
} from "@/api/generated/easyplane"
import type {
  PreviewNetworkAccessMode200,
  PreviewNetworkAccessModeBodyMode,
} from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { SectionCard } from "@/components/shared/section-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/** The fields this card reads; works for both network DTO shapes. */
export interface AccessCardNetwork {
  id: string
  useRendezvous: boolean
  access: {
    mode: "shared_secret" | "credentials"
    anchors: number
    onlineAnchors: number
    members: number
    activeCredentials: number
    expiringCredentials: number
    warnings: Array<
      | "no_anchor"
      | "no_anchor_online"
      | "only_one_anchor"
      | "no_members"
      | "rendezvous_needs_anchor"
      | "credentials_expiring"
    >
  }
}

export function NetworkAccessCard({ network }: { network: AccessCardNetwork }) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [target, setTarget] =
    useState<PreviewNetworkAccessModeBodyMode>("credentials")

  const credentialsMode = network.access.mode === "credentials"
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: getGetNetworkQueryKey(network.id) })
    await queryClient.invalidateQueries({ queryKey: getListNetworksQueryKey() })
    await queryClient.invalidateQueries({
      queryKey: getListDevicesQueryKey({ networkId: network.id }),
    })
  }

  return (
    <SectionCard
      action={
        isAdmin ? (
          <Button
            onClick={() => {
              setTarget(credentialsMode ? "shared_secret" : "credentials")
              setOpen(true)
            }}
            size="sm"
            variant="outline"
          >
            <KeyRoundIcon className="size-4" />
            {credentialsMode ? t("access.switchToShared") : t("access.switchToCredentials")}
          </Button>
        ) : undefined
      }
      description={t("access.description")}
      title={t("access.title")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={credentialsMode ? "success" : "outline"}>
          {credentialsMode ? t("access.mode.credentials") : t("access.mode.shared_secret")}
        </Badge>
        {credentialsMode ? (
          <>
            <Badge variant="outline">
              <ShieldCheckIcon className="size-3" />
              {t("access.anchors", {
                online: network.access.onlineAnchors,
                total: network.access.anchors,
              })}
            </Badge>
            <Badge variant="outline">
              <UsersIcon className="size-3" />
              {t("access.members", { count: network.access.members })}
            </Badge>
            <Badge variant="outline">
              {t("access.credentials", { count: network.access.activeCredentials })}
            </Badge>
          </>
        ) : null}
      </div>

      {network.access.warnings.length > 0 ? (
        <div className="grid gap-2">
          {network.access.warnings.map((warning) => (
            <Alert
              key={warning}
              variant={warning === "only_one_anchor" ? "default" : "warning"}
            >
              <TriangleAlertIcon />
              <AlertDescription>{t(`access.warning.${warning}`)}</AlertDescription>
            </Alert>
          ))}
        </div>
      ) : null}

      <div className="hidden overflow-x-auto sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("access.compare.aspect")}</TableHead>
              <TableHead>{t("access.mode.shared_secret")}</TableHead>
              <TableHead>{t("access.mode.credentials")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="text-xs text-muted-foreground">
                {t("access.compare.onboarding")}
              </TableCell>
              <TableCell className="text-xs">{t("access.compare.onboardingShared")}</TableCell>
              <TableCell className="text-xs">{t("access.compare.onboardingCredentials")}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-xs text-muted-foreground">
                {t("access.compare.revocation")}
              </TableCell>
              <TableCell className="text-xs">{t("access.compare.revocationShared")}</TableCell>
              <TableCell className="text-xs">{t("access.compare.revocationCredentials")}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-xs text-muted-foreground">
                {t("access.compare.blastRadius")}
              </TableCell>
              <TableCell className="text-xs">{t("access.compare.blastRadiusShared")}</TableCell>
              <TableCell className="text-xs">{t("access.compare.blastRadiusCredentials")}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-xs text-muted-foreground">
                {t("access.compare.requirements")}
              </TableCell>
              <TableCell className="text-xs">{t("access.compare.requirementsShared")}</TableCell>
              <TableCell className="text-xs">{t("access.compare.requirementsCredentials")}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 sm:hidden">
        {(
          [
            ["onboarding", "onboardingShared", "onboardingCredentials"],
            ["revocation", "revocationShared", "revocationCredentials"],
            ["blastRadius", "blastRadiusShared", "blastRadiusCredentials"],
            ["requirements", "requirementsShared", "requirementsCredentials"],
          ] as const
        ).map(([aspect, shared, credentials]) => (
          <div className="rounded-lg bg-surface-2 p-3 ring-1 ring-line" key={aspect}>
            <p className="text-xs font-medium text-fg-2">
              {t(`access.compare.${aspect}`)}
            </p>
            <p className="mt-1 text-xs">
              <span className="text-fg-3">{t("access.mode.shared_secret")}: </span>
              {t(`access.compare.${shared}`)}
            </p>
            <p className="mt-0.5 text-xs">
              <span className="text-fg-3">{t("access.mode.credentials")}: </span>
              {t(`access.compare.${credentials}`)}
            </p>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {credentialsMode ? t("access.noteCredentials") : t("access.noteShared")}
      </p>

      {open ? (
        <AccessModeDialog
          network={network}
          onClose={() => setOpen(false)}
          onSwitched={refresh}
          open={open}
          target={target}
        />
      ) : null}
    </SectionCard>
  )
}

function AccessModeDialog({
  network,
  open,
  target,
  onClose,
  onSwitched,
}: {
  network: AccessCardNetwork
  open: boolean
  target: PreviewNetworkAccessModeBodyMode
  onClose: () => void
  onSwitched: () => Promise<void>
}) {
  const { t } = useTranslation()
  const devicesQuery = useListDevices(
    { networkId: network.id },
    { query: { enabled: open } },
  )
  const devices = useMemo(
    () => (devicesQuery.data?.data ?? []).filter((device) => device.state === "approved"),
    [devicesQuery.data],
  )
  // `null` means "use the default selection". Keeping it derived avoids a
  // setState-in-effect that would reset the user's choice on every refetch.
  const [selection, setSelection] = useState<string[] | null>(null)
  const [plan, setPlan] = useState<PreviewNetworkAccessMode200 | null>(null)
  const [acknowledge, setAcknowledge] = useState(false)
  // Preselect the devices that already look like anchors: hubs with an
  // advertised endpoint, otherwise the single approved device if there is
  // exactly one (the first-device rule).
  const defaultAnchorIds = useMemo(() => {
    const hubs = devices.filter(
      (device) => device.isHub || device.advertisedEndpoints.length > 0,
    )
    if (hubs.length > 0) return hubs.map((device) => device.id)
    return devices.length === 1 ? [devices[0]!.id] : []
  }, [devices])
  const anchorIds = selection ?? defaultAnchorIds

  const preview = usePreviewNetworkAccessMode({
    mutation: {
      onSuccess: (response) => setPlan(response.data),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const apply = useSwitchNetworkAccessMode({
    mutation: {
      onSuccess: async () => {
        toast.success(t("access.switched"))
        onClose()
        await onSwitched()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const toggle = (deviceId: string) =>
    setSelection((current) => {
      const base = current ?? defaultAnchorIds
      return base.includes(deviceId)
        ? base.filter((id) => id !== deviceId)
        : [...base, deviceId]
    })

  const previewPlan = () =>
    preview.mutate({
      networkId: network.id,
      data: {
        mode: target,
        ...(target === "credentials" ? { anchorDeviceIds: anchorIds } : {}),
      },
    })

  return (
    <Dialog onOpenChange={(next) => (next ? undefined : onClose())} open={open}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {target === "credentials" ? t("access.switchToCredentials") : t("access.switchToShared")}
          </DialogTitle>
          <DialogDescription>
            {target === "credentials" ? t("access.dialog.credentialsHint") : t("access.dialog.sharedHint")}
          </DialogDescription>
        </DialogHeader>

        {target === "credentials" ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">{t("access.dialog.chooseAnchors")}</p>
            <p className="text-xs text-muted-foreground">{t("access.dialog.anchorHelp")}</p>
            {devicesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("devices.empty")}</p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded border p-3">
                {devices.map((device) => (
                  <label className="flex items-start gap-2 text-sm" key={device.id}>
                    <Checkbox
                      checked={anchorIds.includes(device.id)}
                      onCheckedChange={() => toggle(device.id)}
                    />
                    <span>
                      <span className="font-medium">
                        {device.dnsName ?? (device.hostname || device.machineId.slice(0, 8))}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {device.effectiveRole === "anchor"
                          ? t("access.anchorBadge")
                          : t("access.memberBadge")}
                        {device.online === "online" ? ` · ${t("devices.status.online")}` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("access.dialog.everyoneElseMember")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertDescription>{t("access.dialog.reverseWarning")}</AlertDescription>
            </Alert>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={acknowledge}
                onCheckedChange={(checked) => setAcknowledge(checked === true)}
              />
              {t("access.dialog.acknowledgeReverse")}
            </label>
          </div>
        )}

        {plan ? (
          <div className="space-y-2 rounded border p-3 text-sm">
            <p className="font-medium">{t("access.dialog.previewTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("access.dialog.previewAnchors", {
                count: plan.anchors.length,
                names: plan.anchors.map((anchor) => anchor.hostname).join(", ") || t("common.none"),
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("access.dialog.previewMembers", { count: plan.members.length })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("access.dialog.previewRevoked", { count: plan.revokeCredentials })}
            </p>
            {plan.warnings.map((warning) => (
              <p className="text-xs text-amber-600 dark:text-amber-400" key={warning}>
                {t(`access.warning.${warning}`, { defaultValue: warning })}
              </p>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            {t("common.cancel")}
          </Button>
          <Button
            disabled={preview.isPending}
            onClick={previewPlan}
            type="button"
            variant="outline"
          >
            {t("access.dialog.preview")}
          </Button>
          <Button
            disabled={
              apply.isPending ||
              (target === "credentials" && anchorIds.length === 0) ||
              (target === "shared_secret" && !acknowledge)
            }
            onClick={() =>
              apply.mutate({
                networkId: network.id,
                data: {
                  mode: target,
                  ...(target === "credentials" ? { anchorDeviceIds: anchorIds } : {}),
                  ...(target === "shared_secret" ? { acknowledge: true } : {}),
                },
              })
            }
            type="button"
          >
            {apply.isPending ? t("common.loading") : t("access.dialog.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Small role badge reused by the device list/detail pages. */
export function DeviceRoleBadge({
  role,
  expiresAt,
  status,
}: {
  role: "anchor" | "member"
  expiresAt?: string | null
  status?: "active" | "revoked" | "expired" | null
}) {
  const { t } = useTranslation()
  if (role === "anchor") {
    return (
      <Badge className="gap-1" variant="warning">
        <LockKeyholeIcon className="size-3" />
        {t("access.anchorBadge")}
      </Badge>
    )
  }
  return (
    <Badge className="gap-1" variant={status === "active" ? "outline" : "destructive"}>
      <UsersIcon className="size-3" />
      {t("access.memberBadge")}
      {expiresAt ? (
        <span className="text-[10px] text-muted-foreground">
          {new Date(expiresAt).toLocaleDateString()}
        </span>
      ) : null}
    </Badge>
  )
}
