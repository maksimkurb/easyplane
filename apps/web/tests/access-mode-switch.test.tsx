import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import "@/i18n"
import { AccessModeSwitch } from "@/components/access/access-mode-switch"
import type { EnforcementMode } from "@/components/access/access-mode-switch"
import type { AccessMode } from "@/lib/access-policy"

function Harness({ onChange }: { onChange?: (mode: EnforcementMode) => void }) {
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
  it("is a radio group with a plain-language consequence per mode", () => {
    render(<Harness />)
    const group = screen.getByRole("radiogroup", { name: "Access mode" })
    expect(group).toBeInTheDocument()
    expect(
      screen.getByRole("radio", { name: /Allow all traffic between devices/ })
    ).toHaveAttribute("aria-checked", "true")
    expect(
      screen.getByRole("radio", { name: /Only allow what rules permit/ })
    ).toHaveTextContent("Everything else is blocked")
  })

  it("confirms a connectivity change with Cancel as the default", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup({ document })
    render(<Harness onChange={onChange} />)

    await user.click(
      screen.getByRole("radio", { name: /Only allow what rules permit/ })
    )
    const dialog = screen.getByRole("dialog")
    expect(
      within(dialog).getByRole("heading", {
        name: "Only allow what rules permit?",
      })
    ).toBeInTheDocument()
    const cancel = within(dialog).getByRole("button", { name: "Cancel" })
    expect(cancel).toHaveFocus()

    await user.click(cancel)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("radio", { name: /Only allow what rules permit/ })
    )
    await user.click(screen.getByRole("button", { name: "Turn on rules" }))
    expect(onChange).toHaveBeenCalledWith("rules")
    expect(
      screen.getByRole("radio", { name: /Only allow what rules permit/ })
    ).toHaveAttribute("aria-checked", "true")
  })

  it("does not ask twice when giving up filtering", async () => {
    render(<AccessModeSwitchHarness initial="rules" />)
    const user = userEvent.setup({ document })
    await user.click(
      screen.getByRole("radio", { name: /Allow all traffic between devices/ })
    )
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Allow all traffic" }))
    expect(
      screen.getByRole("radio", { name: /Allow all traffic between devices/ })
    ).toHaveAttribute("aria-checked", "true")
  })

  it("disables every option for read-only roles", () => {
    render(
      <AccessModeSwitch disabled onChange={() => undefined} value="rules" />
    )
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled()
    }
  })
})

function AccessModeSwitchHarness({ initial }: { initial: AccessMode }) {
  const [mode, setMode] = useState<AccessMode>(initial)
  return <AccessModeSwitch onChange={setMode} value={mode} />
}
