import { useState } from "react"
import { useTranslation } from "react-i18next"
import { KeyRoundIcon, ShieldAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { useRotateNetworkSecret } from "@/api/generated/easyplane"
import { CopyButton } from "@/components/copy-button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"

/**
 * Blocking or deleting an anchor cannot revoke it: it already holds the
 * network secret. This dialog explains that, offers the real fix (rotate the
 * secret and re-enrol the anchors) and requires an explicit acknowledgement
 * for "remove anyway". Removing the device also drops its endpoint from the
 * network peer list on the next push, so other devices stop dialling it.
 */
export function AnchorRemovalDialog({
  open,
  hostname,
  networkId,
  operation,
  useRendezvous = false,
  onClose,
  onConfirm,
  pending,
}: {
  open: boolean
  hostname: string
  networkId: string
  operation: "block" | "delete"
  /** The bundled node pins the secret, so a random rotation is refused. */
  useRendezvous?: boolean
  onClose: () => void
  onConfirm: () => void
  pending?: boolean
}) {
  const { t } = useTranslation()
  const [acknowledged, setAcknowledged] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const rotate = useRotateNetworkSecret({
    mutation: {
      onSuccess: (response) => {
        setSecret(response.data.secret)
        toast.success(t("access.rotateDone"))
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          setAcknowledged(false)
          onClose()
        }
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlertIcon className="size-5 text-amber-500" />
            {operation === "block" ? t("access.anchorBlockTitle") : t("access.anchorDeleteTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("access.anchorRemovalBody", { hostname })}
          </DialogDescription>
        </DialogHeader>

        <Alert variant="warning">
          <ShieldAlertIcon />
          <AlertDescription>{t("access.anchorRemovalWhy")}</AlertDescription>
        </Alert>

        <div className="space-y-2 rounded border p-3">
          <p className="text-sm font-medium">{t("access.rotateTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {useRendezvous
              ? t("access.rotateRendezvousBody")
              : t("access.rotateBody")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {useRendezvous ? null : (
              <Button
                disabled={rotate.isPending}
                onClick={() => rotate.mutate({ networkId })}
                size="sm"
                type="button"
                variant="outline"
              >
                <KeyRoundIcon className="size-4" />
                {t("access.rotate")}
              </Button>
            )}
            {secret ? (
              <div className="flex min-w-0 items-center gap-2">
                <code className="max-w-64 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {secret}
                </code>
                <CopyButton value={secret} />
              </div>
            ) : null}
          </div>
          {secret ? <p className="text-xs text-muted-foreground">{t("access.rotateNote")}</p> : null}
        </div>

        <div className="space-y-2 rounded border border-red-500/30 p-3">
          <p className="text-sm font-medium">{t("access.removeAnywayTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("access.removeAnywayBody")}</p>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
            />
            <span>{t("access.removeAnywayAck", { hostname })}</span>
          </label>
        </div>

        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!acknowledged || pending}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {pending ? t("common.loading") : t("access.removeAnyway")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
