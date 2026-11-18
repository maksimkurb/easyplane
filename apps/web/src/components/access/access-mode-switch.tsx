import { useState } from "react"

import { useTranslation } from "react-i18next"
import { GlobeIcon, ShieldCheckIcon } from "lucide-react"

import type { AccessMode } from "@/lib/access-policy"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

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

  const cards: Array<{
    mode: EnforcementMode
    icon: typeof GlobeIcon
    title: string
    hint: string
  }> = [
    {
      mode: "open",
      icon: GlobeIcon,
      title: t("accessA.mode.openTitle"),
      hint: t("accessA.mode.openHint"),
    },
    {
      mode: "rules",
      icon: ShieldCheckIcon,
      title: t("accessA.mode.rulesTitle"),
      hint: t("accessA.mode.rulesHint"),
    },
  ]

  return (
    <>
      <div
        aria-label={t("accessA.mode.label")}
        className="grid min-w-0 gap-2 sm:grid-cols-2"
        data-testid="access-mode-switch"
        role="radiogroup"
      >
        {cards.map((card) => {
          const active = current === card.mode
          const Icon = card.icon
          return (
            <button
              aria-checked={active}
              className={cn(
                "flex min-h-0 cursor-pointer items-start gap-2.5 rounded-xl bg-card p-3 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-shadow focus-visible:ring-3 focus-visible:ring-brand-soft focus-visible:outline-none max-sm:min-h-12",
                active &&
                  "shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)]",
                disabled && "cursor-not-allowed opacity-60"
              )}
              disabled={disabled}
              key={card.mode}
              onClick={() => pick(card.mode)}
              role="radio"
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-8 flex-none place-items-center rounded-lg",
                  active
                    ? "bg-brand-soft text-brand-text"
                    : "bg-surface-2 text-fg-3"
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm leading-5 font-semibold">
                  {card.title}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-[18px] text-fg-2">
                  {card.hint}
                </span>
              </span>
            </button>
          )
        })}
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
