import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDownIcon } from "lucide-react"

import type { GetCompiledAcl200ChainsItemRulesItem } from "@/api/generated/model"
import type { AccessRule, AccessSubjects } from "@/lib/access-policy"
import {
  checkPort,
  compiledRuleDevice,
  compiledRulePrefix,
} from "@/lib/access-policy"
import { useGetCompiledAcl } from "@/api/generated/easyplane"
import { Switch } from "@/components/ui/switch"
import { TagInput } from "@/components/access/tag-input"
import { cn } from "@/lib/utils"

function compiledFields(rule: GetCompiledAcl200ChainsItemRulesItem): string {
  return [
    `name:               "${rule.name}"`,
    `description:        "${rule.description}"`,
    `priority:           ${rule.priority}`,
    `enabled:            ${rule.enabled}`,
    `protocol:           ${rule.protocol}`,
    `ports:              ${JSON.stringify(rule.ports)}`,
    `source_ips:         ${JSON.stringify(rule.sourceIps)}`,
    `destination_ips:    ${JSON.stringify(rule.destinationIps)}`,
    `source_ports:       ${JSON.stringify(rule.sourcePorts)}`,
    `action:             ${rule.action}`,
    `rate_limit:         ${rule.rateLimit}`,
    `burst_limit:        ${rule.burstLimit}`,
    `stateful:           ${rule.stateful}`,
    `source_groups:      ${JSON.stringify(rule.sourceGroups)}`,
    `destination_groups: ${JSON.stringify(rule.destinationGroups)}`,
  ].join("\n")
}

export function AdvancedFields({
  rule,
  index,
  subjects,
  networkId,
  onChange,
  disabled = false,
  errors,
}: {
  rule: AccessRule
  index: number
  subjects: AccessSubjects
  networkId: string
  onChange: (patch: Partial<AccessRule>) => void
  disabled?: boolean
  errors?: { burst?: string; rate?: string; sourcePorts?: string }
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(rule.rateLimit !== undefined)
  const [limitOn, setLimitOn] = useState(
    rule.rateLimit !== undefined || rule.burst !== undefined
  )
  const [compiledOpen, setCompiledOpen] = useState(false)
  const device = compiledRuleDevice(rule, subjects)
  const compiledQuery = useGetCompiledAcl(networkId, device?.id ?? "", {
    query: { enabled: compiledOpen && Boolean(device) },
  })
  const rate = rule.rateLimit !== undefined ? String(rule.rateLimit) : ""
  const burst = rule.burst !== undefined ? String(rule.burst) : ""
  const burstError = limitOn && rate !== "" && burst === ""
  const prefix = compiledRulePrefix(rule, index)
  const matched =
    compiledQuery.data?.data.chains.flatMap((chain) =>
      chain.rules
        .filter((entry) => entry.name.startsWith(prefix))
        .map((entry) => ({ chain: chain.name, entry }))
    ) ?? []

  const burstMessage =
    errors?.burst ??
    (burstError ? t("accessA.advanced.burstRequired") : undefined)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <button
        aria-expanded={open}
        className="flex min-h-9 w-full cursor-pointer items-center gap-2 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{t("accessA.advanced.label")}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "ml-auto size-4 text-fg-3 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div className="flex min-w-0 flex-col gap-3">
          {rule.protocol === "tcp" || rule.protocol === "udp" ? (
            <div className="min-w-0">
              <span className="mb-1 flex min-h-6 items-center text-[12.5px] leading-4 font-medium text-fg-2">
                {t("accessA.ports.source")}
              </span>
              <TagInput
                disabled={disabled}
                inputMode="numeric"
                label={t("accessA.ports.source")}
                onChange={(sourcePorts) => onChange({ sourcePorts })}
                placeholder={t("accessA.ports.addSource")}
                validate={(value) => {
                  const result = checkPort(value)
                  if (result.ok) return null
                  return result.error === "range"
                    ? t("accessA.ports.errorRange")
                    : t("accessA.ports.errorPort")
                }}
                values={rule.sourcePorts}
              />
              {errors?.sourcePorts ? (
                <p
                  aria-live="polite"
                  className="mt-1 text-[12.5px] leading-[18px] text-err"
                >
                  {errors.sourcePorts}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1 rounded-[10px] bg-card p-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
              <div className="flex min-h-9 items-center gap-2">
                <span className="min-w-0 flex-1 text-sm">
                  {t("accessA.advanced.stateful")}
                </span>
                <Switch
                  aria-label={t("accessA.advanced.stateful")}
                  checked={rule.stateful}
                  disabled={disabled}
                  onCheckedChange={(stateful) => onChange({ stateful })}
                  size="sm"
                />
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2 rounded-[10px] bg-card p-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
              <div className="flex min-h-9 items-center gap-2">
                <span className="min-w-0 flex-1 text-sm">
                  {t("accessA.advanced.limit")}
                </span>
                <Switch
                  aria-label={t("accessA.advanced.limit")}
                  checked={limitOn}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    setLimitOn(checked)
                    if (!checked)
                      onChange({ rateLimit: undefined, burst: undefined })
                  }}
                  size="sm"
                />
              </div>
              {limitOn ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="min-w-0">
                      <span className="mb-1 block text-[12.5px] leading-4 font-medium text-fg-2">
                        {t("accessA.advanced.rate")}
                      </span>
                      <span
                        className={cn(
                          "flex h-9 items-center rounded-lg bg-card shadow-[inset_0_0_0_1px_var(--line-2)] focus-within:shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)] max-sm:h-12",
                          errors?.rate &&
                            "shadow-[inset_0_0_0_1.5px_var(--err)]"
                        )}
                      >
                        <input
                          aria-label={`${t("accessA.advanced.rate")} (${t(
                            "accessA.advanced.rateUnit"
                          )})`}
                          className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm text-foreground tabular-nums outline-0 max-sm:text-base"
                          disabled={disabled}
                          inputMode="numeric"
                          onChange={(event) => {
                            const value = event.target.value.replace(
                              /[^\d]/g,
                              ""
                            )
                            onChange({
                              rateLimit: value ? Number(value) : undefined,
                            })
                          }}
                          value={rate}
                        />
                        <span className="flex-none pr-2.5 text-[12.5px] text-fg-3">
                          {t("accessA.advanced.rateUnit")}
                        </span>
                      </span>
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-[12.5px] leading-4 font-medium text-fg-2">
                        {t("accessA.advanced.burst")}
                      </span>
                      <span
                        className={cn(
                          "flex h-9 items-center rounded-lg bg-card shadow-[inset_0_0_0_1px_var(--line-2)] focus-within:shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)] max-sm:h-12",
                          burstMessage &&
                            "shadow-[inset_0_0_0_1.5px_var(--err)]"
                        )}
                      >
                        <input
                          aria-invalid={burstMessage ? true : undefined}
                          aria-label={`${t("accessA.advanced.burst")} (${t(
                            "accessA.advanced.burstUnit"
                          )})`}
                          className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm text-foreground tabular-nums outline-0 max-sm:text-base"
                          disabled={disabled}
                          inputMode="numeric"
                          onChange={(event) => {
                            const value = event.target.value.replace(
                              /[^\d]/g,
                              ""
                            )
                            onChange({
                              burst: value ? Number(value) : undefined,
                            })
                          }}
                          value={burst}
                        />
                        <span className="flex-none pr-2.5 text-[12.5px] text-fg-3">
                          {t("accessA.advanced.burstUnit")}
                        </span>
                      </span>
                    </label>
                  </div>
                  {burstMessage ? (
                    <p
                      aria-live="polite"
                      className="text-[12.5px] leading-[18px] text-err"
                    >
                      {burstMessage}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          <button
            aria-expanded={compiledOpen}
            className="flex min-h-9 w-full cursor-pointer items-center gap-2 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            hidden={index < 0}
            onClick={() => setCompiledOpen((current) => !current)}
            type="button"
          >
            <span>{t("accessA.advanced.compiled")}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "ml-auto size-4 text-fg-3 transition-transform",
                compiledOpen && "rotate-180"
              )}
            />
          </button>
          {compiledOpen ? (
            <div className="min-w-0">
              <p className="mb-1 text-[12.5px] leading-4 text-fg-2">
                {device
                  ? t("accessA.advanced.compiledFor", { device: device.name })
                  : t("accessA.advanced.compiledEmpty")}
              </p>
              {device ? (
                compiledQuery.isLoading ? (
                  <p className="text-[12.5px] text-fg-2">
                    {t("common.loading")}
                  </p>
                ) : matched.length === 0 ? (
                  <p className="text-[12.5px] text-fg-2">
                    {t("accessA.advanced.compiledEmpty")}
                  </p>
                ) : (
                  <pre className="max-w-full overflow-x-hidden rounded-lg bg-card p-2.5 font-mono text-[12.5px] leading-[18px] [overflow-wrap:anywhere] whitespace-pre-wrap shadow-[inset_0_0_0_1px_var(--line)]">
                    {matched
                      .map(
                        ({ chain, entry }) =>
                          `# ${chain}\n${compiledFields(entry)}`
                      )
                      .join("\n\n")}
                  </pre>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
