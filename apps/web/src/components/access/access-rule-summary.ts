import type { TFunction } from "i18next"

import type {
  AccessChain,
  AccessChainName,
  AccessProtocol,
  AccessRule,
  AccessSubjects,
} from "@/lib/access-policy"
import {
  checkPort,
  findDevice,
  findGroup,
  findSubnet,
  findTag,
  portsSummary,
  stripSubjectKind,
  subjectChip,
} from "@/lib/access-policy"

/* ---------------------------------------------------------------- validation */

export type RuleValidationErrors = {
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

/** Local, immediate messages; the server stays the final authority. */
export function localRuleErrors(
  rule: AccessRule,
  t: TFunction
): RuleValidationErrors {
  const errors: RuleValidationErrors = {}
  if (rule.from.length === 0) errors.from = t("accessA.rules.errorFrom")
  if (rule.to.length === 0) errors.to = t("accessA.rules.errorTo")
  const badPort = [...rule.ports, ...rule.sourcePorts].find(
    (port) => !checkPort(port).ok
  )
  if (badPort) {
    errors.ports = t("accessA.rules.errorPorts", { port: badPort })
  }
  if (rule.rateLimit !== undefined && rule.burst === undefined) {
    errors.burst = t("accessA.advanced.burstRequired")
  }
  return errors
}

/* ---------------------------------------------------------------- services */

export type ServiceId =
  "any" | "ssh" | "web" | "rdp" | "smb" | "dns" | "ping" | "custom"

export type ServicePreset = {
  id: Exclude<ServiceId, "any" | "custom">
  protocol: AccessProtocol
  ports: string[]
}

export const SERVICE_PRESETS: ServicePreset[] = [
  { id: "ssh", protocol: "tcp", ports: ["22"] },
  { id: "web", protocol: "tcp", ports: ["80", "443"] },
  { id: "rdp", protocol: "tcp", ports: ["3389"] },
  { id: "smb", protocol: "tcp", ports: ["445"] },
  { id: "dns", protocol: "udp", ports: ["53"] },
  { id: "ping", protocol: "icmp", ports: [] },
]

export const SERVICE_ORDER: ServiceId[] = [
  "any",
  "ssh",
  "web",
  "rdp",
  "smb",
  "dns",
  "ping",
  "custom",
]

function samePorts(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const normalise = (ports: string[]) => [...ports].sort().join(",")
  return normalise(left) === normalise(right)
}

/** The preset a rule currently reads as; anything else is Custom. */
export function serviceForRule(rule: AccessRule): ServiceId {
  if (rule.protocol === "any") return "any"
  if (rule.protocol === "icmp" || rule.protocol === "icmpv6") return "ping"
  const preset = SERVICE_PRESETS.find(
    (entry) =>
      entry.protocol === rule.protocol && samePorts(entry.ports, rule.ports)
  )
  return preset?.id ?? "custom"
}

/**
 * Applies a service preset. Presets always write the *destination* ports;
 * source ports live under Advanced and are cleared so a preset is a complete
 * statement, not a half-edited one.
 */
export function applyService(
  rule: AccessRule,
  id: ServiceId
): Partial<AccessRule> {
  if (id === "any") {
    return { protocol: "any", ports: [], sourcePorts: [] }
  }
  if (id === "ping") {
    return { protocol: "icmp", ports: [], sourcePorts: [] }
  }
  if (id === "custom") {
    if (serviceForRule(rule) === "custom") return {}
    return { protocol: "tcp", ports: [] }
  }
  const preset = SERVICE_PRESETS.find((entry) => entry.id === id)
  if (!preset) return {}
  return {
    protocol: preset.protocol,
    ports: [...preset.ports],
    sourcePorts: [],
  }
}

export function serviceSummary(rule: AccessRule, t: TFunction): string {
  const service = serviceForRule(rule)
  if (service === "any") return t("accessA.preview.serviceAny")
  if (service === "ping") return t("accessA.preview.serviceIcmp")
  if (service !== "custom") {
    return t(`accessA.ports.preset.${service}`)
  }
  const ports =
    rule.ports.length > 0 ? rule.ports.join(", ") : t("accessA.ports.any")
  return t("accessA.preview.servicePorts", {
    protocol:
      rule.protocol === "any"
        ? t("accessA.ports.protocolAny")
        : rule.protocol.toUpperCase(),
    ports,
  })
}

/* ----------------------------------------------------------- subnet names */

/**
 * Imported/auto subnet names encode the route: `owrt-h1-192-168-40-0-23` is
 * 192.168.40.0/23 behind owrt-h1. Nobody should read that as a name, so the
 * UI shows the address and the exit device instead.
 */
export function parseAutoSubnetName(
  name: string
): { cidr: string; via: string } | null {
  const match =
    /^(.+?)-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,2})$/.exec(name)
  if (!match) return null
  const octets = match.slice(2, 6).map(Number)
  const prefix = Number(match[6])
  if (octets.some((octet) => octet > 255) || prefix > 32) return null
  return { cidr: `${octets.join(".")}/${prefix}`, via: match[1]! }
}

export type PrettySubnet = {
  /** Human name, or the CIDR when the stored name is machine-made. */
  label: string
  via?: string
  /** True when the stored name was replaced by an address. */
  auto: boolean
}

export function prettySubnetName(
  name: string,
  cidr?: string,
  via?: string
): PrettySubnet {
  const parsed = parseAutoSubnetName(name)
  if (!parsed) {
    return { label: name, ...(via ? { via } : {}), auto: false }
  }
  return {
    label: cidr ?? parsed.cidr,
    via: via ?? parsed.via,
    auto: true,
  }
}

/* ---------------------------------------------------------------- sentences */

function phrase(
  subject: string,
  subjects: AccessSubjects,
  side: "from" | "to",
  t: TFunction
): string {
  const { kind, name } = stripSubjectKind(subject)
  if (kind === "any") {
    return side === "from"
      ? t("accessA.preview.anyone")
      : t("accessA.preview.anywhere")
  }
  if (kind === "tag") return t("accessA.preview.tag", { name })
  if (kind === "group") return t("accessA.preview.group", { name })
  if (kind === "subnet") {
    const subnet = subjects.subnets.find((entry) => entry.name === name)
    const pretty = prettySubnetName(
      subnet?.name ?? name,
      subnet?.cidr,
      subnet?.viaHostname
    )
    if (pretty.auto) {
      return pretty.via
        ? t("accessA.preview.subnetVia", {
            cidr: pretty.label,
            device: pretty.via,
          })
        : t("accessA.preview.subnetCidr", { cidr: pretty.label })
    }
    return t("accessA.preview.subnet", { name: pretty.label })
  }
  if (kind === "host") return t("accessA.preview.host", { name })
  if (kind === "cidr") return t("accessA.preview.cidr", { value: name })
  if (kind === "device") {
    const device = findDevice(subjects, name)
    return t("accessA.preview.device", { name: device?.name ?? name })
  }
  return t("accessA.preview.unknown", { value: name })
}

/** Plain-language sentence used by the editor preview and the order hint. */
export function rulePreview(
  rule: AccessRule,
  subjects: AccessSubjects,
  t: TFunction
): string {
  const from = rule.from
    .map((subject) => phrase(subject, subjects, "from", t))
    .join(", ")
  const to = rule.to
    .map((subject) => phrase(subject, subjects, "to", t))
    .join(", ")
  return t("accessA.preview.sentence", {
    action:
      rule.action === "allow"
        ? t("accessA.rules.allow")
        : t("accessA.rules.deny"),
    from: from || t("accessA.preview.anyone"),
    to: to || t("accessA.preview.anywhere"),
    service: serviceSummary(rule, t),
  })
}

/** `Allow home → vps-fra`, used when the optional name is left empty. */
export function suggestedRuleName(
  rule: AccessRule,
  subjects: AccessSubjects,
  t: TFunction
): string {
  const first = (side: "from" | "to") => {
    const subject = (side === "from" ? rule.from : rule.to)[0]
    if (!subject) {
      return side === "from"
        ? t("accessA.preview.anyone")
        : t("accessA.preview.anywhere")
    }
    return subjectDisplayLabel(subject, subjects, side, t)
  }
  return t("accessA.rules.suggestion", {
    action:
      rule.action === "allow"
        ? t("accessA.rules.allow")
        : t("accessA.rules.deny"),
    from: first("from"),
    to: first("to"),
  })
}

/**
 * Stored names can arrive from imports as compiler-ish text
 * (`Allow KZ -> router-max`, `allow tag:kz -> cidr:…`). Those are data, not a
 * name a person wrote, and must not become the row heading.
 */
export function isGeneratedRuleName(name: string): boolean {
  const value = name.trim()
  if (!value) return false
  if (/^(allow|deny|block|drop)\b/i.test(value) && /->|→/.test(value)) {
    return true
  }
  return /\b(?:tag|group|subnet|device|cidr|host):/i.test(value)
}

/** Chip-sized label with the same humanising the sentences get. */
export function subjectDisplayLabel(
  subject: string,
  subjects: AccessSubjects,
  side: "from" | "to",
  t: TFunction
): string {
  const chip = subjectChip(subject, subjects, side)
  if (chip.kind === "any") {
    return side === "from"
      ? t("accessA.picker.anyFrom")
      : t("accessA.picker.anyTo")
  }
  if (chip.kind !== "subnet") return chip.label
  const subnet = subjects.subnets.find(
    (entry) => entry.name === stripSubjectKind(subject).name
  )
  const pretty = prettySubnetName(chip.label, subnet?.cidr, subnet?.viaHostname)
  if (!pretty.auto) return pretty.label
  return pretty.via
    ? t("accessA.picker.subnetVia", {
        cidr: pretty.label,
        device: pretty.via,
      })
    : pretty.label
}

/**
 * The text a subject chip renders, exactly as SubjectChips/SubjectChipView
 * draw it. Used to build accessible names that contain their visible text.
 */
export function subjectVisibleText(
  subject: string,
  subjects: AccessSubjects,
  side: "from" | "to",
  t: TFunction
): string {
  const chip = subjectChip(subject, subjects, side)
  if (chip.kind === "any") {
    return side === "from"
      ? t("accessA.picker.anyFrom")
      : t("accessA.picker.anyTo")
  }
  if (chip.kind === "subnet") {
    const subnet = findSubnet(subjects, stripSubjectKind(subject).name)
    const pretty = prettySubnetName(
      chip.label,
      subnet?.cidr,
      subnet?.viaHostname
    )
    if (pretty.auto) {
      return [
        pretty.label,
        pretty.via ? t("accessA.accordion.via", { device: pretty.via }) : null,
      ]
        .filter(Boolean)
        .join(" ")
    }
    return [chip.label, subnet?.cidr ?? chip.detail].filter(Boolean).join(" ")
  }
  return [chip.label, chip.detail].filter(Boolean).join(" ")
}

/** One-line, localised summary used as the row heading when no name is set. */
export function ruleDisplayTitle(
  rule: AccessRule,
  subjects: AccessSubjects,
  t: TFunction
): string {
  const name = rule.name?.trim()
  if (name && !isGeneratedRuleName(name)) return name
  const labels = (side: "from" | "to") =>
    (side === "from" ? rule.from : rule.to)
      .map((subject) => subjectDisplayLabel(subject, subjects, side, t))
      .join(", ")
  return t("accessA.rules.summaryTitle", {
    action:
      rule.action === "allow"
        ? t("accessA.rules.allow")
        : t("accessA.rules.deny"),
    from: labels("from") || t("accessA.preview.anyone"),
    to: labels("to") || t("accessA.preview.anywhere"),
    service: portsSummary(rule, t),
  })
}

/** Human diff line for the policy history. */
export function ruleChangeSentence(
  rule: AccessRule,
  subjects: AccessSubjects,
  t: TFunction
): string {
  const from = rule.from
    .map((subject) => phrase(subject, subjects, "from", t))
    .join(", ")
  const to = rule.to
    .map((subject) => phrase(subject, subjects, "to", t))
    .join(", ")
  const sentence = t("accessA.history.ruleSentence", {
    action:
      rule.action === "allow"
        ? t("accessA.rules.allow")
        : t("accessA.rules.deny"),
    from: from || t("accessA.preview.anyone"),
    to: to || t("accessA.preview.anywhere"),
    service: serviceSummary(rule, t),
  })
  return rule.enabled === false
    ? t("accessA.history.ruleDisabled", { sentence })
    : sentence
}

/** Chain names are an implementation detail; show the direction instead. */
export function friendlyChainName(chain: string, t: TFunction): string {
  const match = /(inbound|outbound|forward)$/.exec(chain)
  if (!match) return chain
  return t(`accessA.defaults.${match[1] as AccessChainName}`)
}

/* --------------------------------------------------------- compiled rule ids */

/**
 * The compiler names rules `<name>-<chain>` (or `rule-<n>-<chain>`). This finds
 * the document rule a test decision came from so the list can highlight it.
 */
export function ruleIndexForCompiledName(
  rules: AccessRule[],
  compiledName: string | null | undefined
): number | null {
  if (!compiledName) return null
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]!
    const name = rule.name?.trim() ? rule.name.trim() : `rule-${index + 1}`
    if (compiledName.startsWith(`${name}-`)) return index
  }
  return null
}

/* -------------------------------------------------------------- who → whom */

export type MatrixEntity = {
  key: string
  subject: string
  label: string
  kind: "tag" | "group"
  deviceIds: Set<string>
}

export type MatrixCellStatus = "allow" | "deny" | "partial" | "empty" | "self"

export type MatrixCell = {
  status: MatrixCellStatus
  rules: string[]
  usesDefault: boolean
}

export type AccessMatrix = {
  rows: MatrixEntity[]
  cols: MatrixEntity[]
  cells: MatrixCell[][]
}

function subjectMatchesDevice(
  subject: string,
  deviceId: string,
  subjects: AccessSubjects
): boolean {
  const { kind, name } = stripSubjectKind(subject)
  if (kind === "any") return true
  if (kind === "device") return findDevice(subjects, name)?.id === deviceId
  if (kind === "tag") {
    return (
      findTag(subjects, name)?.devices.some(
        (device) => device.id === deviceId
      ) ?? false
    )
  }
  if (kind === "group") {
    return (
      findGroup(subjects, name)?.devices.some(
        (device) => device.id === deviceId
      ) ?? false
    )
  }
  return false
}

function ruleLabel(rule: AccessRule, index: number): string {
  return rule.name?.trim() ? rule.name.trim() : `#${index + 1}`
}

/**
 * A compact, read-only summary: rows are tag/user-group sources, columns are
 * tag/user-group destinations. Every concrete device pair is evaluated with the
 * same first-match-wins order as the compiler; a cell is "partial" when some
 * pairs inside it are allowed and some are denied.
 */
export function computeAccessMatrix(
  subjects: AccessSubjects,
  rules: AccessRule[],
  chains: Record<AccessChainName, AccessChain>
): AccessMatrix {
  const entities: MatrixEntity[] = [
    ...subjects.tags.map((tag) => ({
      key: `tag:${tag.name}`,
      subject: `tag:${tag.name}`,
      label: tag.name,
      kind: "tag" as const,
      deviceIds: new Set(tag.devices.map((device) => device.id)),
    })),
    ...subjects.userGroups.map((group) => ({
      key: `group:${group.name}`,
      subject: `group:${group.name}`,
      label: group.name,
      kind: "group" as const,
      deviceIds: new Set(group.devices.map((device) => device.id)),
    })),
  ]
  const enabled = rules
    .map((rule, index) => ({ rule, index }))
    .filter((entry) => entry.rule.enabled !== false)
  const defaultAllowed =
    chains.inbound.default === "allow" && chains.outbound.default === "allow"

  const cells = entities.map((source) =>
    entities.map((destination): MatrixCell => {
      let allowed = 0
      let denied = 0
      let usesDefault = false
      const deciding = new Set<string>()
      for (const srcId of source.deviceIds) {
        for (const dstId of destination.deviceIds) {
          if (srcId === dstId) continue
          const match = enabled.find(
            ({ rule }) =>
              rule.from.some((subject) =>
                subjectMatchesDevice(subject, srcId, subjects)
              ) &&
              rule.to.some((subject) =>
                subjectMatchesDevice(subject, dstId, subjects)
              )
          )
          if (!match) {
            usesDefault = true
            if (defaultAllowed) allowed += 1
            else denied += 1
            continue
          }
          deciding.add(ruleLabel(match.rule, match.index))
          if (match.rule.action === "allow") allowed += 1
          else denied += 1
        }
      }
      if (allowed + denied === 0) {
        return { status: "self", rules: [], usesDefault: false }
      }
      const status: MatrixCellStatus =
        denied === 0 ? "allow" : allowed === 0 ? "deny" : "partial"
      return { status, rules: [...deciding], usesDefault }
    })
  )

  return { rows: entities, cols: entities, cells }
}
