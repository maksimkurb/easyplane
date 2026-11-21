import { useState } from "react"

import { useTranslation } from "react-i18next"
import { GlobeIcon, ShieldCheckIcon } from "lucide-react"

import type { AccessMode } from "@/lib/access-policy"
import { Segmented } from "@/components/ui/segmented"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type EnforcementMode = "open" | "rules"

function cardMode(value: AccessMode): EnforcementMode {
  return value === "open" ? "open" : "rules"
}

/**
 * The policy MODE: is traffic filtered at all? This is deliberately separate
 * from the editing view (form or JSON). Switching it changes connectivity, so
 * the confirmation defaults to Cancel.
 */
export function AccessModeSwitch({
  value,
  onChange,
  disabled = false,
}: {
  value: AccessMode
  onChange: (mode: EnforcementMode) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const current = cardMode(value)
  const [pending, setPending] = useState<EnforcementMode | null>(null)

  const pick = (next: EnforcementMode) => {
    if (next === current) return
    // Both rules and JSON enforce the same ACL; only crossing open <-> filtered
    // changes what devices can reach, so only that asks for confirmation.
    if (current === "open" || next === "open") {
      setPending(next)
      return
    }
    onChange(next)
  }

  return (
    <>
      <div
        className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5"
        data-testid="access-mode-switch"
      >
        <Segmented
          className="[&>button]:h-8 max-sm:[&>button]:h-11"
          label={t("accessA.mode.label")}
          onValueChange={pick}
          options={[
            {
              value: "open" as const,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <GlobeIcon aria-hidden="true" className="size-4" />
                  {t("accessA.mode.open")}
                </span>
              ),
              disabled,
            },
            {
              value: "rules" as const,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheckIcon aria-hidden="true" className="size-4" />
                  {t("accessA.mode.rules")}
                </span>
              ),
              disabled,
            },
          ]}
          value={current}
        />
        <p
          aria-live="polite"
          className="min-w-0 flex-1 basis-48 text-[12.5px] leading-[18px] text-fg-2"
          data-testid="access-mode-hint"
        >
          {current === "open"
            ? t("accessA.mode.openHint")
            : t("accessA.mode.rulesHint")}
        </p>
      </div>

      <ModeChangeDialog
        onConfirm={() => {
          if (pending) onChange(pending)
          setPending(null)
        }}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        open={pending !== null}
        target={pending ?? "rules"}
      />
    </>
  )
}

/**
 * Shared confirmation for any transition that changes enforcement (including
 * the "Edit as JSON" shortcut from Open). Cancel is first and focused.
 */
export function ModeChangeDialog({
  open,
  target,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  target: EnforcementMode
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const toOpen = target === "open"
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {toOpen
              ? t("accessA.mode.confirmOpenTitle")
              : t("accessA.mode.confirmRulesTitle")}
          </DialogTitle>
          <DialogDescription>
            {toOpen
              ? t("accessA.mode.confirmOpenBody")
              : t("accessA.mode.confirmRulesBody")}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-[18px] text-fg-2">
          {toOpen ? t("accessA.mode.openHint") : t("accessA.mode.rulesHint")}
        </p>
        <DialogFooter>
          <Button
            autoFocus
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm} type="button">
            {toOpen
              ? t("accessA.mode.confirmOpenAction")
              : t("accessA.mode.confirmRulesAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
