import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import "@/i18n"
import {
  ChainDefaultsForm,
  DefaultActionsFooter,
  DefaultActionsSheet,
} from "@/components/access/default-actions"
import type { AccessChain, AccessChainName } from "@/lib/access-policy"

const CHAINS: Record<AccessChainName, AccessChain> = {
  inbound: { default: "block", enabled: true },
  outbound: { default: "allow", enabled: true },
  forward: { default: "block", enabled: true, name: "LAN forward" },
}

describe("default actions", () => {
  it("renders one row per chain and reports every field change", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup({ document })
    render(<ChainDefaultsForm chains={CHAINS} onChange={onChange} />)

    const inbound = screen.getByRole("radiogroup", { name: "Inbound default action" })
    await user.click(within(inbound).getByRole("radio", { name: "Allow" }))
    expect(onChange).toHaveBeenCalledWith("inbound", { default: "allow" })

    await user.click(screen.getByRole("switch", { name: "Forward: Enabled" }))
    expect(onChange).toHaveBeenCalledWith("forward", { enabled: false })

    const name = screen.getByRole("textbox", { name: "Forward chain name" })
    await user.type(name, "x")
    expect(onChange).toHaveBeenLastCalledWith("forward", { name: "LAN forwardx" })
  })

  it("shows the per-chain defaults in the footer and opens the editor", async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup({ document })
    render(
      <DefaultActionsFooter
        busy={false}
        canEdit
        chains={CHAINS}
        expanded={false}
        onOpen={onOpen}
      />
    )
    expect(screen.getByText("Inbound")).toBeInTheDocument()
    expect(screen.getAllByText("Block", { selector: "b" }).length).toBeGreaterThan(0)
    await user.click(screen.getByRole("button", { name: "Edit default actions" }))
    expect(onOpen).toHaveBeenCalled()
  })

  it("applies the sheet draft only when Done is pressed", async () => {
    const onSave = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup({ document })
    render(
      <DefaultActionsSheet
        busy={false}
        canEdit
        chains={CHAINS}
        onOpenChange={onOpenChange}
        onSave={onSave}
        open
      />
    )
    const dialog = screen.getByRole("dialog")
    const inbound = within(dialog).getByRole("radiogroup", {
      name: "Inbound default action",
    })
    await user.click(within(inbound).getByRole("radio", { name: "Allow" }))
    expect(onSave).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole("button", { name: "Done" }))
    expect(onSave).toHaveBeenCalledWith({
      ...CHAINS,
      inbound: { ...CHAINS.inbound, default: "allow" },
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
