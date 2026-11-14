import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import "@/i18n"
import { DeviceStatusBadges } from "@/components/device-status"

describe("DeviceStatusBadges", () => {
  it("renders the three independent dimensions", () => {
    render(<DeviceStatusBadges online="online" state="approved" sync="in-sync" />)
    expect(screen.getByText("Approved")).toBeInTheDocument()
    expect(screen.getByText("Online")).toBeInTheDocument()
    expect(screen.getByText("In sync")).toBeInTheDocument()
  })

  it("renders pending devices as no-config", () => {
    render(
      <DeviceStatusBadges online="online" state="pending" sync="not-applicable" />
    )
    expect(screen.getByText("Pending")).toBeInTheDocument()
    expect(screen.getByText("No config")).toBeInTheDocument()
  })

  it("renders blocked devices as offline", () => {
    render(
      <DeviceStatusBadges online="offline" state="blocked" sync="not-applicable" />
    )
    expect(screen.getByText("Blocked")).toBeInTheDocument()
    expect(screen.getByText("Offline")).toBeInTheDocument()
  })

  it("renders errors and stale config", () => {
    render(<DeviceStatusBadges online="online" state="approved" sync="error" />)
    expect(screen.getByText("Error")).toBeInTheDocument()
  })
})
