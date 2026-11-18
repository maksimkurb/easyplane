import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import {
  EyeIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  getGetNetworkQueryKey,
  getListNetworksQueryKey,
  useRevealNetworkSecret,
  useRotateNetworkSecret,
} from "@/api/generated/easyplane"
import type { GetNetwork200 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { CopyButton } from "@/components/copy-button"
import { SettingsCard, SettingsRow } from "@/components/network/settings-layout"
import { AccessModeSwitchButton } from "@/components/network-access-card"
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

/**
 * Security section: how devices authenticate and the network secret. The long
 * comparison table is documentation, so it lives behind "Compare the two
 * modes" instead of being shown on every visit.
 */
export function NetworkSecuritySettings({
  network,
}: {
  network: GetNetwork200
}) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [secret, setSecret] = useState<string | null>(null)
  const [rotateOpen, setRotateOpen] = useState(false)

  const credentialsMode = network.access.mode === "credentials"

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: getGetNetworkQueryKey(network.id),
    })
    await queryClient.invalidateQueries({ queryKey: getListNetworksQueryKey() })
  }
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("common.error"))

  const reveal = useRevealNetworkSecret({
    mutation: {
      onSuccess: (response) => setSecret(response.data.secret),
      onError,
    },
  })
  const rotate = useRotateNetworkSecret({
    mutation: {
      onSuccess: async (response) => {
        setSecret(response.data.secret)
        setRotateOpen(false)
        toast.success(t("settings.rotated"))
        await refresh()
      },
      onError,
    },
  })

  const comparisons = [
    ["onboarding", "onboardingShared", "onboardingCredentials"],
    ["revocation", "revocationShared", "revocationCredentials"],
    ["blastRadius", "blastRadiusShared", "blastRadiusCredentials"],
    ["requirements", "requirementsShared", "requirementsCredentials"],
  ] as const

  return (
    <SettingsCard
      description={t("settings.securityDescription")}
      title={t("settings.sections.security")}
    >
      <SettingsRow
        description={t("settings.authHint")}
        label={t("settings.authRow")}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={credentialsMode ? "success" : "outline"}>
              {credentialsMode
                ? t("access.mode.credentials")
                : t("access.mode.shared_secret")}
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
                  {t("access.credentials", {
                    count: network.access.activeCredentials,
                  })}
                </Badge>
              </>
            ) : null}
          </div>

          <p className="text-[13px] text-fg-3">
            {credentialsMode
              ? t("settings.authCredentials")
              : t("settings.authShared")}
          </p>

          {network.access.warnings.length > 0 ? (
            <div className="grid gap-2">
              {network.access.warnings.map((warning) => (
                <Alert
                  key={warning}
                  variant={
                    warning === "only_one_anchor" ? "default" : "warning"
                  }
                >
                  <TriangleAlertIcon />
                  <AlertDescription>
                    {t(`access.warning.${warning}`)}
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          ) : null}

          <details className="rounded-lg ring-1 ring-line">
            <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
              {t("settings.authLearnMore")}
            </summary>
            <dl className="grid gap-3 border-t border-line px-3 py-3">
              {comparisons.map(([aspect, shared, credentials]) => (
                <div key={aspect}>
                  <dt className="text-xs font-medium text-fg-2">
                    {t(`access.compare.${aspect}`)}
                  </dt>
                  <dd className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
                    <span>
                      <span className="text-fg-3">
                        {t("access.mode.shared_secret")}:{" "}
                      </span>
                      {t(`access.compare.${shared}`)}
                    </span>
                    <span>
                      <span className="text-fg-3">
                        {t("access.mode.credentials")}:{" "}
                      </span>
                      {t(`access.compare.${credentials}`)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </details>

          <div>
            <AccessModeSwitchButton network={network} />
          </div>
        </div>
      </SettingsRow>

      <SettingsRow
        description={t("settings.secretHint")}
        label={t("settings.secretRow")}
      >
        <div className="flex max-w-[520px] flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex h-10 min-w-0 items-center overflow-hidden rounded-lg bg-surface-2 px-3 font-mono text-sm tracking-[0.2em] text-fg-3 ring-1 ring-line sm:flex-1">
              <span className="truncate">{secret ?? "••••••••••••••••"}</span>
            </code>
            {isAdmin ? (
              <div className="flex items-center gap-2">
                <Button
                  className="max-sm:flex-1"
                  disabled={reveal.isPending}
                  onClick={() => reveal.mutate({ networkId: network.id })}
                  type="button"
                  variant="outline"
                >
                  <EyeIcon className="size-4" />
                  {t("settings.reveal")}
                </Button>
                <Button
                  className="max-sm:flex-1"
                  onClick={() => setRotateOpen(true)}
                  type="button"
                  variant="ghost"
                >
                  <KeyRoundIcon className="size-4" />
                  {t("settings.rotate")}
                </Button>
              </div>
            ) : null}
          </div>

          {secret ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 ring-1 ring-warn-line">
              <p className="min-w-0 flex-1 text-xs text-fg-2">
                {t("settings.secretRevealWarning")}
              </p>
              <CopyButton value={secret} />
            </div>
          ) : null}
          <p className="text-xs text-fg-3">{t("settings.rotateHint")}</p>
        </div>
      </SettingsRow>

      <Dialog onOpenChange={setRotateOpen} open={rotateOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("settings.rotateTitle")}</DialogTitle>
            <DialogDescription>{t("settings.rotateBody")}</DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertDescription>
              {t("settings.rotateConsequence")}
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button onClick={() => setRotateOpen(false)} variant="outline">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={rotate.isPending}
              onClick={() => rotate.mutate({ networkId: network.id })}
              variant="destructive"
            >
              <KeyRoundIcon className="size-4" />
              {rotate.isPending
                ? t("common.loading")
                : t("settings.rotateConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  )
}
