import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

/**
 * One visual grammar for every settings section: a titled card whose rows put
 * the label and explanation on the left and the control on the right on
 * desktop, stacked on phones.
 */
export function SettingsCard({
  title,
  description,
  children,
  tone = "default",
}: {
  title: string
  description?: string
  children: ReactNode
  tone?: "default" | "danger"
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <h2
          className={cn(
            "text-base leading-6 font-semibold tracking-[-0.006em]",
            tone === "danger" && "text-err"
          )}
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[13px] text-fg-3">{description}</p>
        ) : null}
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
  className,
}: {
  label: string
  description?: ReactNode
  children: ReactNode
  htmlFor?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "border-t border-line px-4 py-4 first:border-t-0 sm:px-5 sm:py-5 md:grid md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] md:gap-6",
        className
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label className="text-[13px] font-medium" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <h3 className="text-[13px] font-medium">{label}</h3>
        )}
        {description ? (
          <p className="mt-0.5 text-[13px] leading-5 text-fg-3">
            {description}
          </p>
        ) : null}
      </div>
      <div className="mt-3 min-w-0 md:mt-0">{children}</div>
    </div>
  )
}

/**
 * Sticky bar for a section's text fields. It appears only while the form is
 * dirty so there is exactly one save model per section.
 */
export function UnsavedChangesBar({
  show,
  saving,
  disabled,
  onSave,
  onDiscard,
}: {
  show: boolean
  saving?: boolean
  disabled?: boolean
  onSave: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation()
  if (!show) return null

  return (
    <div
      aria-live="polite"
      className="sticky bottom-3 z-20 mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-card px-3 py-2.5 shadow-lg ring-1 ring-line sm:mx-4 sm:px-4"
      role="status"
    >
      <span className="mr-auto inline-flex items-center gap-2 text-[13px] font-medium">
        <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
        {t("settings.unsaved")}
      </span>
      <Button onClick={onDiscard} size="sm" type="button" variant="ghost">
        {t("settings.discard")}
      </Button>
      <Button
        disabled={saving || disabled}
        onClick={onSave}
        size="sm"
        type="button"
      >
        {saving ? t("common.loading") : t("settings.saveChanges")}
      </Button>
    </div>
  )
}

/** Label + switch + current state, the row body for an immediate setting. */
export function SwitchRowBody({
  checked,
  disabled,
  onCheckedChange,
  label,
  onLabel,
  offLabel,
}: {
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  onLabel: string
  offLabel: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-2 px-3 py-2.5 ring-1 ring-line">
      <span className="min-w-0 text-[13px] font-medium">
        {checked ? onLabel : offLabel}
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}
