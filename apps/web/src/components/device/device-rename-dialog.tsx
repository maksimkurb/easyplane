import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getListDevicesQueryKey,
  getListMagicDnsNamesQueryKey,
  useRenameDevice,
} from "@/api/generated/easyplane"
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

/**
 * Renames the device's DNS name (the EasyTier hostname). The name is pushed as
 * part of the next revision, so the invalidation covers both the device and
 * the lists that show the old name.
 */
export function DeviceRenameDialog({
  deviceId,
  networkId,
  currentName,
  zone,
  open,
  onOpenChange,
}: {
  deviceId: string
  networkId: string
  currentName: string
  zone: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [value, setValue] = useState(currentName)

  const rename = useRenameDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("magicDns.renamed"))
        await queryClient.invalidateQueries({ queryKey: getGetDeviceQueryKey(deviceId) })
        await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
        await queryClient.invalidateQueries({ queryKey: getListMagicDnsNamesQueryKey(networkId) })
        onOpenChange(false)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  return (
    <Dialog
      onOpenChange={(next) => {
        if (next) setValue(currentName)
        onOpenChange(next)
      }}
      open={open}
    >
      <DialogContent size="sm">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            rename.mutate({ deviceId, data: { dnsName: value.trim() } })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("magicDns.renameTitle")}</DialogTitle>
            <DialogDescription>{t("magicDns.renameDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <label className="text-[13px] font-medium" htmlFor={`rename-${deviceId}`}>
              {t("magicDns.label")}
            </label>
            <Input
              autoFocus
              className="font-mono"
              id={`rename-${deviceId}`}
              onChange={(event) => setValue(event.target.value)}
              required
              value={value}
            />
            <p className="text-xs text-fg-3">{`${value || currentName}.${zone}`}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Button disabled={rename.isPending || value.trim() === ""} type="submit">
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
