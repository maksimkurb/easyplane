import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ChevronRightIcon } from "lucide-react"

import type { AccessRule, AccessSubjects } from "@/lib/access-policy"
import { portsSummary } from "@/lib/access-policy"
import { Segmented } from "@/components/ui/segmented"
import { Switch } from "@/components/ui/switch"
import { AdvancedFields } from "@/components/access/advanced-fields"
import { PortsFields } from "@/components/access/ports-fields"
import { SubjectPicker, SubjectValueButton } from "@/components/access/subject-picker"
import { cn } from "@/lib/utils"

export type RuleFieldErrors = {
  name?: string
  from?: string
  to?: string
  ports?: string
  sourcePorts?: string
  protocol?: string
  burst?: string
  rate?: string
  general?: string
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-[12.5px] leading-4 font-medium text-fg-2">
      {children}
    </span>
  )
}

function FieldError({ children }: { children?: string }) {
  if (!children) return null
  return (
    <p aria-live="polite" className="mt-1 text-[12.5px] leading-[18px] text-err">
      {children}
    </p>
  )
}

export function RuleFields({
  rule,
  index,
  subjects,
  networkId,
  onChange,
  disabled = false,
  errors,
  presentation,
  onOpenPicker,
  onOpenPorts,
}: {
  rule: AccessRule
  index: number
  subjects: AccessSubjects
  networkId: string
  onChange: (patch: Partial<AccessRule>) => void
  disabled?: boolean
  errors?: RuleFieldErrors
  presentation: "inline" | "sheet"
  onOpenPicker?: (side: "from" | "to") => void
  onOpenPorts?: () => void
}) {
  const { t } = useTranslation()
  const compact = presentation === "sheet"

  return (
    <div
      className={cn(
        "min-w-0",
        compact
          ? "flex flex-col gap-3.5"
          : "grid gap-3 md:grid-cols-2 md:items-start"
      )}
    >
      <label className="block min-w-0">
        <FieldLabel>{t("accessA.rules.name")}</FieldLabel>
        <input
          aria-label={t("accessA.rules.name")}
          aria-invalid={errors?.name ? true : undefined}
          className={cn(
            "h-9 w-full min-w-0 rounded-lg border-0 bg-card px-2.5 text-sm text-foreground shadow-[inset_0_0_0_1px_var(--line-2)] outline-0 focus:shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)] disabled:cursor-not-allowed disabled:bg-surface-2 max-sm:h-12 max-sm:text-base",
            errors?.name && "shadow-[inset_0_0_0_1.5px_var(--err)]"
          )}
          disabled={disabled}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder={t("accessA.rules.namePlaceholder")}
          value={rule.name ?? ""}
        />
        <FieldError>{errors?.name}</FieldError>
      </label>

      <div className={cn("flex min-w-0 items-end gap-3", compact && "items-center")}>
        <div className="min-w-0 flex-1">
          <FieldLabel>{t("accessA.rules.action")}</FieldLabel>
          <Segmented
            className="[&>button]:h-[30px] max-sm:[&>button]:h-10"
            fill
            label={t("accessA.rules.action")}
            onValueChange={(action) => onChange({ action })}
            options={[
              { value: "allow" as const, label: t("accessA.rules.allow"), disabled },
              { value: "deny" as const, label: t("accessA.rules.deny"), disabled },
            ]}
            value={rule.action}
          />
        </div>
        {compact ? (
          <div className="flex flex-none items-center gap-2 pb-1">
            <span className="text-sm font-medium">{t("accessA.rules.enabled")}</span>
            <Switch
              aria-label={t("accessA.rules.enabled")}
              checked={rule.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => onChange({ enabled })}
            />
          </div>
        ) : null}
      </div>

      <div className={cn("grid min-w-0 gap-3 sm:grid-cols-2", compact ? "" : "md:col-span-2")}>
        <div className="min-w-0">
          <FieldLabel>{t("accessA.rules.from")}</FieldLabel>
          {compact ? (
            <SubjectValueButton
              disabled={disabled}
              error={errors?.from}
              label={t("accessA.rules.from")}
              onClick={() => onOpenPicker?.("from")}
              side="from"
              subjects={subjects}
              values={rule.from}
            />
          ) : (
            <SubjectPicker
              data-testid="subject-picker-from"
              disabled={disabled}
              error={errors?.from}
              label={t("accessA.rules.from")}
              onChange={(from) => onChange({ from })}
              side="from"
              subjects={subjects}
              values={rule.from}
            />
          )}
          {compact ? <FieldError>{errors?.from}</FieldError> : null}
        </div>
        <div className="min-w-0">
          <FieldLabel>{t("accessA.rules.to")}</FieldLabel>
          {compact ? (
            <SubjectValueButton
              disabled={disabled}
              error={errors?.to}
              label={t("accessA.rules.to")}
              onClick={() => onOpenPicker?.("to")}
              side="to"
              subjects={subjects}
              values={rule.to}
            />
          ) : (
            <SubjectPicker
              data-testid="subject-picker-to"
              disabled={disabled}
              error={errors?.to}
              label={t("accessA.rules.to")}
              onChange={(to) => onChange({ to })}
              side="to"
              subjects={subjects}
              values={rule.to}
            />
          )}
          {compact ? <FieldError>{errors?.to}</FieldError> : null}
        </div>
      </div>

      {compact ? (
        <div className="min-w-0">
          <FieldLabel>{t("accessA.ports.label")}</FieldLabel>
          <button
            aria-label={`${t("accessA.ports.label")}: ${portsSummary(rule, t)}`}
            className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-[10px] bg-card px-3 text-left text-sm shadow-[inset_0_0_0_1px_var(--line-2)] focus-visible:ring-3 focus-visible:ring-brand-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-2"
            data-testid="ports-trigger"
            disabled={disabled}
            onClick={onOpenPorts}
            type="button"
          >
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {portsSummary(rule, t)}
            </span>
            <ChevronRightIcon aria-hidden="true" className="size-4 flex-none text-fg-3" />
          </button>
          <FieldError>{errors?.ports ?? errors?.sourcePorts ?? errors?.protocol}</FieldError>
        </div>
      ) : (
        <div className="md:col-span-2">
          <PortsFields
            disabled={disabled}
            errors={{
              ...(errors?.ports ? { ports: errors.ports } : {}),
              ...(errors?.sourcePorts ? { sourcePorts: errors.sourcePorts } : {}),
              ...(errors?.protocol ? { protocol: errors.protocol } : {}),
            }}
            layout="grid"
            onChange={onChange}
            rule={rule}
            testIdPrefix={`rule-${index}`}
          />
        </div>
      )}

      <div className={compact ? "" : "md:col-span-2"}>
        <AdvancedFields
          disabled={disabled}
          errors={{ ...(errors?.burst ? { burst: errors.burst } : {}), ...(errors?.rate ? { rate: errors.rate } : {}) }}
          index={index}
          networkId={networkId}
          onChange={onChange}
          rule={rule}
          subjects={subjects}
        />
      </div>
      <div className={compact ? "" : "md:col-span-2"}>
        <FieldError>{errors?.general}</FieldError>
      </div>
    </div>
  )
}
