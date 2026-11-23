import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getListDevicesQueryKey,
  useUpdateDeviceDescription,
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
import { Textarea } from "@/components/ui/textarea"

/** Mirrors `DEVICE_DESCRIPTION_MAX_LENGTH` on the server. */
export const DEVICE_DESCRIPTION_MAX_LENGTH = 280

/**
 * Edits the device's short human description. It is a single paragraph, so
 * Enter (and Cmd/Ctrl+Enter) saves, while a plain newline is not accepted.
 * Escape closes the dialog without saving, like every other dialog here.
 */
export function DeviceDescriptionDialog({
  deviceId,
  currentDescription,
  open,
  onOpenChange,
}: {
  deviceId: string
  currentDescription: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [value, setValue] = useState(currentDescription ?? "")

  const save = useUpdateDeviceDescription({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.deviceDescription.saved"))
        await queryClient.invalidateQueries({
          queryKey: getGetDeviceQueryKey(deviceId),
        })
        await queryClient.invalidateQueries({
          queryKey: getListDevicesQueryKey(),
        })
        onOpenChange(false)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const submit = () => {
    if (save.isPending) return
    const description = value.trim()
    save.mutate({ deviceId, data: { description: description || null } })
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (next) setValue(currentDescription ?? "")
        onOpenChange(next)
      }}
      open={open}
    >
      <DialogContent size="sm">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("devices.deviceDescription.title")}</DialogTitle>
            <DialogDescription>
              {t("devices.deviceDescription.hint")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <label
              className="text-[13px] font-medium"
              htmlFor={`description-${deviceId}`}
            >
              {t("devices.deviceDescription.field")}
            </label>
            <Textarea
              autoFocus
              id={`description-${deviceId}`}
              maxLength={DEVICE_DESCRIPTION_MAX_LENGTH}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder={t("devices.deviceDescription.placeholder")}
              rows={3}
              value={value}
            />
            <p
              aria-live="polite"
              className="text-right text-xs text-fg-3 tabular-nums"
            >
              {t("devices.deviceDescription.counter", {
                value: value.length,
                max: DEVICE_DESCRIPTION_MAX_LENGTH,
              })}
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={save.isPending} type="submit">
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
