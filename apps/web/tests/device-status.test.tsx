import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import "@/i18n"
import { DeviceStatusBadges } from "@/components/device-status"
import { DeviceStatusCell } from "@/components/device/device-status-cell"
import { deriveDeviceStatus, type DeviceStatusInput } from "@/lib/device-status"

function status(overrides: Partial<DeviceStatusInput> = {}) {
  return deriveDeviceStatus({
    state: "approved",
    online: "online",
    sync: "in-sync",
    desiredRevision: 3,
    appliedRevision: 3,
    lastPushError: null,
    ...overrides,
  })
}

describe("deriveDeviceStatus", () => {
  it("is online when the device is connected and in sync", () => {
    const result = status()
    expect(result.kind).toBe("online")
    expect(result.connected).toBe(true)
    expect(result.needsAttention).toBe(false)
    expect(result.pendingRevision).toBeNull()
  })

  it("puts blocked above every other dimension", () => {
    const result = status({
      state: "blocked",
      online: "online",
      sync: "error",
      lastPushError: "refused",
      desiredRevision: 12,
      appliedRevision: 7,
    })
    expect(result.kind).toBe("blocked")
    expect(result.connected).toBe(false)
  })

  it("puts waiting for approval above offline", () => {
    const result = status({
      state: "pending",
      online: "offline",
      sync: "not-applicable",
      desiredRevision: null,
      appliedRevision: null,
    })
    expect(result.kind).toBe("pending")
    expect(result.needsAttention).toBe(true)
  })

  it("reports offline without a config complaint and keeps the queued revision", () => {
    const result = status({
      online: "offline",
      sync: "error",
      lastPushError: "connection refused",
      desiredRevision: 12,
      appliedRevision: 7,
    })
    expect(result.kind).toBe("offline")
    expect(result.pendingRevision).toBe(12)
    expect(result.needsAttention).toBe(false)
  })

  it("reports a failed push only while the device is online", () => {
    const result = status({
      sync: "error",
      lastPushError: "listener tcp://0.0.0.0:11010 is in use",
      desiredRevision: 24,
      appliedRevision: 22,
    })
    expect(result.kind).toBe("push-failed")
    expect(result.reason).toBe("listener tcp://0.0.0.0:11010 is in use")
    expect(result.needsAttention).toBe(true)
  })

  it("reports updating while an online device still runs an older revision", () => {
    const result = status({ desiredRevision: 12, appliedRevision: 7 })
    expect(result.kind).toBe("updating")
    expect(result.pendingRevision).toBe(12)
    expect(result.needsAttention).toBe(true)
  })

  it("treats a stale sync as updating", () => {
    expect(status({ sync: "stale" }).kind).toBe("updating")
  })

  it("keeps a reported error above stale", () => {
    expect(status({ sync: "stale", lastPushError: "boom" }).kind).toBe(
      "push-failed"
    )
  })
})

describe("DeviceStatusBadges", () => {
  it("renders exactly one derived badge", () => {
    render(
      <DeviceStatusBadges online="online" state="approved" sync="in-sync" />
    )
    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(screen.queryByText("Approved")).not.toBeInTheDocument()
    expect(screen.queryByText("In sync")).not.toBeInTheDocument()
  })

  it("does not blame an offline device for its config", () => {
    render(
      <DeviceStatusBadges
        appliedRevision={7}
        desiredRevision={12}
        lastPushError="connection refused"
        online="offline"
        state="approved"
        sync="error"
      />
    )
    expect(screen.getByText("Offline")).toBeInTheDocument()
    expect(screen.queryByText("Push failed")).not.toBeInTheDocument()
    expect(screen.queryByText("Config not applied")).not.toBeInTheDocument()
  })

  it("renders blocked as a struck-through label", () => {
    const { container } = render(
      <DeviceStatusBadges
        online="offline"
        state="blocked"
        sync="not-applicable"
      />
    )
    expect(screen.getByText("Blocked")).toBeInTheDocument()
    expect(container.querySelector(".line-through")).not.toBeNull()
  })

  it("shows the push failure with the reason in the tooltip", () => {
    render(
      <DeviceStatusBadges
        lastPushError="listener in use"
        online="online"
        state="approved"
        sync="error"
      />
    )
    const badge = screen.getByText("Push failed").closest("[title]")
    expect(badge?.getAttribute("title")).toContain("listener in use")
  })
})

describe("DeviceStatusCell", () => {
  it("shows the last-seen time for an offline device and the queued revision as a hint", () => {
    const lastSeenAt = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const { container } = render(
      <DeviceStatusCell
        device={{
          appliedRevision: 7,
          desiredRevision: 12,
          lastSeenAt,
          online: "offline",
          state: "approved",
          sync: "stale",
        }}
        showHint
      />
    )
    expect(screen.getByText("2 days ago")).toBeInTheDocument()
    expect(
      screen.getByText(
        "It will update to revision 12 when it comes back online."
      )
    ).toBeInTheDocument()
    expect(container.firstElementChild?.getAttribute("title")).toContain(
      "Last seen"
    )
  })
})
