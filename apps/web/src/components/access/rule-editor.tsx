import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { WandSparklesIcon } from "lucide-react"

import type { TFunction } from "i18next"

import type {
  AccessProtocol,
  AccessRule,
  AccessSubjects,
} from "@/lib/access-policy"
import { checkPort, portsSummary } from "@/lib/access-policy"
import { Segmented } from "@/components/ui/segmented"
import { Switch } from "@/components/ui/switch"
import { AdvancedFields } from "@/components/access/advanced-fields"
import { SubjectPicker } from "@/components/access/subject-picker"
import { TagInput } from "@/components/access/tag-input"
import {
  applyService,
  localRuleErrors,
  rulePreview,
  SERVICE_ORDER,
  serviceForRule,
  suggestedRuleName,
  type RuleValidationErrors,
  type ServiceId,
} from "@/components/access/access-rule-summary"
import { cn } from "@/lib/utils"

export type RuleFieldErrors = RuleValidationErrors

function FieldLabel({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <span className="mb-1 flex min-h-6 flex-wrap items-center gap-2 text-[12.5px] leading-4 font-medium text-fg-2">
      <span className="min-w-0">{children}</span>
      {action ? <span className="ml-auto">{action}</span> : null}
    </span>
  )
}

function FieldError({ children }: { children?: string }) {
  if (!children) return null
  return (
    <p
      aria-live="polite"
      className="mt-1 text-[12.5px] leading-[18px] text-err"
    >
      {children}
    </p>
  )
}

function protocolOptions(disabled = false) {
  return [
    { value: "tcp" as AccessProtocol, label: "TCP", disabled },
    { value: "udp" as AccessProtocol, label: "UDP", disabled },
    { value: "icmp" as AccessProtocol, label: "ICMP", disabled },
    { value: "icmpv6" as AccessProtocol, label: "ICMPv6", disabled },
  ]
}

function portError(value: string, t: TFunction): string | null {
  const result = checkPort(value)
  if (result.ok) return null
  return result.error === "range"
    ? t("accessA.ports.errorRange")
    : t("accessA.ports.errorPort")
}

/**
 * The service picker is the second half of the sentence. Presets write
 * destination ports; protocol and free-form ports only appear for Custom.
 */
export function ServiceFields({
  rule,
  onChange,
  disabled,
  error,
}: {
  rule: AccessRule
  onChange: (patch: Partial<AccessRule>) => void
  disabled?: boolean
  error?: string
}) {
  const { t } = useTranslation()
  const service = serviceForRule(rule)
  const [portsExplicit, setPortsExplicit] = useState(rule.ports.length > 0)
  const anyPort = rule.ports.length === 0 && !portsExplicit

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="service-fields">
      <FieldLabel>{t("accessA.rules.service")}</FieldLabel>
      <div
        aria-label={t("accessA.rules.service")}
        className="flex min-w-0 flex-wrap gap-1.5"
        role="radiogroup"
      >
        {SERVICE_ORDER.map((id) => (
          <button
            aria-checked={service === id}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-card px-2.5 text-[13px] font-medium shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-11",
              service === id &&
                "bg-brand-soft text-brand-text shadow-[inset_0_0_0_1px_var(--brand)]"
            )}
            disabled={disabled}
            key={id}
            onClick={() => onChange(applyService(rule, id as ServiceId))}
            role="radio"
            type="button"
          >
            {t(`accessA.ports.preset.${id}`)}
          </button>
        ))}
      </div>

      {service === "custom" ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="min-w-0">
            <FieldLabel>{t("accessA.ports.protocol")}</FieldLabel>
            <Segmented
              className="[&>button]:h-[30px] max-sm:[&>button]:h-11"
              fill
              label={t("accessA.ports.protocol")}
              onValueChange={(protocol) => {
                if (protocol === "icmp" || protocol === "icmpv6") {
                  onChange({ protocol, ports: [], sourcePorts: [] })
                } else {
                  onChange({ protocol })
                }
              }}
              options={protocolOptions(disabled)}
              value={rule.protocol}
            />
          </div>
          <div className="min-w-0">
            <FieldLabel
              action={
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-normal">
                  <input
                    checked={anyPort}
                    className="size-4 accent-[var(--brand)]"
                    disabled={disabled}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setPortsExplicit(false)
                        onChange({ ports: [] })
                      } else {
                        setPortsExplicit(true)
                      }
                    }}
                    type="checkbox"
                  />
                  {t("accessA.ports.anyPort")}
                </label>
              }
            >
              {t("accessA.ports.destination")}
            </FieldLabel>
            <TagInput
              data-testid="rule-destination-ports"
              disabled={disabled || anyPort}
              inputMode="numeric"
              label={t("accessA.ports.destination")}
              onChange={(ports) => {
                setPortsExplicit(true)
                onChange({ ports })
              }}
              placeholder={t("accessA.ports.addDestination")}
              validate={(value) => portError(value, t)}
              isRange={(value) => {
                const result = checkPort(value)
                return result.ok && result.range
              }}
              values={rule.ports}
            />
          </div>
        </div>
      ) : (
        <p
          className="text-[12.5px] leading-[18px] text-fg-2"
          data-testid="service-summary"
        >
          {portsSummary(rule, t)}
        </p>
      )}
      <FieldError>{error}</FieldError>
    </div>
  )
}

/**
 * Sentence-like rule form: action, from, to, service. Rare fields live under
 * Advanced. It edits a draft; the sheet owns Save/Cancel and the dirty guard.
 */
export function RuleForm({
  rule,
  index,
  subjects,
  networkId,
  onChange,
  disabled = false,
  errors,
  showErrors = false,
}: {
  rule: AccessRule
  index: number
  subjects: AccessSubjects
  networkId: string
  onChange: (patch: Partial<AccessRule>) => void
  disabled?: boolean
  errors?: RuleFieldErrors
  showErrors?: boolean
}) {
  const { t } = useTranslation()
  const local = localRuleErrors(rule, t)
  const shown = showErrors ? { ...local, ...errors } : (errors ?? {})
  const suggestion = suggestedRuleName(rule, subjects, t)
  const preview = rulePreview(rule, subjects, t)

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="rule-form">
      <p
        aria-live="polite"
        className="rounded-xl bg-brand-soft px-3 py-2.5 text-[13px] leading-[19px] font-medium text-brand-text"
        data-testid="rule-preview"
      >
        {preview}
      </p>

      <label className="block min-w-0">
        <FieldLabel
          action={
            !rule.name?.trim() ? (
              <button
                className="inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12.5px] font-medium text-brand-text hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                disabled={disabled}
                onClick={() => onChange({ name: suggestion })}
                type="button"
              >
                <WandSparklesIcon aria-hidden="true" className="size-3.5" />
                {t("accessA.rules.useSuggestion")}
              </button>
            ) : null
          }
        >
          {t("accessA.rules.nameOptional")}
        </FieldLabel>
        <input
          aria-invalid={shown.name ? true : undefined}
          aria-label={t("accessA.rules.name")}
          autoComplete="off"
          autoFocus={index < 0}
          className={cn(
            "h-10 w-full min-w-0 rounded-lg border-0 bg-card px-2.5 text-sm text-foreground shadow-[inset_0_0_0_1px_var(--line-2)] outline-0 focus:shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)] disabled:cursor-not-allowed disabled:bg-surface-2 max-sm:h-12 max-sm:text-base",
            shown.name && "shadow-[inset_0_0_0_1.5px_var(--err)]"
          )}
          disabled={disabled}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder={suggestion}
          value={rule.name ?? ""}
        />
        <FieldError>{shown.name}</FieldError>
      </label>

      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <FieldLabel>{t("accessA.rules.action")}</FieldLabel>
          <Segmented
            className="[&>button]:h-[34px] max-sm:[&>button]:h-11"
            fill
            label={t("accessA.rules.action")}
            onValueChange={(action) => onChange({ action })}
            options={[
              {
                value: "allow" as const,
                label: t("accessA.rules.allow"),
                disabled,
              },
              {
                value: "deny" as const,
                label: t("accessA.rules.deny"),
                disabled,
              },
            ]}
            value={rule.action}
          />
        </div>
        <label className="flex min-h-10 flex-none items-center gap-2 pb-0.5 max-sm:min-h-12">
          <span className="text-[12.5px] leading-[18px] font-medium">
            {t("accessA.rules.enabled")}
          </span>
          <Switch
            aria-label={t("accessA.rules.enabled")}
            checked={rule.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) => onChange({ enabled })}
          />
        </label>
      </div>

      {/* "From" and "To" stay in one column: at the sheet's 560px the pair was
          ~240px wide and a CIDR chip had to break inside itself. */}
      <div className="grid min-w-0 gap-3">
        <div className="min-w-0">
          <FieldLabel>{t("accessA.rules.from")}</FieldLabel>
          <SubjectPicker
            data-testid="subject-picker-from"
            disabled={disabled}
            error={shown.from}
            label={t("accessA.rules.from")}
            onChange={(from) => onChange({ from })}
            side="from"
            subjects={subjects}
            values={rule.from}
          />
        </div>
        <div className="min-w-0">
          <FieldLabel>{t("accessA.rules.to")}</FieldLabel>
          <SubjectPicker
            data-testid="subject-picker-to"
            disabled={disabled}
            error={shown.to}
            label={t("accessA.rules.to")}
            onChange={(to) => onChange({ to })}
            side="to"
            subjects={subjects}
            values={rule.to}
          />
        </div>
      </div>

      <ServiceFields
        disabled={disabled}
        error={shown.ports ?? shown.protocol}
        onChange={onChange}
        rule={rule}
      />

      <AdvancedFields
        disabled={disabled}
        errors={{
          ...(shown.burst ? { burst: shown.burst } : {}),
          ...(shown.rate ? { rate: shown.rate } : {}),
          ...(shown.sourcePorts ? { sourcePorts: shown.sourcePorts } : {}),
        }}
        index={index}
        networkId={networkId}
        onChange={onChange}
        rule={rule}
        subjects={subjects}
      />
      <FieldError>{shown.general}</FieldError>
    </div>
  )
}

/** Backwards-compatible name used by the old inline editor. */
export const RuleFields = RuleForm
