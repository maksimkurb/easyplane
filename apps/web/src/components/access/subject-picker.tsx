import { useId, useMemo, useRef, useState } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GlobeIcon,
  MonitorIcon,
  NetworkIcon,
  SearchIcon,
  ServerIcon,
  SquareTerminalIcon,
  TagIcon,
  UsersIcon,
} from "lucide-react"

import type { AccessSubjects, SubjectKind } from "@/lib/access-policy"
import { checkAddress, subjectChip } from "@/lib/access-policy"
import { TagInput } from "@/components/access/tag-input"
import { SubjectChips } from "@/components/access/access-chips"
import { WireguardBadge } from "@/components/device/wireguard-badge"
import { prettySubnetName } from "@/components/access/access-rule-summary"
import { cn } from "@/lib/utils"

type PickerItem = {
  value: string
  label: string
  detail?: string
  kind: SubjectKind | "custom" | "any"
  /** The subject is an ordinary WireGuard client served by a hub portal. */
  wireguard?: boolean
}

type PickerSection = {
  key: string
  title: string
  items: PickerItem[]
}

function sectionIcon(kind: PickerItem["kind"]) {
  switch (kind) {
    case "tag":
      return <TagIcon aria-hidden="true" className="size-4" />
    case "group":
      return <UsersIcon aria-hidden="true" className="size-4" />
    case "subnet":
      return <NetworkIcon aria-hidden="true" className="size-4" />
    case "host":
      return <ServerIcon aria-hidden="true" className="size-4" />
    case "custom":
      return <SquareTerminalIcon aria-hidden="true" className="size-4" />
    case "any":
      return <GlobeIcon aria-hidden="true" className="size-4" />
    case "device":
    default:
      return <MonitorIcon aria-hidden="true" className="size-4" />
  }
}

function itemText(item: PickerItem, t: TFunction): string {
  if (item.value === "*") {
    return item.label
  }
  if (item.value === "custom") {
    return t("accessA.picker.customHint")
  }
  return item.detail ?? ""
}

function buildSections(
  subjects: AccessSubjects,
  side: "from" | "to",
  t: TFunction
): PickerSection[] {
  const anyLabel =
    side === "from" ? t("accessA.picker.anyFrom") : t("accessA.picker.anyTo")
  const groupDetail = (
    group: AccessSubjects["userGroups"][number] | undefined
  ) => {
    if (!group) return ""
    return `${t("accessA.picker.peopleCount", { count: group.peopleCount })}, ${t(
      "accessA.picker.deviceCount",
      { count: group.deviceCount }
    )}`
  }
  return [
    {
      key: "devices",
      title: t("accessA.picker.devices"),
      items: subjects.devices.map((device) => ({
        value: `device:${device.name}`,
        label: device.name,
        ...(device.virtualIpv4 ? { detail: device.virtualIpv4 } : {}),
        kind: "device" as const,
        ...(device.kind === "wireguard" ? { wireguard: true } : {}),
      })),
    },
    {
      key: "tags",
      title: t("accessA.picker.tags"),
      items: subjects.tags.map((tag) => ({
        value: `tag:${tag.name}`,
        label: tag.name,
        detail: t("accessA.picker.deviceCount", { count: tag.deviceCount }),
        kind: "tag" as const,
      })),
    },
    {
      key: "groups",
      title: t("accessA.picker.groups"),
      items: subjects.userGroups.map((group) => ({
        value: `group:${group.name}`,
        label: group.name,
        detail: groupDetail(group),
        kind: "group" as const,
      })),
    },
    {
      key: "subnets",
      title: t("accessA.picker.subnets"),
      items: subjects.subnets.map((subnet) => {
        const pretty = prettySubnetName(
          subnet.name,
          subnet.cidr,
          subnet.viaHostname
        )
        return {
          value: `subnet:${subnet.name}`,
          label: pretty.auto ? pretty.label : subnet.name,
          detail: pretty.auto
            ? pretty.via
              ? t("accessA.accordion.via", { device: pretty.via })
              : subnet.cidr
            : subnet.cidr,
          kind: "subnet" as const,
        }
      }),
    },
    {
      key: "hosts",
      title: t("accessA.picker.hosts"),
      items: subjects.hosts.map((host) => ({
        value: `host:${host.alias}`,
        label: host.alias,
        detail: host.value,
        kind: "host" as const,
      })),
    },
    {
      key: "custom",
      title: t("accessA.picker.customSection"),
      items: [
        {
          value: "custom",
          label: t("accessA.picker.custom"),
          detail: t("accessA.picker.customHint"),
          kind: "custom" as const,
        },
      ],
    },
    {
      key: "any",
      title: anyLabel,
      items: [{ value: "*", label: anyLabel, kind: "any" as const }],
    },
  ]
}

function filterSections(
  sections: PickerSection[],
  query: string
): PickerSection[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return sections
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        `${item.label} ${item.detail ?? ""} ${section.title}`
          .toLowerCase()
          .includes(needle)
      ),
    }))
    .filter((section) => section.items.length > 0)
}

function addressError(value: string, t: TFunction): string | null {
  const result = checkAddress(value)
  if (result.ok) return null
  if (result.error === "ipv4-prefix") return t("accessA.ports.errorIpv4Prefix")
  if (result.error === "ipv6-prefix") return t("accessA.ports.errorIpv6Prefix")
  return t("accessA.ports.errorAddress")
}

function customAddresses(values: string[]): string[] {
  return values
    .filter((value) => value.startsWith("cidr:"))
    .map((value) => value.slice("cidr:".length))
}

function selectionForCustom(values: string[]): boolean {
  return values.length > 0 && values.every((value) => value.startsWith("cidr:"))
}

/** The list itself, shared by the desktop popover and the phone sub-sheet. */
export function SubjectPickerList({
  subjects,
  side,
  values,
  onChange,
  fieldLabel,
  className,
  onPicked,
}: {
  subjects: AccessSubjects
  side: "from" | "to"
  values: string[]
  onChange: (values: string[]) => void
  fieldLabel: string
  className?: string
  onPicked?: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [customOpen, setCustomOpen] = useState(selectionForCustom(values))
  const searchId = useId()
  const sections = useMemo(
    () => filterSections(buildSections(subjects, side, t), query),
    [subjects, side, t, query]
  )
  const selected = useMemo(() => new Set(values), [values])

  const pick = (item: PickerItem) => {
    if (item.value === "custom") {
      setCustomOpen(true)
      return
    }
    setCustomOpen(false)
    onChange([item.value])
    onPicked?.()
  }

  const customValues = customAddresses(values)

  return (
    <div className={cn("min-w-0", className)}>
      <label
        className="flex min-h-11 items-center gap-2 border-b border-line bg-card px-3 text-fg-3"
        htmlFor={searchId}
      >
        <SearchIcon aria-hidden="true" className="size-4 flex-none" />
        <input
          aria-label={t("accessA.picker.searchLabel", { field: fieldLabel })}
          autoComplete="off"
          className="h-10 min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-0 max-sm:text-base"
          id={searchId}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("accessA.picker.search")}
          type="search"
          value={query}
        />
      </label>
      <div
        aria-label={fieldLabel}
        className="max-h-72 overflow-y-auto overscroll-contain"
        role="listbox"
      >
        {sections.length === 0 ? (
          <p className="px-3 py-3 text-[13px] text-fg-2">
            {t("accessA.picker.noResults")}
          </p>
        ) : null}
        {sections.map((section) => (
          <div key={section.key}>
            <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1 text-[12.5px] leading-4 font-semibold tracking-[0.05em] text-fg-2 uppercase">
              <span>{section.title}</span>
              <span className="tracking-normal tabular-nums">
                {section.items.length}
              </span>
            </div>
            {section.items.map((item) => {
              const isSelected =
                item.value === "*"
                  ? selected.has("*")
                  : item.value === "custom"
                    ? customOpen || selectionForCustom(values)
                    : selected.has(item.value)
              return (
                <button
                  aria-selected={isSelected}
                  className={cn(
                    "flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-t border-line px-3 py-1.5 text-left text-sm transition-colors",
                    isSelected && "bg-brand-soft text-brand-text",
                    item.kind === "tag" &&
                      !isSelected &&
                      "text-[var(--tag-fg)]",
                    item.kind === "group" &&
                      !isSelected &&
                      "text-[var(--ug-fg)]",
                    !isSelected && "hover:bg-surface-2"
                  )}
                  key={item.value}
                  onClick={() => pick(item)}
                  role="option"
                  type="button"
                >
                  <span className="flex-none">{sectionIcon(item.kind)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium [overflow-wrap:anywhere]">
                      {item.label}
                      {item.wireguard ? <WireguardBadge compact /> : null}
                    </span>
                    {item.value !== "*" ? (
                      <span className="block min-w-0 font-mono text-[12px] [overflow-wrap:anywhere] text-fg-2">
                        {itemText(item, t)}
                      </span>
                    ) : null}
                  </span>
                  {isSelected ? (
                    <CheckIcon
                      aria-hidden="true"
                      className="size-4 flex-none"
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {customOpen ? (
        <div className="border-t border-line bg-card p-3">
          <span className="mb-1 block text-[12.5px] leading-4 font-medium text-fg-2">
            {t("accessA.picker.custom")}
          </span>
          <TagInput
            data-testid="subject-custom-input"
            inputMode="text"
            label={t("accessA.picker.addressLabel", { field: fieldLabel })}
            onChange={(addresses) => {
              const others = values.filter(
                (value) => !value.startsWith("cidr:") && value !== "*"
              )
              onChange(
                addresses.length > 0
                  ? [
                      ...others,
                      ...addresses.map((address) => `cidr:${address}`),
                    ]
                  : others.length > 0
                    ? others
                    : ["*"]
              )
            }}
            placeholder={t("accessA.ports.addressPlaceholder")}
            validate={(value) => addressError(value, t)}
            values={customValues}
          />
        </div>
      ) : null}
    </div>
  )
}

/** Desktop trigger + popover panel. */
export function SubjectPicker({
  subjects,
  side,
  label,
  values,
  onChange,
  disabled = false,
  error,
  "data-testid": testId,
}: {
  subjects: AccessSubjects
  side: "from" | "to"
  label: string
  values: string[]
  onChange: (values: string[]) => void
  disabled?: boolean
  error?: string
  "data-testid"?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [primary] = values
  const chip = primary ? subjectChip(primary, subjects, side) : null

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={error ? true : undefined}
        aria-label={
          chip
            ? t("accessA.picker.trigger", { field: label, value: chip.label })
            : label
        }
        className={cn(
          "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-[10px] bg-card px-2.5 py-1 text-left shadow-[inset_0_0_0_1px_var(--line-2)] transition-shadow focus-visible:ring-3 focus-visible:ring-brand-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 max-sm:min-h-12",
          open &&
            "shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)]",
          error && "shadow-[inset_0_0_0_1.5px_var(--err)]"
        )}
        data-testid={testId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false)
        }}
        type="button"
      >
        <SubjectChips
          className="flex-1"
          side={side}
          subjects={subjects}
          values={values}
        />
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-4 flex-none text-fg-3 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {error ? (
        <p
          aria-live="polite"
          className="mt-1 text-[12.5px] leading-[18px] text-err"
        >
          {error}
        </p>
      ) : null}
      {open ? (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute top-full right-0 left-0 z-30 mt-1 min-w-0 overflow-hidden rounded-[10px] bg-surface-2 shadow-lg ring-1 ring-line"
            data-testid="subject-picker-panel"
          >
            <SubjectPickerList
              fieldLabel={label}
              onChange={onChange}
              onPicked={() => setOpen(false)}
              side={side}
              subjects={subjects}
              values={values}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

/** Phone form row that opens the picker sub-sheet. */
export function SubjectValueButton({
  subjects,
  side,
  label,
  values,
  onClick,
  disabled = false,
  error,
}: {
  subjects: AccessSubjects
  side: "from" | "to"
  label: string
  values: string[]
  onClick: () => void
  disabled?: boolean
  error?: string
}) {
  const { t } = useTranslation()
  const [primary] = values
  const chip = primary ? subjectChip(primary, subjects, side) : null
  return (
    <div className="min-w-0">
      <button
        aria-label={
          chip
            ? t("accessA.picker.trigger", { field: label, value: chip.label })
            : label
        }
        className={cn(
          "flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-[10px] bg-card px-3 py-1.5 text-left shadow-[inset_0_0_0_1px_var(--line-2)] focus-visible:ring-3 focus-visible:ring-brand-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-2",
          error && "shadow-[inset_0_0_0_1.5px_var(--err)]"
        )}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        <SubjectChips
          className="flex-1"
          side={side}
          subjects={subjects}
          values={values}
        />
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 flex-none text-fg-3"
        />
      </button>
      {error ? (
        <p
          aria-live="polite"
          className="mt-1 text-[12.5px] leading-[18px] text-err"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
