import { useState } from "react"
import { useTranslation } from "react-i18next"
import { PencilIcon } from "lucide-react"

import { DeviceDescriptionDialog } from "@/components/device/device-description-dialog"
import { cn } from "@/lib/utils"

/**
 * The device's description under its name. Managers get a pencil and an empty
 * placeholder; everyone else sees only a filled description (or nothing), so a
 * basic user is never shown an affordance they cannot use.
 */
export function DeviceDescriptionLine({
  deviceId,
  description,
  canManage,
  className,
}: {
  deviceId: string
  description: string | null
  canManage: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (!description && !canManage) return null

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <p
        className={cn(
          "min-w-0 text-[13px] leading-5",
          description
            ? "truncate text-fg-2"
            : "text-fg-3 max-sm:line-clamp-2 sm:truncate"
        )}
        title={description ?? undefined}
      >
        {description || t("devices.deviceDescription.placeholder")}
      </p>
      {canManage ? (
        <button
          aria-label={t("devices.deviceDescription.edit")}
          className="grid size-11 flex-none cursor-pointer place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:size-7"
          onClick={() => setOpen(true)}
          type="button"
        >
          <PencilIcon className="size-3.5" />
        </button>
      ) : null}
      {canManage ? (
        <DeviceDescriptionDialog
          currentDescription={description}
          deviceId={deviceId}
          onOpenChange={setOpen}
          open={open}
        />
      ) : null}
    </div>
  )
}

/**
 * One-line description for a device row. Always truncated with the full text
 * in the tooltip: rows must stay one line at 390px and never push the layout.
 */
export function DeviceDescriptionSummary({
  description,
  className,
}: {
  description: string | null
  className?: string
}) {
  if (!description) return null
  return (
    <p
      className={cn("max-w-full truncate text-xs text-fg-3", className)}
      title={description}
    >
      {description}
    </p>
  )
}
