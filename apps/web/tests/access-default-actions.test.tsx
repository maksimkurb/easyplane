import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import "@/i18n"
import {
  ChainDefaultsForm,
  DefaultActionsRow,
} from "@/components/access/default-actions"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { AccessChain, AccessChainName } from "@/lib/access-policy"

const CHAINS: Record<AccessChainName, AccessChain> = {
  inbound: { default: "block", enabled: true },
  outbound: { default: "allow", enabled: true },
  forward: { default: "block", enabled: true, name: "LAN forward" },
}

function renderWithTooltips(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe("default actions", () => {
  it("renders one row per chain and reports every field change", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup({ document })
    render(<ChainDefaultsForm chains={CHAINS} onChange={onChange} />)

    const inbound = screen.getByRole("radiogroup", {
      name: "Inbound default action",
    })
    await user.click(within(inbound).getByRole("radio", { name: "Allow" }))
    expect(onChange).toHaveBeenCalledWith("inbound", { default: "allow" })

    await user.click(
      screen.getByRole("switch", { name: "Through this device: Enabled" })
    )
    expect(onChange).toHaveBeenCalledWith("forward", { enabled: false })

    const name = screen.getByRole("textbox", {
      name: "Through this device chain name",
    })
    await user.type(name, "x")
    expect(onChange).toHaveBeenLastCalledWith("forward", {
      name: "LAN forwardx",
    })
  })

  it("collapses into one muted summary with an Edit affordance", async () => {
    const onToggleExpanded = vi.fn()
    const user = userEvent.setup({ document })
    renderWithTooltips(
      <DefaultActionsRow
        chains={CHAINS}
        onChange={vi.fn()}
        onToggleAdvanced={vi.fn()}
        onToggleExpanded={onToggleExpanded}
      />
    )

    expect(
      screen.getByText(
        "Everything else: Inbound blocked · Outbound allowed · Through this device blocked"
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Advanced settings" })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Edit" }))
    expect(onToggleExpanded).toHaveBeenCalled()
  })

  it("edits every direction and reaches advanced settings when expanded", async () => {
    const onChange = vi.fn()
    const onToggleAdvanced = vi.fn()
    const user = userEvent.setup({ document })
    renderWithTooltips(
      <DefaultActionsRow
        advancedExpanded={false}
        chains={CHAINS}
        expanded
        onChange={onChange}
        onToggleAdvanced={onToggleAdvanced}
        onToggleExpanded={vi.fn()}
      />
    )

    for (const name of ["Inbound", "Outbound", "Through this device"]) {
      expect(
        screen.getByRole("radiogroup", { name: `${name} default action` })
      ).toBeInTheDocument()
    }
    expect(
      screen.getByRole("button", {
        name: /Traffic through this device/,
      })
    ).toBeInTheDocument()

    const outbound = screen.getByRole("radiogroup", {
      name: "Outbound default action",
    })
    await user.click(within(outbound).getByRole("radio", { name: "Block" }))
    expect(onChange).toHaveBeenCalledWith("outbound", { default: "block" })

    await user.click(screen.getByRole("button", { name: "Advanced settings" }))
    expect(onToggleAdvanced).toHaveBeenCalled()
  })
})
