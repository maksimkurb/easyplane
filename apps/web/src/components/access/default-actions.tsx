import { useState } from "react"
import { useTranslation } from "react-i18next"
import { LockIcon, MoreHorizontalIcon } from "lucide-react"

import type { AccessChain, AccessChainName } from "@/lib/access-policy"
import { ACCESS_CHAINS } from "@/lib/access-policy"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Segmented } from "@/components/ui/segmented"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

type Chains = Record<AccessChainName, AccessChain>

function ChainTitle({ name }: { name: AccessChainName }) {
  const { t } = useTranslation()
  return <>{t(`accessA.defaults.${name}`)}</>
}

export function ChainDefaultsForm({
  chains,
  onChange,
  disabled = false,
}: {
  chains: Chains
  onChange: (name: AccessChainName, patch: Partial<AccessChain>) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {ACCESS_CHAINS.map((name) => {
        const chain = chains[name]
        return (
          <div
            className="flex min-w-0 flex-col gap-2 rounded-[10px] bg-card p-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
            key={name}
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 text-sm font-medium">
                <ChainTitle name={name} />
              </span>
              <Segmented
                className="[&>button]:h-6 [&>button]:min-w-14 [&>button]:px-2.5 [&>button]:text-[12.5px] max-sm:[&>button]:h-8"
                label={t("accessA.defaults.defaultLabel", {
                  chain: t(`accessA.defaults.${name}`),
                })}
                onValueChange={(value) => onChange(name, { default: value })}
                options={[
                  {
                    value: "block" as const,
                    label: t("accessA.defaults.block"),
                    disabled,
                  },
                  {
                    value: "allow" as const,
                    label: t("accessA.defaults.allow"),
                    disabled,
                  },
                ]}
                size="sm"
                value={chain.default}
              />
            </div>
            <div className="flex min-h-8 items-center gap-2 max-sm:min-h-12">
              <span className="min-w-0 flex-1 text-sm">{t("accessA.defaults.enabled")}</span>
              <Switch
                aria-label={`${t(`accessA.defaults.${name}`)}: ${t(
                  "accessA.defaults.enabled"
                )}`}
                checked={chain.enabled}
                disabled={disabled}
                onCheckedChange={(enabled) => onChange(name, { enabled })}
                size="sm"
              />
            </div>
            <input
              aria-label={t("accessA.defaults.nameLabel", {
                chain: t(`accessA.defaults.${name}`),
              })}
              className="h-8 w-full min-w-0 rounded-lg border-0 bg-card px-2.5 text-[13px] text-foreground shadow-[inset_0_0_0_1px_var(--line-2)] outline-0 focus:shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)] disabled:cursor-not-allowed disabled:bg-surface-2 max-sm:h-11 max-sm:text-base"
              disabled={disabled}
              onChange={(event) => onChange(name, { name: event.target.value })}
              placeholder={t("accessA.defaults.name")}
              value={chain.name ?? ""}
            />
          </div>
        )
      })}
    </div>
  )
}

export function DefaultActionsFooter({
  chains,
  canEdit,
  busy,
  onOpen,
  expanded,
}: {
  chains: Chains
  canEdit: boolean
  busy: boolean
  onOpen: () => void
  expanded: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 bg-surface-2 px-2 py-1 sm:px-3",
        expanded ? "rounded-b-none" : "rounded-b-xl"
      )}
    >
      <LockIcon aria-hidden="true" className="hidden size-3.5 flex-none text-fg-3 sm:block" />
      <span className="text-[12.5px] leading-[18px] font-medium text-fg-2">
        <span className="max-sm:hidden">{t("accessA.defaults.footer")}</span>
        <span className="sm:hidden">{t("accessA.defaults.footerShort")}</span>
      </span>
      <span className="flex min-w-0 flex-wrap gap-1">
        {ACCESS_CHAINS.map((name) => (
          <span
            className="inline-flex h-[22px] items-center gap-1 rounded-md bg-card px-1.5 text-[12.5px] leading-[18px] text-fg-2 shadow-[inset_0_0_0_1px_var(--line)]"
            key={name}
          >
            <span>{t(`accessA.defaults.${name}`)}</span>
            <b className="font-semibold text-foreground">
              {chains[name].default === "block"
                ? t("accessA.defaults.block")
                : t("accessA.defaults.allow")}
            </b>
          </span>
        ))}
      </span>
      <button
        aria-expanded={expanded}
        aria-label={t("accessA.defaults.more")}
        className="relative ml-auto grid size-8 flex-none place-items-center rounded-lg text-fg-2 hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none after:absolute after:-inset-1.5 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="default-actions-trigger"
        disabled={!canEdit || busy}
        onClick={onOpen}
        type="button"
      >
        <MoreHorizontalIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}

function DefaultActionsSheetBody({
  chains,
  canEdit,
  busy,
  onDone,
}: {
  chains: Chains
  canEdit: boolean
  busy: boolean
  onDone: (chains: Chains) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Chains>(chains)
  return (
    <SheetContent
      className="max-h-[calc(100dvh-96px)] gap-0 p-0 data-[side=bottom]:rounded-t-2xl"
      data-testid="default-actions-sheet"
      showCloseButton={false}
      side="bottom"
    >
      <div className="mx-auto mt-2 h-1.5 w-10 flex-none rounded-full bg-line-2" />
      <SheetHeader className="min-h-[52px] flex-none justify-center px-4 py-1">
        <SheetTitle className="text-base leading-[22px]">
          {t("accessA.defaults.title")}
        </SheetTitle>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-3">
        <ChainDefaultsForm
          chains={draft}
          disabled={!canEdit || busy}
          onChange={(name, patch) =>
            setDraft((current) => ({
              ...current,
              [name]: { ...current[name], ...patch },
            }))
          }
        />
      </div>
      <SheetFooter className="m-0 flex-none border-t border-line bg-card p-4">
        <Button
          disabled={!canEdit || busy}
          onClick={() => onDone(draft)}
          type="button"
        >
          {t("accessA.defaults.done")}
        </Button>
      </SheetFooter>
    </SheetContent>
  )
}

export function DefaultActionsSheet({
  open,
  onOpenChange,
  chains,
  onSave,
  canEdit,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chains: Chains
  onSave: (chains: Chains) => void
  canEdit: boolean
  busy: boolean
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      {open ? (
        <DefaultActionsSheetBody
          busy={busy}
          canEdit={canEdit}
          chains={chains}
          onDone={(next) => {
            onSave(next)
            onOpenChange(false)
          }}
        />
      ) : null}
    </Sheet>
  )
}

export function DefaultActionsPanel({
  chains,
  onChange,
  disabled,
  className,
}: {
  chains: Chains
  onChange: (name: AccessChainName, patch: Partial<AccessChain>) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      className={cn("rounded-b-xl border-t border-line bg-surface-2 p-2.5", className)}
      data-testid="default-actions-panel"
    >
      <ChainDefaultsForm chains={chains} disabled={disabled} onChange={onChange} />
    </div>
  )
}
