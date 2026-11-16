import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { RadioTowerIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getGetNetworkQueryKey,
  getListNetworksQueryKey,
  useAlignNetworkRendezvousSecret,
  useUpdateNetwork,
} from "@/api/generated/easyplane"
import type { GetNetwork200 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { SectionCard } from "@/components/shared/section-card"
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
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

/**
 * Read-only view of the bundled rendezvous node plus the per-network opt-in.
 *
 * The node is a stock easytier-core public server: devices dial it to find each
 * other, it relays peer RPC and hole-punch coordination, and by default it does
 * NOT forward user data. Private mode (its default) only admits foreign
 * networks that can prove the node's EasyTier network secret; the proof travels
 * in secure mode, so enabling the toggle also pushes secure mode to devices.
 */
export function NetworkRendezvousCard({ network }: { network: GetNetwork200 }) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: getGetNetworkQueryKey(network.id) })
    await queryClient.invalidateQueries({ queryKey: getListNetworksQueryKey() })
  }
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("common.error"))

  const update = useUpdateNetwork({
    mutation: {
      onSuccess: async () => {
        toast.success(t("rendezvous.updated"))
        await refresh()
      },
      onError,
    },
  })
  const align = useAlignNetworkRendezvousSecret({
    mutation: {
      onSuccess: async () => {
        toast.success(t("rendezvous.aligned"))
        await refresh()
      },
      onError,
    },
  })

  const info = network.rendezvous
  const busy = update.isPending || align.isPending
  const secretMismatch = info.secretMatches === false
  const noDialTarget = !network.peerPlan.hasPeerEndpoint && !info.useBundled

  const toggle = (checked: boolean) => {
    if (checked && info.secretMatches !== true) {
      setConfirmOpen(true)
      return
    }
    update.mutate({ networkId: network.id, data: { useRendezvous: checked } })
  }

  const confirm = () => {
    setConfirmOpen(false)
    update.mutate({ networkId: network.id, data: { useRendezvous: true } })
  }

  return (
    <SectionCard
      action={<RadioTowerIcon className="size-4 text-muted-foreground" />}
      description={t("rendezvous.description")}
      title={t("rendezvous.title")}
    >
      {!info.configured ? (
        <Alert>
          <AlertDescription>{t("rendezvous.notConfigured")}</AlertDescription>
        </Alert>
      ) : (
        <>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">
                {t("rendezvous.endpoints")}
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {info.endpoints.map((endpoint) => (
                  <code
                    className="rounded bg-muted px-1.5 py-0.5 text-xs"
                    key={endpoint}
                  >
                    {endpoint}
                  </code>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {t("rendezvous.relayData")}
              </dt>
              <dd className="mt-1">
                <Badge variant={info.relayData ? "warning" : "success"}>
                  {info.relayData
                    ? t("rendezvous.relayOn")
                    : t("rendezvous.relayOff")}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {t("rendezvous.privateMode")}
              </dt>
              <dd className="mt-1">
                <Badge variant={info.privateMode ? "success" : "destructive"}>
                  {info.privateMode
                    ? t("rendezvous.privateOn")
                    : t("rendezvous.privateOff")}
                </Badge>
              </dd>
            </div>
            {info.networkName ? (
              <div>
                <dt className="text-muted-foreground">
                  {t("rendezvous.nodeNetwork")}
                </dt>
                <dd className="mt-1 font-mono text-xs">{info.networkName}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">
                {t("rendezvous.secretMatch")}
              </dt>
              <dd className="mt-1 text-xs">
                {info.secretMatches === true
                  ? t("rendezvous.secretMatches")
                  : info.secretMatches === false
                    ? t("rendezvous.secretDiffers")
                    : t("rendezvous.secretUnknown")}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-sm text-muted-foreground">
            {info.relayData
              ? t("rendezvous.explainRelay")
              : t("rendezvous.explainRendezvous")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("rendezvous.cgnatNote")}
          </p>

          {secretMismatch ? (
            <Alert className="mt-4">
              <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>{t("rendezvous.secretMismatchWarning")}</span>
                {isAdmin ? (
                  <Button
                    disabled={busy}
                    onClick={() => align.mutate({ networkId: network.id })}
                    size="sm"
                    variant="outline"
                  >
                    {t("rendezvous.alignSecret")}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={info.useBundled}
                disabled={!isAdmin || busy}
                onCheckedChange={toggle}
              />
              <span>{t("rendezvous.useBundled")}</span>
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {t("rendezvous.devicesDial", {
                  count: network.peerPlan.rendezvousEndpoints,
                })}
              </span>
              <Badge variant={info.useBundled ? "success" : "outline"}>
                {info.useBundled
                  ? t("rendezvous.on")
                  : t("rendezvous.off")}
              </Badge>
            </div>
          </div>
        </>
      )}

      {noDialTarget ? (
        <Alert className="mt-4">
          <AlertDescription>{t("rendezvous.noDialTarget")}</AlertDescription>
        </Alert>
      ) : null}

      <Separator className="my-4" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex items-start gap-2 text-sm">
          <Switch
            checked={network.p2pOnly}
            disabled={!isAdmin || busy}
            onCheckedChange={(checked) =>
              update.mutate({ networkId: network.id, data: { p2pOnly: checked } })
            }
          />
          <span>
            <span className="font-medium">{t("rendezvous.p2pOnly")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("rendezvous.p2pOnlyHint")}
            </span>
          </span>
        </label>
        <Badge variant={network.p2pOnly ? "warning" : "outline"}>
          {network.p2pOnly
            ? t("rendezvous.on")
            : t("rendezvous.off")}
        </Badge>
      </div>
      {network.p2pOnly ? (
        <Alert className="mt-3">
          <AlertDescription>{t("rendezvous.p2pOnlyWarning")}</AlertDescription>
        </Alert>
      ) : null}

      <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rendezvous.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("rendezvous.confirmBody")}
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertDescription>
              {t("rendezvous.confirmWarning")}
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button onClick={() => setConfirmOpen(false)} variant="outline">
              {t("common.cancel")}
            </Button>
            <Button disabled={busy} onClick={confirm}>
              {t("rendezvous.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
