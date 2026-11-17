import type { TFunction } from "i18next"

import type {
  GetPolicySubjects200,
  GetPolicySubjects200DevicesItem,
  GetPolicySubjects200HostsItem,
  GetPolicySubjects200SubnetsItem,
  GetPolicySubjects200TagsItem,
  GetPolicySubjects200UserGroupsItem,
} from "@/api/generated/model"

/**
 * The policy document version 2 as the Access editor works with it, plus the
 * client-side validation the tag inputs need. The server stays the authority:
 * these helpers keep the form usable and reject values before a round trip.
 */

export const ACCESS_PROTOCOLS = ["any", "tcp", "udp", "icmp", "icmpv6"] as const
export type AccessProtocol = (typeof ACCESS_PROTOCOLS)[number]

export const ACCESS_MODES = ["open", "rules", "json"] as const
export type AccessMode = (typeof ACCESS_MODES)[number]

export const ACCESS_CHAINS = ["inbound", "outbound", "forward"] as const
export type AccessChainName = (typeof ACCESS_CHAINS)[number]

export type AccessChain = {
  default: "allow" | "block"
  enabled: boolean
  name?: string
}

export type AccessRule = {
  name?: string
  enabled: boolean
  action: "allow" | "deny"
  from: string[]
  to: string[]
  protocol: AccessProtocol
  ports: string[]
  sourcePorts: string[]
  stateful: boolean
  rateLimit?: number
  burst?: number
}

export type AccessDocument = {
  version: 2
  mode: AccessMode
  subnets: Record<string, { cidr: string; via?: string }>
  tags: Record<string, string[]>
  userGroups: Record<string, { source: "manual" | "oidc"; members: string[] }>
  tagOwners: Record<string, string[]>
  hosts: Record<string, string>
  chains: Record<AccessChainName, AccessChain>
  options: { strictTags: boolean; strictGroups: boolean }
  rules: AccessRule[]
}

export const DEFAULT_CHAINS: Record<AccessChainName, AccessChain> = {
  inbound: { default: "block", enabled: true },
  outbound: { default: "allow", enabled: true },
  forward: { default: "block", enabled: true },
}

export function emptyAccessDocument(mode: AccessMode = "open"): AccessDocument {
  return {
    version: 2,
    mode,
    subnets: {},
    tags: {},
    userGroups: {},
    tagOwners: {},
    hosts: {},
    chains: {
      inbound: { ...DEFAULT_CHAINS.inbound },
      outbound: { ...DEFAULT_CHAINS.outbound },
      forward: { ...DEFAULT_CHAINS.forward },
    },
    options: { strictTags: false, strictGroups: false },
    rules: [],
  }
}

/** A non-blocking first policy so enabling Rules cannot cut the network off. */
export function defaultAccessRule(): AccessRule {
  return {
    enabled: true,
    action: "allow",
    from: ["*"],
    to: ["*"],
    protocol: "any",
    ports: [],
    sourcePorts: [],
    stateful: true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  return undefined
}

function normalizeChain(value: unknown, fallback: AccessChain): AccessChain {
  if (!isRecord(value)) return { ...fallback }
  return {
    default: value.default === "allow" ? "allow" : "block",
    enabled: value.enabled !== false,
    ...(typeof value.name === "string" && value.name ? { name: value.name } : {}),
  }
}

function normalizeRule(value: unknown): AccessRule | null {
  if (!isRecord(value)) return null
  const protocol = ACCESS_PROTOCOLS.includes(value.protocol as AccessProtocol)
    ? (value.protocol as AccessProtocol)
    : "any"
  const action = value.action === "deny" || value.action === "accept" ? (value.action === "deny" ? "deny" : "allow") : "allow"
  return {
    ...(typeof value.name === "string" && value.name.trim() ? { name: value.name } : {}),
    enabled: value.enabled !== false,
    action,
    from: strings(value.from),
    to: strings(value.to),
    protocol,
    ports: strings(value.ports),
    sourcePorts: strings(value.sourcePorts),
    stateful: value.stateful !== false,
    ...(numberOrUndefined(value.rateLimit) !== undefined
      ? { rateLimit: numberOrUndefined(value.rateLimit) }
      : {}),
    ...(numberOrUndefined(value.burst) !== undefined
      ? { burst: numberOrUndefined(value.burst) }
      : {}),
  }
}

/** Normalizes any stored v2 document (or null) into the editor's shape. */
export function normalizeAccessDocument(raw: unknown): AccessDocument {
  const source = isRecord(raw) ? raw : {}
  const mode = ACCESS_MODES.includes(source.mode as AccessMode)
    ? (source.mode as AccessMode)
    : "rules"
  const chains = isRecord(source.chains) ? source.chains : {}
  const subnets: AccessDocument["subnets"] = {}
  if (isRecord(source.subnets)) {
    for (const [name, value] of Object.entries(source.subnets)) {
      if (!isRecord(value) || typeof value.cidr !== "string") continue
      subnets[name] = {
        cidr: value.cidr,
        ...(typeof value.via === "string" ? { via: value.via } : {}),
      }
    }
  }
  const tags: AccessDocument["tags"] = {}
  if (isRecord(source.tags)) {
    for (const [name, devices] of Object.entries(source.tags)) {
      tags[name] = strings(devices)
    }
  }
  const userGroups: AccessDocument["userGroups"] = {}
  if (isRecord(source.userGroups)) {
    for (const [name, value] of Object.entries(source.userGroups)) {
      if (!isRecord(value)) continue
      userGroups[name] = {
        source: value.source === "oidc" ? "oidc" : "manual",
        members: strings(value.members),
      }
    }
  }
  const hosts: Record<string, string> = {}
  if (isRecord(source.hosts)) {
    for (const [name, value] of Object.entries(source.hosts)) {
      if (typeof value === "string") hosts[name] = value
    }
  }
  const tagOwners: Record<string, string[]> = {}
  if (isRecord(source.tagOwners)) {
    for (const [name, value] of Object.entries(source.tagOwners)) {
      tagOwners[name] = strings(value)
    }
  }
  const options = isRecord(source.options) ? source.options : {}
  const rules = Array.isArray(source.rules)
    ? source.rules
        .map(normalizeRule)
        .filter((rule): rule is AccessRule => rule !== null)
    : []
  return {
    version: 2,
    mode,
    subnets,
    tags,
    userGroups,
    tagOwners,
    hosts,
    chains: {
      inbound: normalizeChain(chains.inbound, DEFAULT_CHAINS.inbound),
      outbound: normalizeChain(chains.outbound, DEFAULT_CHAINS.outbound),
      forward: normalizeChain(chains.forward, DEFAULT_CHAINS.forward),
    },
    options: {
      strictTags: options.strictTags === true,
      strictGroups: options.strictGroups === true,
    },
    rules,
  }
}

export type AccessSubjects = GetPolicySubjects200
export type AccessTag = GetPolicySubjects200TagsItem
export type AccessUserGroup = GetPolicySubjects200UserGroupsItem
export type AccessSubnet = GetPolicySubjects200SubnetsItem
export type AccessDevice = GetPolicySubjects200DevicesItem
export type AccessHost = GetPolicySubjects200HostsItem

/* -------------------------------------------------------------- validation */

export type PortCheck =
  | { ok: true; range: boolean }
  | { ok: false; error: "port" | "range" }

/** One port or an inclusive low-high range, 1-65535. */
export function checkPort(raw: string): PortCheck {
  const value = raw.trim()
  const single = /^(\d{1,5})$/.exec(value)
  if (single) {
    const port = Number(single[1])
    return port >= 1 && port <= 65535
      ? { ok: true, range: false }
      : { ok: false, error: "port" }
  }
  const range = /^(\d{1,5})-(\d{1,5})$/.exec(value)
  if (!range) return { ok: false, error: "port" }
  const from = Number(range[1])
  const to = Number(range[2])
  if (from < 1 || from > 65535 || to < 1 || to > 65535) {
    return { ok: false, error: "port" }
  }
  if (from >= to) return { ok: false, error: "range" }
  return { ok: true, range: true }
}

export type AddressCheck =
  | { ok: true; cidr: boolean }
  | { ok: false; error: "address" | "ipv4-prefix" | "ipv6-prefix" }

function isIpv4(value: string): boolean {
  const parts = value.split(".")
  if (parts.length !== 4) return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const octet = Number(part)
    return octet >= 0 && octet <= 255
  })
}

function isIpv6(value: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return false
  const halves = value.split("::")
  if (halves.length > 2) return false
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const groups = [...left, ...right]
  if (groups.some((group) => group === "")) return false
  let units = 0
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!
    if (group.includes(".")) {
      // An embedded IPv4 address is only valid as the last group.
      if (index !== groups.length - 1 || !isIpv4(group)) return false
      units += 2
    } else if (/^[0-9a-fA-F]{1,4}$/.test(group)) {
      units += 1
    } else {
      return false
    }
  }
  return halves.length === 2 ? units < 8 : units === 8
}

/** IPv4/IPv6 address with an optional prefix. */
export function checkAddress(raw: string): AddressCheck {
  const value = raw.trim()
  if (!value) return { ok: false, error: "address" }
  const slash = value.lastIndexOf("/")
  const address = slash >= 0 ? value.slice(0, slash) : value
  const prefixText = slash >= 0 ? value.slice(slash + 1) : null
  if (prefixText !== null && !/^\d{1,3}$/.test(prefixText)) {
    return { ok: false, error: "address" }
  }
  if (isIpv4(address)) {
    if (prefixText !== null) {
      const prefix = Number(prefixText)
      if (prefix > 32) return { ok: false, error: "ipv4-prefix" }
    }
    return { ok: true, cidr: prefixText !== null }
  }
  if (address.includes(":") && isIpv6(address)) {
    if (prefixText !== null) {
      const prefix = Number(prefixText)
      if (prefix > 128) return { ok: false, error: "ipv6-prefix" }
    }
    return { ok: true, cidr: prefixText !== null }
  }
  return { ok: false, error: "address" }
}

/** Splits a typed or pasted list the way the tag input commits values. */
export function splitValues(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

export function mergeValues(current: readonly string[], added: readonly string[]): string[] {
  const next = [...current]
  for (const value of added) {
    if (!next.includes(value)) next.push(value)
  }
  return next
}

export function ruleHasInvalidPorts(rule: AccessRule): boolean {
  return [...rule.ports, ...rule.sourcePorts].some((port) => !checkPort(port).ok)
}

export function ruleHasInvalidAddresses(rule: AccessRule): boolean {
  return [...rule.from, ...rule.to].some((subject) => {
    if (!subject.startsWith("cidr:")) return false
    return !checkAddress(subject.slice("cidr:".length)).ok
  })
}

export function ruleIsSavable(rule: AccessRule): boolean {
  return (
    rule.from.length > 0 &&
    rule.to.length > 0 &&
    !ruleHasInvalidPorts(rule) &&
    !ruleHasInvalidAddresses(rule) &&
    (rule.rateLimit === undefined || rule.burst !== undefined)
  )
}

/* ---------------------------------------------------------------- subjects */

export type SubjectKind =
  | "any"
  | "device"
  | "tag"
  | "group"
  | "subnet"
  | "host"
  | "cidr"
  | "unknown"

export type SubjectChip = {
  subject: string
  kind: SubjectKind
  label: string
  detail?: string
  mono?: boolean
}

export function stripSubjectKind(subject: string): { kind: SubjectKind; name: string } {
  if (subject === "*" || subject === "anyone" || subject === "anywhere" || subject === "autogroup:all") {
    return { kind: "any", name: subject }
  }
  for (const kind of ["tag", "group", "subnet", "host", "cidr", "device"] as const) {
    if (subject.startsWith(`${kind}:`)) {
      return { kind, name: subject.slice(kind.length + 1) }
    }
  }
  return { kind: "device", name: subject }
}

export function findDevice(subjects: AccessSubjects, name: string): AccessDevice | undefined {
  return subjects.devices.find(
    (device) => device.name.toLowerCase() === name.toLowerCase()
  )
}

export function findTag(subjects: AccessSubjects, name: string): AccessTag | undefined {
  return subjects.tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())
}

export function findGroup(
  subjects: AccessSubjects,
  name: string
): AccessUserGroup | undefined {
  return subjects.userGroups.find(
    (group) => group.name.toLowerCase() === name.toLowerCase()
  )
}

export function findSubnet(
  subjects: AccessSubjects,
  name: string
): AccessSubnet | undefined {
  return subjects.subnets.find(
    (subnet) => subnet.name.toLowerCase() === name.toLowerCase()
  )
}

export function subjectChip(
  subject: string,
  subjects: AccessSubjects,
  side: "from" | "to"
): SubjectChip {
  const { kind, name } = stripSubjectKind(subject)
  if (kind === "any") {
    return {
      subject,
      kind: "any",
      label: side === "from" ? "Anyone" : "Anywhere",
    }
  }
  if (kind === "tag") {
    const tag = findTag(subjects, name)
    return { subject, kind: "tag", label: tag?.name ?? name }
  }
  if (kind === "group") {
    const group = findGroup(subjects, name)
    return { subject, kind: "group", label: group?.name ?? name }
  }
  if (kind === "subnet") {
    const subnet = findSubnet(subjects, name)
    return {
      subject,
      kind: "subnet",
      label: subnet?.name ?? name,
      ...(subnet ? { detail: subnet.cidr } : {}),
      mono: Boolean(subnet),
    }
  }
  if (kind === "host") {
    const host = subjects.hosts.find((entry) => entry.alias === name)
    return {
      subject,
      kind: "host",
      label: name,
      ...(host ? { detail: host.value } : {}),
      mono: true,
    }
  }
  if (kind === "cidr") {
    return { subject, kind: "cidr", label: name, mono: true }
  }
  if (kind === "device") {
    const device = findDevice(subjects, name)
    return { subject, kind: "device", label: device?.name ?? name }
  }
  return { subject, kind: "unknown", label: name }
}

export function deviceSubjects(subjects: AccessSubjects, subject: string): AccessDevice[] {
  const { kind, name } = stripSubjectKind(subject)
  if (kind === "any") return subjects.devices
  if (kind === "device") {
    const device = findDevice(subjects, name)
    return device ? [device] : []
  }
  if (kind === "tag") return findTag(subjects, name)?.devices.map((device) => {
    const found = subjects.devices.find((entry) => entry.id === device.id)
    return found ?? { id: device.id, name: device.name, hostname: device.hostname, virtualIpv4: null, state: "approved", tags: [] }
  }) ?? []
  if (kind === "group") {
    return findGroup(subjects, name)?.devices.map((device) => {
      const found = subjects.devices.find((entry) => entry.id === device.id)
      return found ?? { id: device.id, name: device.name, hostname: device.name, virtualIpv4: null, state: "approved", tags: [] }
    }) ?? []
  }
  if (kind === "subnet") {
    const subnet = findSubnet(subjects, name)
    const device = subnet?.viaDeviceId
      ? subjects.devices.find((entry) => entry.id === subnet.viaDeviceId)
      : undefined
    return device ? [device] : []
  }
  return []
}

/** The first device a compiled rule can be read from. */
export function compiledRuleDevice(
  rule: AccessRule,
  subjects: AccessSubjects
): AccessDevice | undefined {
  for (const subject of rule.to) {
    const [device] = deviceSubjects(subjects, subject)
    if (device?.state === "approved") return device
  }
  for (const subject of rule.from) {
    const [device] = deviceSubjects(subjects, subject)
    if (device?.state === "approved") return device
  }
  return undefined
}

/** Named rule or `rule-<n>`, matching the compiler's rule names. */
export function compiledRulePrefix(rule: AccessRule, index: number): string {
  const name = rule.name?.trim() ? rule.name.trim() : `rule-${index + 1}`
  return `${name}-`
}

/* ------------------------------------------------------------- rule summary */

export function protocolLabel(protocol: string): string {
  if (protocol === "icmpv6") return "ICMPv6"
  if (protocol === "icmp") return "ICMP"
  if (protocol === "tcp") return "TCP"
  if (protocol === "udp") return "UDP"
  return ""
}

/** Compact ports pill text: `tcp 22, 443 +2`, `any port`, `ICMP`. */
export function portsSummary(rule: AccessRule, t: TFunction): string {
  if (rule.protocol === "any") return t("accessA.ports.any")
  if (rule.protocol === "icmp" || rule.protocol === "icmpv6") {
    return protocolLabel(rule.protocol)
  }
  const valid = rule.ports.filter((port) => checkPort(port).ok)
  if (valid.length === 0) {
    return t("accessA.ports.anyFor", { protocol: protocolLabel(rule.protocol) })
  }
  const shown = valid.slice(0, 3).join(", ")
  const overflow =
    valid.length > 3 ? ` ${t("accessA.ports.more", { count: valid.length - 3 })}` : ""
  return `${protocolLabel(rule.protocol)} ${shown}${overflow}`
}
