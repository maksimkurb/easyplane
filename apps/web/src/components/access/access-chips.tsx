import type { ReactNode } from "react"
import { Fragment } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import {
  GlobeIcon,
  MonitorIcon,
  NetworkIcon,
  ServerIcon,
  SquareTerminalIcon,
  TagIcon,
  UsersIcon,
} from "lucide-react"

import { WireguardIcon } from "@/components/device/wireguard-badge"

import type { AccessSubjects, SubjectChip } from "@/lib/access-policy"
import { findSubnet, stripSubjectKind, subjectChip } from "@/lib/access-policy"
import {
  prettySubnetName,
  subjectVisibleText,
} from "@/components/access/access-rule-summary"
import { cn } from "@/lib/utils"

// No `min-w-0`: a chip must move to the next wrapped line as a whole instead of
// being squeezed until its label breaks in the middle (CIDRs, IPv6, ports).
const baseChip =
  "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-[7px] px-2 py-0.5 text-[13px] leading-[18px]"

// Quiet inline counterpart of a chip: same colour cues, no ring or shadow, so a
// rule row still reads as a sentence. Used in the collapsed rule row.
const baseToken =
  "inline-flex max-w-full flex-none items-center gap-1 rounded-[4px] px-1 align-baseline text-[12.5px] leading-[17px]"

export function AllowDenyPill({
  action,
  className,
}: {
  action: "allow" | "deny"
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-[52px] flex-none items-center justify-center rounded-[7px] px-2 text-[12.5px] leading-4 font-semibold",
        action === "allow" ? "bg-ok-soft text-ok" : "bg-err-soft text-err",
        className
      )}
    >
      {action === "allow" ? t("accessA.rules.allow") : t("accessA.rules.deny")}
    </span>
  )
}

function iconForKind(kind: SubjectChip["kind"]): ReactNode {
  switch (kind) {
    case "tag":
      return <TagIcon aria-hidden="true" className="size-3.5 flex-none" />
    case "group":
      return <UsersIcon aria-hidden="true" className="size-3.5 flex-none" />
    case "subnet":
      return <NetworkIcon aria-hidden="true" className="size-3.5 flex-none" />
    case "host":
      return <ServerIcon aria-hidden="true" className="size-3.5 flex-none" />
    case "cidr":
    case "unknown":
      return (
        <SquareTerminalIcon aria-hidden="true" className="size-3.5 flex-none" />
      )
    case "any":
      return <GlobeIcon aria-hidden="true" className="size-3.5 flex-none" />
    case "device":
    default:
      return <MonitorIcon aria-hidden="true" className="size-3.5 flex-none" />
  }
}

function chipAriaLabel(chip: SubjectChip, t: TFunction): string {
  switch (chip.kind) {
    case "tag":
      return t("accessA.picker.tagChip", { name: chip.label })
    case "group":
      return t("accessA.picker.groupChip", { name: chip.label })
    case "device":
      return t("accessA.picker.deviceChip", { name: chip.label })
    case "subnet":
      return t("accessA.picker.subnetChip", { name: chip.label })
    case "host":
      return t("accessA.picker.hostChip", { name: chip.label })
    case "any":
      return t("accessA.picker.anyChip", { name: chip.label })
    case "cidr":
      return t("accessA.picker.customChip")
    default:
      return chip.label
  }
}

/**
 * One subject inside a rule sentence. Tags are squared and blue-grey, user
 * groups are pills in indigo: the two never read as the same thing.
 */
export function SubjectChipView({
  chip,
  className,
}: {
  chip: SubjectChip
  className?: string
}) {
  const { t } = useTranslation()
  const ariaLabel = chipAriaLabel(chip, t)
  const isAddress = chip.kind === "cidr" || chip.mono === true
  const detail = chip.detail
  const detailIsCode = Boolean(detail) && !/\s/.test(detail!)
  return (
    <span
      aria-label={ariaLabel}
      className={cn(
        baseChip,
        chip.kind === "tag" &&
          "rounded-[4px] bg-[var(--tag-bg)] text-[var(--tag-fg)] ring-1 ring-[var(--tag-line)]",
        chip.kind === "group" &&
          "rounded-full bg-[var(--ug-bg)] text-[var(--ug-fg)]",
        (chip.kind === "device" ||
          chip.kind === "subnet" ||
          chip.kind === "host" ||
          chip.kind === "cidr" ||
          chip.kind === "unknown" ||
          chip.kind === "any") &&
          "bg-surface-2 ring-1 ring-line",
        className
      )}
    >
      {iconForKind(chip.kind)}
      <span
        className={cn(
          "min-w-0",
          isAddress
            ? "font-mono text-[12.5px] whitespace-nowrap"
            : "[overflow-wrap:anywhere]"
        )}
      >
        {chip.label}
      </span>
      {detail ? (
        <>
          {" "}
          <span
            className={cn(
              "min-w-0 text-[12px] text-fg-2",
              detailIsCode
                ? "font-mono whitespace-nowrap"
                : "[overflow-wrap:anywhere]"
            )}
          >
            {detail}
          </span>
        </>
      ) : null}
    </span>
  )
}

/** Plain device name; used inside tag cards, not in rule sentences. */
export function PlainDeviceChip({
  name,
  className,
  wireguard = false,
}: {
  name: string
  className?: string
  /** The subject is an ordinary WireGuard client served by a hub portal. */
  wireguard?: boolean
}) {
  return (
    <span
      className={cn(baseChip, "bg-card ring-1 ring-line", className)}
      title={wireguard ? `${name} · WireGuard` : name}
    >
      {wireguard ? (
        <WireguardIcon className="size-3.5 flex-none text-fg-3" />
      ) : (
        <MonitorIcon
          aria-hidden="true"
          className="size-3.5 flex-none text-fg-3"
        />
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
      {wireguard ? (
        <span className="flex-none text-[10px] font-medium text-fg-3">
          WireGuard
        </span>
      ) : null}
    </span>
  )
}

export function TagChip({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <span
      aria-label={t("accessA.picker.tagChip", { name })}
      className={cn(
        baseChip,
        "rounded-[4px] bg-[var(--tag-bg)] text-[var(--tag-fg)] ring-1 ring-[var(--tag-line)]",
        className
      )}
    >
      <TagIcon aria-hidden="true" className="size-3.5 flex-none" />
      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
        {name}
      </span>
    </span>
  )
}

export function GroupChip({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <span
      aria-label={t("accessA.picker.groupChip", { name })}
      className={cn(
        baseChip,
        "rounded-full bg-[var(--ug-bg)] text-[var(--ug-fg)]",
        className
      )}
    >
      <UsersIcon aria-hidden="true" className="size-3.5 flex-none" />
      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
        {name}
      </span>
    </span>
  )
}

/**
 * One subject in the collapsed row: a subtler version of `SubjectChipView`
 * without the ring. Long details (a host's IP, a subnet's CIDR) stay in the
 * native tooltip instead of eating the line.
 */
export function SubjectTokenView({
  chip,
  title,
  className,
}: {
  chip: SubjectChip
  title?: string
  className?: string
}) {
  const { t } = useTranslation()
  const ariaLabel = chipAriaLabel(chip, t)
  const isAddress = chip.kind === "cidr" || chip.mono === true
  return (
    <span
      aria-label={title ? `${ariaLabel} · ${title}` : ariaLabel}
      className={cn(
        baseToken,
        chip.kind === "tag" &&
          "bg-[var(--tag-bg)] text-[var(--tag-fg)]",
        chip.kind === "group" &&
          "rounded-full bg-[var(--ug-bg)] text-[var(--ug-fg)]",
        chip.kind !== "tag" &&
          chip.kind !== "group" &&
          "bg-surface-2 text-fg-2",
        className
      )}
      data-kind={chip.kind}
      title={title}
    >
      {iconForKind(chip.kind)}
      <span
        className={cn(
          "min-w-0",
          isAddress
            ? "font-mono text-[12px] whitespace-nowrap"
            : "truncate whitespace-nowrap"
        )}
      >
        {chip.label}
      </span>
    </span>
  )
}

/** Label and tooltip for one subject, with host/subnet details kept hidden. */
function tokenContent(
  subject: string,
  subjects: AccessSubjects,
  side: "from" | "to",
  t: TFunction
): { chip: SubjectChip; title?: string } {
  const chip = subjectChip(subject, subjects, side)
  const base = {
    ...chip,
    label:
      chip.kind === "any"
        ? side === "from"
          ? t("accessA.picker.anyFrom")
          : t("accessA.picker.anyTo")
        : chip.label,
  }
  if (chip.kind === "host") {
    return { chip: base, ...(chip.detail ? { title: chip.detail } : {}) }
  }
  if (chip.kind === "subnet") {
    const subnet = findSubnet(subjects, stripSubjectKind(subject).name)
    const pretty = prettySubnetName(
      chip.label,
      subnet?.cidr,
      subnet?.viaHostname
    )
    const via =
      pretty.auto && pretty.via
        ? t("accessA.accordion.via", { device: pretty.via })
        : undefined
    const title = [chip.detail, via].filter(Boolean).join(" · ")
    return {
      chip: { ...base, label: pretty.label },
      ...(title ? { title } : {}),
    }
  }
  return { chip: base }
}

/**
 * The source or destination half of the row sentence. Shows at most `max`
 * subjects and collapses the rest into `+N more`, whose tooltip lists them.
 */
export function SubjectTokenList({
  subjects,
  values,
  side,
  max = 3,
  className,
}: {
  subjects: AccessSubjects
  values: string[]
  side: "from" | "to"
  max?: number
  className?: string
}) {
  const { t } = useTranslation()
  const visible = values.slice(0, Math.max(0, max))
  const hidden = values.slice(visible.length)
  return (
    <span className={cn("inline align-baseline", className)}>
      {visible.map((value, index) => {
        const { chip, title } = tokenContent(value, subjects, side, t)
        return (
          <Fragment key={value}>
            {index > 0 ? ", " : null}
            <SubjectTokenView chip={chip} title={title} />
          </Fragment>
        )
      })}
      {hidden.length > 0 ? (
        <>
          {" "}
          <span
            className="inline-flex rounded-[4px] px-1 align-baseline text-[12px] leading-[17px] font-medium text-fg-3"
            title={hidden
              .map((subject) => subjectVisibleText(subject, subjects, side, t))
              .join(", ")}
          >
            {t("accessA.rules.moreSubjects", { count: hidden.length })}
          </span>
        </>
      ) : null}
    </span>
  )
}

/** Renders the current selection of a rule side. */
export function SubjectChips({
  subjects,
  values,
  side,
  className,
}: {
  subjects: AccessSubjects
  values: string[]
  side: "from" | "to"
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <span
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
    >
      {values.map((value, index) => {
        const chip = subjectChip(value, subjects, side)
        if (chip.kind === "any") {
          return (
            <Fragment key={value}>
              {index > 0 ? " " : null}
              <SubjectChipView
                chip={{
                  ...chip,
                  label:
                    side === "from"
                      ? t("accessA.picker.anyFrom")
                      : t("accessA.picker.anyTo"),
                }}
              />
            </Fragment>
          )
        }
        if (chip.kind !== "subnet") {
          return (
            <Fragment key={value}>
              {index > 0 ? " " : null}
              <SubjectChipView chip={chip} />
            </Fragment>
          )
        }
        const subnet = findSubnet(subjects, stripSubjectKind(value).name)
        const pretty = prettySubnetName(
          chip.label,
          subnet?.cidr,
          subnet?.viaHostname
        )
        return (
          <Fragment key={value}>
            {index > 0 ? " " : null}
            <SubjectChipView
              chip={
                pretty.auto
                  ? {
                      ...chip,
                      label: pretty.label,
                      ...(pretty.via
                        ? {
                            detail: t("accessA.accordion.via", {
                              device: pretty.via,
                            }),
                          }
                        : { detail: undefined }),
                    }
                  : chip
              }
            />
          </Fragment>
        )
      })}
    </span>
  )
}
