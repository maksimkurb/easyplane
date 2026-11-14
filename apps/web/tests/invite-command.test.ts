import { describe, expect, it } from "vitest"

import {
  buildEasytierCommand,
  buildInviteUrl,
  normalizeConfigServerBase,
} from "@/lib/invite-command"

describe("invite command builder", () => {
  it("keeps explicit ws/wss/tcp bases", () => {
    expect(normalizeConfigServerBase("wss://vpn.example.com/")).toBe(
      "wss://vpn.example.com"
    )
    expect(normalizeConfigServerBase("ws://127.0.0.1:22023")).toBe(
      "ws://127.0.0.1:22023"
    )
    expect(normalizeConfigServerBase("tcp://vpn.example.com:22020")).toBe(
      "tcp://vpn.example.com:22020"
    )
  })

  it("maps https/http panel origins to wss/ws", () => {
    expect(normalizeConfigServerBase("https://panel.example.com")).toBe(
      "wss://panel.example.com"
    )
    expect(normalizeConfigServerBase("http://localhost:8080")).toBe(
      "ws://localhost:8080"
    )
  })

  it("defaults a bare host to wss", () => {
    expect(normalizeConfigServerBase("vpn.example.com")).toBe(
      "wss://vpn.example.com"
    )
  })

  it("appends the token as the last path segment", () => {
    expect(buildInviteUrl("wss://vpn.example.com", "abc+/=")).toBe(
      "wss://vpn.example.com/abc%2B%2F%3D"
    )
  })

  it("uses the verified easytier-core flags", () => {
    expect(
      buildEasytierCommand({
        base: "wss://vpn.example.com",
        token: "tok",
        hostname: "laptop",
      })
    ).toBe(
      "easytier-core --config-server wss://vpn.example.com/tok --hostname laptop"
    )
    expect(
      buildEasytierCommand({ base: "wss://vpn.example.com", token: "tok" })
    ).toContain("--hostname <hostname>")
  })
})
