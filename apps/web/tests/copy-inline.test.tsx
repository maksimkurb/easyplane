import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import "@/i18n"
import { CopyInline } from "@/components/shared/copy-inline"

describe("CopyInline", () => {
  it("includes the visible value in the button's accessible name", () => {
    render(<CopyInline label="Copy virtual IP" value="10.144.144.2" />)
    expect(
      screen.getByRole("button", { name: "Copy virtual IP 10.144.144.2" })
    ).toBeInTheDocument()
  })

  it("keeps a long identifier in the name even when it is truncated", () => {
    const value = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample"
    render(<CopyInline label="Copy public key" value={value} title={value} />)
    expect(
      screen.getByRole("button", { name: `Copy public key ${value}` })
    ).toBeInTheDocument()
  })
})
