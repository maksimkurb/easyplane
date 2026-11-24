import { describe, expect, it } from "vitest"

import { applyAwgParams, randomAwgParams } from "@/lib/awg"

describe("awg", () => {
  it("inserts the junk parameters into [Interface] once", () => {
    const base = "[Interface]\nPrivateKey = k\nAddress = 10.0.0.2/32\n\n[Peer]\nPublicKey = p\n"
    const out = applyAwgParams(applyAwgParams(base, { jc: 5, jmin: 10, jmax: 60 }), {
      jc: 7,
      jmin: 20,
      jmax: 90,
    })
    expect(out.match(/^Jc = /gm)).toHaveLength(1)
    expect(out).toContain("[Interface]\nJc = 7\nJmin = 20\nJmax = 90\nPrivateKey = k")
    expect(out).not.toMatch(/\b(S1|S2|H1)\b/)
  })

  it("keeps parameters in the recommended range", () => {
    for (let index = 0; index < 200; index += 1) {
      const { jc, jmin, jmax } = randomAwgParams()
      expect(jc).toBeGreaterThanOrEqual(4)
      expect(jc).toBeLessThanOrEqual(12)
      expect(jmin).toBeLessThan(jmax)
      expect(jmax).toBeLessThanOrEqual(1280)
    }
  })
})

import { applyFullTunnel } from "@/lib/awg"

describe("applyFullTunnel", () => {
  it("replaces AllowedIPs only", () => {
    const out = applyFullTunnel(
      "[Interface]\nAddress = 10.0.0.2/32\n\n[Peer]\nAllowedIPs = 10.0.0.0/24, 192.168.1.0/24\nPersistentKeepalive = 25\n"
    )
    expect(out).toContain("AllowedIPs = 0.0.0.0/0\n")
    expect(out).toContain("Address = 10.0.0.2/32")
  })
})

describe("endpoint host", () => {
  const conf = "[Peer]\nEndpoint = 1.2.3.4:11013\n"
  it("reads and replaces the host, keeping the port", async () => {
    const { endpointHost, applyEndpointHost } = await import("@/lib/awg")
    expect(endpointHost(conf)).toBe("1.2.3.4")
    expect(applyEndpointHost(conf, "vpn.example.com")).toContain("Endpoint = vpn.example.com:11013")
    expect(applyEndpointHost(conf, "::1")).toContain("Endpoint = [::1]:11013")
    expect(applyEndpointHost(conf, " ")).toBe(conf)
  })
})
