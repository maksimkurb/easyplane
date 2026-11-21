import { useTranslation } from "react-i18next"
import {
  ArrowRightIcon,
  InfoIcon,
  LockIcon,
  SlidersHorizontalIcon,
} from "lucide-react"

import type { AccessChain, AccessChainName } from "@/lib/access-policy"
import { ACCESS_CHAINS } from "@/lib/access-policy"
import { Segmented } from "@/components/ui/segmented"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type Chains = Record<AccessChainName, AccessChain>

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
                {t(`accessA.defaults.${name}`)}
              </span>
              <Segmented
                className="[&>button]:h-6 [&>button]:min-w-14 [&>button]:px-2.5 [&>button]:text-[12.5px] max-sm:[&>button]:h-11"
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
              <span className="min-w-0 flex-1 text-sm">
                {t("accessA.defaults.enabled")}
              </span>
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

/** Explanations for the three directions, shown as a proper tooltip. */
export function ChainDirectionLabel({ name }: { name: AccessChainName }) {
  const { t } = useTranslation()
  const explanation = t(`accessA.defaults.explain.${name}`)
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="text-[12.5px] leading-[18px] font-medium">
        {t(`accessA.defaults.${name}`)}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={explanation}
              className="grid size-6 flex-none cursor-help place-items-center rounded-md text-fg-2 hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:size-11"
              type="button"
            />
          }
        >
          <InfoIcon aria-hidden="true" className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>{explanation}</TooltipContent>
      </Tooltip>
    </span>
  )
}

/**
 * The final row of the rule list: what happens to traffic no rule matched.
 * Every direction is visible and editable in place; names and the enabled
 * switch stay under "Advanced settings".
 */
export function DefaultActionsRow({
  chains,
  onChange,
  disabled = false,
  expanded = false,
  onToggleAdvanced,
}: {
  chains: Chains
  onChange: (name: AccessChainName, patch: Partial<AccessChain>) => void
  disabled?: boolean
  expanded?: boolean
  onToggleAdvanced?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="min-w-0 bg-surface-2/70 px-2 py-2 sm:px-3"
      data-testid="default-actions-row"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] leading-[18px] font-semibold text-fg-2">
          <LockIcon aria-hidden="true" className="size-3.5 flex-none" />
          {t("accessA.defaults.everythingElse")}
        </span>
        <ArrowRightIcon
          aria-hidden="true"
          className="size-3.5 flex-none text-fg-3 max-sm:hidden"
        />

        <div className="grid min-w-0 basis-full gap-1.5 sm:flex sm:flex-1 sm:basis-auto sm:flex-wrap sm:items-center">
          {ACCESS_CHAINS.map((name) => (
            <span
              className="flex min-h-8 min-w-0 items-center justify-between gap-2 rounded-lg bg-card px-2 py-1 shadow-[inset_0_0_0_1px_var(--line)] sm:inline-flex sm:justify-start"
              key={name}
            >
              <ChainDirectionLabel name={name} />
              <Segmented
                className="[&>button]:h-6 [&>button]:min-w-12 [&>button]:px-2 [&>button]:text-[12px] max-sm:[&>button]:h-11"
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
                value={chains[name].default}
              />
            </span>
          ))}
        </div>

        {onToggleAdvanced ? (
          <button
            aria-expanded={expanded}
            className="ml-auto inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[12.5px] leading-[18px] font-medium text-fg-2 hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-11"
            data-testid="default-actions-advanced"
            disabled={disabled}
            onClick={onToggleAdvanced}
            type="button"
          >
            <SlidersHorizontalIcon aria-hidden="true" className="size-3.5" />
            {t("accessA.defaults.advanced")}
          </button>
        ) : null}
      </div>
    </div>
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
      className={cn("border-t border-line bg-surface-2 p-2.5", className)}
      data-testid="default-actions-panel"
    >
      <ChainDefaultsForm
        chains={chains}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  )
}
