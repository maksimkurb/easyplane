import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getListDevicesQueryKey,
  getListTagsQueryKey,
  useListTags,
  useSetDeviceTags,
} from "@/api/generated/easyplane"
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

/** Tag picker (policy subjects) shared by the device list and device page. */
export function DeviceTagsDialog({
  deviceId,
  deviceName,
  currentTags,
  open,
  onOpenChange,
}: {
  deviceId: string
  deviceName: string
  currentTags: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>(currentTags)
  const tags = useListTags({ query: { enabled: open } })

  const save = useSetDeviceTags({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.tagsSaved"))
        await queryClient.invalidateQueries({ queryKey: getGetDeviceQueryKey(deviceId) })
        await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
        await queryClient.invalidateQueries({ queryKey: getListTagsQueryKey() })
        onOpenChange(false)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  return (
    <Dialog
      onOpenChange={(next) => {
        if (next) setSelected(currentTags)
        onOpenChange(next)
      }}
      open={open}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("devices.tagsTitle", { name: deviceName })}</DialogTitle>
          <DialogDescription>{t("devices.tagsHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2.5 py-3">
          {(tags.data?.data ?? []).length === 0 ? (
            <p className="text-sm text-fg-3">{t("devices.noTags")}</p>
          ) : (
            (tags.data?.data ?? []).map((tag) => (
              <label className="flex min-h-8 items-center gap-2.5 text-sm" key={tag.id}>
                <Checkbox
                  checked={selected.includes(tag.name)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked === true
                        ? [...current, tag.name]
                        : current.filter((entry) => entry !== tag.name)
                    )
                  }
                />
                <span className="font-mono text-xs">{tag.name}</span>
                <span className="ml-auto text-xs text-fg-3">{tag.deviceCount}</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {t("common.cancel")}
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate({ deviceId, data: { tags: selected } })}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
