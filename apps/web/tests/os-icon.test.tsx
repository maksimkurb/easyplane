import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { DeviceIcon } from "@/components/device/device-icon"
import { OsIcon } from "@/components/os-icon/os-icon"

describe("OsIcon", () => {
  it("draws the OpenWrt glyph in currentColor and stays decorative", () => {
    const { container } = render(
      <OsIcon
        className="size-4"
        os={{ type: "linux", distribution: "OpenWrt" }}
      />
    )
    const svg = container.querySelector("svg")
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute("data-os-icon", "openwrt")
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24")
    expect(svg).toHaveAttribute("fill", "currentColor")
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg).not.toHaveAttribute("role")
    expect(svg).toHaveClass("size-4")
  })

  it("exposes an accessible name when it stands alone", () => {
    render(
      <OsIcon
        label="OpenWrt 25.12.5"
        os={{ type: "linux", distribution: "OpenWrt", version: "25.12.5" }}
      />
    )
    const icon = screen.getByRole("img", { name: "OpenWrt 25.12.5" })
    expect(icon).toHaveAttribute("data-os-icon", "openwrt")
    expect(icon.querySelector("title")).toHaveTextContent("OpenWrt 25.12.5")
    expect(icon).not.toHaveAttribute("aria-hidden")
  })

  it("renders the fallback when the OS is unknown", () => {
    render(
      <OsIcon
        fallback={<span>generic</span>}
        os={{ type: "plan9", distribution: "Plan 9" }}
      />
    )
    expect(screen.getByText("generic")).toBeInTheDocument()
    expect(document.querySelector("[data-os-icon]")).toBeNull()
  })

  it("uses a hostname hint only when the OS is empty", () => {
    const { container } = render(<OsIcon os={{}} hostname="router-openwrt" />)
    expect(container.querySelector("[data-os-icon]")).toHaveAttribute(
      "data-os-icon",
      "openwrt"
    )
  })

  it("renders nothing when unknown and no fallback is given", () => {
    const { container } = render(<OsIcon os={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("DeviceIcon", () => {
  it("uses the OS mark instead of the class icon", () => {
    const { container } = render(
      <DeviceIcon os={{ type: "linux", distribution: "Debian GNU/Linux" }} />
    )
    expect(container.querySelector("[data-os-icon]")).toHaveAttribute(
      "data-os-icon",
      "debian"
    )
  })

  it("falls back to generic Linux for an unknown distribution", () => {
    const { container } = render(
      <DeviceIcon
        className="size-4"
        os={{ type: "linux", distribution: "CentOS" }}
      />
    )
    expect(container.querySelector("[data-os-icon]")).toHaveAttribute(
      "data-os-icon",
      "linux"
    )
  })

  it("falls back to the device class for an unknown OS", () => {
    const { container } = render(
      <DeviceIcon
        className="size-4"
        os={{ type: "plan9", distribution: "Plan 9" }}
      />
    )
    const svg = container.querySelector("svg")
    expect(svg).not.toBeNull()
    expect(svg).not.toHaveAttribute("data-os-icon")
    expect(svg).toHaveClass("size-4")
    expect(svg).toHaveAttribute("aria-hidden", "true")
  })
})
