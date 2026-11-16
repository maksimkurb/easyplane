import { useState } from "react"
import { useTranslation } from "react-i18next"
import { KeyRoundIcon, RefreshCwIcon, ShieldBanIcon, UserCogIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getGetNetworkQueryKey,
  getListDevicesQueryKey,
  useRenewDeviceCredential,
  useRevokeDeviceCredential,
  useSetDeviceRole,
} from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { CopyButton } from "@/components/copy-button"
import { DeviceRoleBadge } from "@/components/network-access-card"
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
import type { GetDevice200 } from "@/api/generated/model"

export function DeviceAccessCard({ device }: { device: GetDevice200 }) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [demoteOpen, setDemoteOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: getGetDeviceQueryKey(device.id) })
    await queryClient.invalidateQueries({
      queryKey: getListDevicesQueryKey({ networkId: device.networkId }),
    })
    await queryClient.invalidateQueries({
      queryKey: getGetNetworkQueryKey(device.networkId),
    })
  }

  const renew = useRenewDeviceCredential({
    mutation: {
      onSuccess: async () => {
        toast.success(t("access.renewed"))
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const revoke = useRevokeDeviceCredential({
    mutation: {
      onSuccess: async () => {
        toast.success(t("access.revoked"))
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const setRole = useSetDeviceRole({
    mutation: {
      onSuccess: async (response) => {
        toast.success(
          response.data.needsSecretRotation
            ? t("access.roleChangedRotate")
            : t("access.roleChanged"),
        )
        setDemoteOpen(false)
        setAcknowledged(false)
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const credentialsMode = device.accessMode === "credentials"
  const credential = device.credential

  return (
    <SectionCard
      description={t("access.deviceHint")}
      title={t("access.deviceTitle")}
    >
      <div className="flex flex-wrap items-center gap-2">
        {credentialsMode ? (
          <DeviceRoleBadge
            expiresAt={credential?.expiry}
            role={device.effectiveRole}
            status={credential?.status}
          />
        ) : (
          <Badge variant="outline">{t("access.mode.shared_secret")}</Badge>
        )}
        {device.knowsSecret ? (
          <span className="text-xs text-muted-foreground">{t("access.knowsSecretLong")}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("access.noSecretLong")}</span>
        )}
      </div>

      {credentialsMode && credential ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t("access.status")}</dt>
            <dd>{t(`access.credentialStatus.${credential.status}`)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("access.expiry")}</dt>
            <dd>{new Date(credential.expiry).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("access.groups")}</dt>
            <dd className="text-xs">
              {credential.groups.length > 0 ? credential.groups.join(", ") : t("common.none")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("access.publicKey")}</dt>
            <dd className="flex items-center gap-1 font-mono text-[10px]">
              <span className="truncate">{credential.publicKey}</span>
              <CopyButton value={credential.publicKey} />
            </dd>
          </div>
        </dl>
      ) : credentialsMode ? (
        <p className="text-sm text-muted-foreground">{t("access.noCredential")}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("access.sharedModeHint")}</p>
      )}

      {credentialsMode && credential?.status !== "active" ? (
        <Alert variant="warning">
          <ShieldBanIcon />
          <AlertDescription>
            {credential?.revocationReason || t("access.credentialNotActive")}
          </AlertDescription>
        </Alert>
      ) : null}

      {isAdmin && credentialsMode ? (
        <div className="flex flex-wrap gap-2">
          {device.effectiveRole === "member" ? (
            <>
              <Button
                disabled={renew.isPending}
                onClick={() => renew.mutate({ deviceId: device.id })}
                size="sm"
                variant="outline"
              >
                <RefreshCwIcon className="size-4" />
                {t("access.renew")}
              </Button>
              <Button
                disabled={revoke.isPending}
                onClick={() => {
                  if (window.confirm(t("access.revokeConfirm", { hostname: device.hostname }))) {
                    revoke.mutate({ deviceId: device.id })
                  }
                }}
                size="sm"
                variant="outline"
              >
                <ShieldBanIcon className="size-4" />
                {t("access.revoke")}
              </Button>
              <Button
                onClick={() => {
                  if (window.confirm(t("access.promoteConfirm"))) {
                    setRole.mutate({ deviceId: device.id, data: { role: "anchor" } })
                  }
                }}
                size="sm"
                variant="outline"
              >
                <KeyRoundIcon className="size-4" />
                {t("access.makeAnchor")}
              </Button>
            </>
          ) : (
            <Button onClick={() => setDemoteOpen(true)} size="sm" variant="outline">
              <UserCogIcon className="size-4" />
              {t("access.makeMember")}
            </Button>
          )}
        </div>
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          setDemoteOpen(open)
          if (!open) setAcknowledged(false)
        }}
        open={demoteOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("access.demoteTitle")}</DialogTitle>
            <DialogDescription>{t("access.demoteBody", { hostname: device.hostname })}</DialogDescription>
          </DialogHeader>
          <Alert variant="warning">
            <KeyRoundIcon />
            <AlertDescription>{t("access.demoteWhy")}</AlertDescription>
          </Alert>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
            />
            <span>{t("access.demoteAck")}</span>
          </label>
          <DialogFooter>
            <Button onClick={() => setDemoteOpen(false)} variant="outline">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!acknowledged || setRole.isPending}
              onClick={() =>
                setRole.mutate({
                  deviceId: device.id,
                  data: { role: "member", acknowledge: true },
                })
              }
            >
              {setRole.isPending ? t("common.loading") : t("access.demoteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
