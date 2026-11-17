import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import "@/i18n"
import { AccessModeSwitch } from "@/components/access/access-mode-switch"
import type { AccessMode } from "@/lib/access-policy"

function Harness({ onChange }: { onChange?: (mode: AccessMode) => void }) {
  const [mode, setMode] = useState<AccessMode>("open")
  return (
    <AccessModeSwitch
      onChange={(next) => {
        setMode(next)
        onChange?.(next)
      }}
      value={mode}
    />
  )
}

describe("AccessModeSwitch", () => {
  it("is a 36px radio group that reports the chosen mode", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup({ document })
    render(<Harness onChange={onChange} />)
    const group = screen.getByRole("radiogroup", { name: "Access mode" })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Open" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(group).toHaveClass("[&>button]:h-9")

    await user.click(screen.getByRole("radio", { name: "Rules" }))
    expect(onChange).toHaveBeenCalledWith("rules")
    expect(screen.getByRole("radio", { name: "Rules" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(screen.getByRole("radio", { name: "Open" })).toHaveAttribute(
      "aria-checked",
      "false"
    )
  })

  it("disables every option for read-only roles", () => {
    render(<AccessModeSwitch disabled onChange={() => undefined} value="rules" />)
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled()
    }
  })
})
