import { useState } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

import type { AccessProtocol, AccessRule } from "@/lib/access-policy"
import { checkPort, mergeValues } from "@/lib/access-policy"
import { Segmented } from "@/components/ui/segmented"
import { TagInput } from "@/components/access/tag-input"

function protocolOptions(t: TFunction, disabled = false) {
  return [
    { value: "any" as AccessProtocol, label: t("accessA.ports.protocolAny"), disabled },
    { value: "tcp" as AccessProtocol, label: "TCP", disabled },
    { value: "udp" as AccessProtocol, label: "UDP", disabled },
    { value: "icmp" as AccessProtocol, label: "ICMP", disabled },
    { value: "icmpv6" as AccessProtocol, label: "ICMPv6", disabled },
  ]
}

const PRESETS: Array<{
  id: "ssh" | "http" | "rdp" | "smb" | "dns" | "ping"
  hint: string
  protocol: AccessProtocol
  ports: string[]
}> = [
  { id: "ssh", hint: "22", protocol: "tcp", ports: ["22"] },
  { id: "http", hint: "80,443", protocol: "tcp", ports: ["80", "443"] },
  { id: "rdp", hint: "3389", protocol: "tcp", ports: ["3389"] },
  { id: "smb", hint: "445", protocol: "tcp", ports: ["445"] },
  { id: "dns", hint: "53", protocol: "udp", ports: ["53"] },
  { id: "ping", hint: "ICMP", protocol: "icmp", ports: [] },
]

export function QuickAdd({
  rule,
  onChange,
  disabled,
}: {
  rule: AccessRule
  onChange: (patch: Partial<AccessRule>) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESETS.map((preset) => (
        <button
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-card px-2.5 text-[13px] font-medium shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-9"
          disabled={disabled}
          key={preset.id}
          onClick={() => {
            if (preset.protocol === "icmp") {
              onChange({ protocol: "icmp", ports: [], sourcePorts: [] })
              return
            }
            const sameProtocol = rule.protocol === preset.protocol
            onChange({
              protocol: preset.protocol,
              ports: mergeValues(sameProtocol ? rule.ports : [], preset.ports),
              sourcePorts: sameProtocol ? rule.sourcePorts : [],
            })
          }}
          type="button"
        >
          {t(`accessA.ports.preset.${preset.id}`)}
          <span className="font-mono text-[12.5px] font-normal text-fg-3">{preset.hint}</span>
        </button>
      ))}
    </div>
  )
}

export function PortsFields({
  rule,
  onChange,
  disabled = false,
  errors,
  testIdPrefix,
  layout = "stack",
}: {
  rule: AccessRule
  onChange: (patch: Partial<AccessRule>) => void
  disabled?: boolean
  errors?: { ports?: string; sourcePorts?: string; protocol?: string }
  testIdPrefix?: string
  layout?: "stack" | "grid"
}) {
  const { t } = useTranslation()
  const noPorts = rule.protocol === "any" || rule.protocol === "icmp" || rule.protocol === "icmpv6"
  const [portsExplicit, setPortsExplicit] = useState(rule.ports.length > 0)

  const anyPort = noPorts || (rule.ports.length === 0 && !portsExplicit)

  const portError = (value: string): string | null => {
    const result = checkPort(value)
    if (result.ok) return null
    return result.error === "range" ? t("accessA.ports.errorRange") : t("accessA.ports.errorPort")
  }

  return (
    <div
      className={
        layout === "grid"
          ? "grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3 xl:items-start"
          : "flex min-w-0 flex-col gap-3"
      }
    >
      <div>
        <span className="mb-1 block text-[12.5px] leading-4 font-medium text-fg-2">
          {t("accessA.ports.protocol")}
        </span>
        <Segmented
          className="[&>button]:h-[30px] max-sm:[&>button]:h-9"
          fill
          label={t("accessA.ports.protocol")}
          onValueChange={(protocol) => {
            if (protocol === "any" || protocol === "icmp" || protocol === "icmpv6") {
              setPortsExplicit(false)
              onChange({ protocol, ports: [], sourcePorts: [] })
            } else {
              onChange({ protocol })
            }
          }}
          options={protocolOptions(t, disabled)}
          value={rule.protocol}
        />
        {errors?.protocol ? (
          <p aria-live="polite" className="mt-1 text-[12.5px] text-err">
            {errors.protocol}
          </p>
        ) : null}
      </div>

      <div>
        <span className="mb-1 block text-[12.5px] leading-4 font-medium text-fg-2">
          {t("accessA.ports.destination")}
        </span>
        <TagInput
          data-testid={testIdPrefix ? `${testIdPrefix}-destination-ports` : undefined}
          disabled={disabled || anyPort}
          inputMode="numeric"
          label={t("accessA.ports.destination")}
          onChange={(ports) => {
            setPortsExplicit(true)
            onChange({ ports })
          }}
          placeholder={t("accessA.ports.addDestination")}
          validate={portError}
          isRange={(value) => {
            const result = checkPort(value)
            return result.ok && result.range
          }}
          values={rule.ports}
        />
        {errors?.ports ? (
          <p aria-live="polite" className="mt-1 text-[12.5px] text-err">
            {errors.ports}
          </p>
        ) : null}
        <label className="flex min-h-8 cursor-pointer items-center gap-2.5 text-sm max-sm:min-h-12">
          <input
            checked={anyPort}
            className="size-[18px] accent-[var(--brand)]"
            disabled={disabled || noPorts}
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
          <span>{t("accessA.ports.anyPort")}</span>
        </label>
      </div>

      <div className={layout === "grid" ? "flex min-w-0 flex-col gap-3" : "contents"}>
        {!noPorts ? (
          <div>
            <span className="mb-1 block text-[12.5px] leading-4 font-medium text-fg-2">
              {t("accessA.ports.source")}
            </span>
            <TagInput
              data-testid={testIdPrefix ? `${testIdPrefix}-source-ports` : undefined}
              disabled={disabled}
              inputMode="numeric"
              label={t("accessA.ports.source")}
              onChange={(sourcePorts) => onChange({ sourcePorts })}
              placeholder={t("accessA.ports.addSource")}
              validate={portError}
              isRange={(value) => {
                const result = checkPort(value)
                return result.ok && result.range
              }}
              values={rule.sourcePorts}
            />
            {errors?.sourcePorts ? (
              <p aria-live="polite" className="mt-1 text-[12.5px] text-err">
                {errors.sourcePorts}
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <span className="mb-1 block text-[12.5px] leading-4 font-medium text-fg-2">
            {t("accessA.ports.quickAdd")}
          </span>
          <QuickAdd disabled={disabled} onChange={onChange} rule={rule} />
        </div>
      </div>
    </div>
  )
}
