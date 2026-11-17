import { describe, expect, it } from "vitest"

import {
  checkAddress,
  checkPort,
  defaultAccessRule,
  normalizeAccessDocument,
  portsSummary,
  ruleIsSavable,
  splitValues,
} from "@/lib/access-policy"
import type { TFunction } from "i18next"

const t = ((key: string, options?: Record<string, unknown>) => {
  if (key === "accessA.ports.any") return "any port"
  if (key === "accessA.ports.anyFor") return `${options?.protocol}, any port`
  if (key === "accessA.ports.more") return `+${options?.count}`
  return key
}) as TFunction

describe("ports validation", () => {
  it("accepts single ports and ranges and rejects the gaps", () => {
    expect(checkPort("22")).toEqual({ ok: true, range: false })
    expect(checkPort("65535")).toEqual({ ok: true, range: false })
    expect(checkPort("8000-8100")).toEqual({ ok: true, range: true })
    expect(checkPort("0")).toEqual({ ok: false, error: "port" })
    expect(checkPort("65536")).toEqual({ ok: false, error: "port" })
    expect(checkPort("22-")).toEqual({ ok: false, error: "port" })
    expect(checkPort("9000-8000")).toEqual({ ok: false, error: "range" })
    expect(checkPort("80-80")).toEqual({ ok: false, error: "range" })
    expect(checkPort("http")).toEqual({ ok: false, error: "port" })
  })

  it("summarizes the pill with an overflow counter", () => {
    const rule = {
      ...defaultAccessRule(),
      protocol: "tcp" as const,
      ports: ["80", "443", "8080", "9090"],
    }
    expect(portsSummary(rule, t)).toBe("TCP 80, 443, 8080 +1")
    expect(portsSummary({ ...rule, ports: [] }, t)).toBe("TCP, any port")
    expect(portsSummary({ ...rule, protocol: "any" }, t)).toBe("any port")
    expect(portsSummary({ ...rule, protocol: "icmpv6" }, t)).toBe("ICMPv6")
  })

  it("blocks saving when a port or the burst value is invalid", () => {
    const base = defaultAccessRule()
    expect(ruleIsSavable(base)).toBe(true)
    expect(ruleIsSavable({ ...base, ports: ["70000"] })).toBe(false)
    expect(ruleIsSavable({ ...base, rateLimit: 100 })).toBe(false)
    expect(ruleIsSavable({ ...base, rateLimit: 100, burst: 20 })).toBe(true)
  })
})

describe("address validation", () => {
  it("accepts IPv4, IPv6 and CIDR with a bounded prefix", () => {
    expect(checkAddress("192.168.55.16")).toEqual({ ok: true, cidr: false })
    expect(checkAddress("192.168.55.0/24")).toEqual({ ok: true, cidr: true })
    expect(checkAddress("2001:db8::10")).toEqual({ ok: true, cidr: false })
    expect(checkAddress("2001:db8::/32")).toEqual({ ok: true, cidr: true })
    expect(checkAddress("::ffff:192.0.2.1")).toEqual({ ok: true, cidr: false })
  })

  it("rejects malformed addresses and prefixes", () => {
    expect(checkAddress("192.168.55.300")).toEqual({ ok: false, error: "address" })
    expect(checkAddress("192.168.55.0/33")).toEqual({ ok: false, error: "ipv4-prefix" })
    expect(checkAddress("2001:db8::/129")).toEqual({ ok: false, error: "ipv6-prefix" })
    expect(checkAddress("nope")).toEqual({ ok: false, error: "address" })
  })
})

describe("policy normalization", () => {
  it("defaults missing rule fields and keeps chain defaults", () => {
    const document = normalizeAccessDocument({
      rules: [{ action: "allow", from: ["*"], to: ["tag:home"] }],
    })
    expect(document.rules[0]).toMatchObject({
      enabled: true,
      stateful: true,
      protocol: "any",
      ports: [],
      sourcePorts: [],
    })
    expect(document.chains.inbound).toEqual({ default: "block", enabled: true })
    expect(document.chains.outbound).toEqual({ default: "allow", enabled: true })
  })

  it("splits a pasted list on commas and whitespace", () => {
    expect(splitValues("22, 443\n8000-8100  53")).toEqual([
      "22",
      "443",
      "8000-8100",
      "53",
    ])
  })
})
