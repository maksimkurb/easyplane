import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"

import "@/i18n"
import { RuleSheet } from "@/components/access/rule-sheet"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { AccessRule } from "@/lib/access-policy"
import { NETWORK_ID, SUBJECTS } from "./access-fixtures"

const RULE: AccessRule = {
  name: "Allow home to VPS",
  enabled: true,
  action: "allow",
  from: ["tag:home"],
  to: ["device:vps-fra"],
  protocol: "tcp",
  ports: ["22"],
  sourcePorts: [],
  stateful: true,
}

function renderSheet(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>
  )
}

function sheet(overrides?: Partial<React.ComponentProps<typeof RuleSheet>>) {
  return (
    <RuleSheet
      busy={false}
      canEdit
      index={0}
      networkId={NETWORK_ID}
      onOpenChange={vi.fn()}
      onSave={vi.fn()}
      open
      rule={RULE}
      subjects={SUBJECTS}
      {...overrides}
    />
  )
}

describe("RuleSheet", () => {
  it("shows a plain-language preview and keeps Save disabled until dirty", async () => {
    renderSheet(sheet())
    expect(
      screen.getByText(
        "Allow devices tagged home to reach device vps-fra on SSH"
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save rule" })).toBeDisabled()
  })

  it("presets fill destination ports, never source ports", async () => {
    const onSave = vi.fn()
    const user = userEvent.setup({ document })
    renderSheet(
      sheet({ onSave, rule: { ...RULE, protocol: "any", ports: [] } })
    )

    const service = screen.getByRole("radiogroup", { name: "Service" })
    await user.click(within(service).getByRole("radio", { name: "Web" }))

    expect(screen.getByTestId("service-summary")).toHaveTextContent(
      "TCP 80, 443"
    )
    expect(screen.queryByLabelText("Source ports")).not.toBeInTheDocument()

    const save = screen.getByRole("button", { name: "Save rule" })
    expect(save).toBeEnabled()
    await user.click(save)
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "tcp",
        ports: ["80", "443"],
        sourcePorts: [],
      })
    )
  })

  it("guards unsaved changes on close and defaults to Cancel", async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup({ document })
    renderSheet(sheet({ onOpenChange }))

    await user.type(screen.getByRole("textbox", { name: "Rule name" }), "!")
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    expect(
      screen.getByRole("heading", { name: "Discard changes?" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(
      screen.queryByRole("heading", { name: "Discard changes?" })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("only shows protocol and ports for a custom service", async () => {
    const user = userEvent.setup({ document })
    renderSheet(sheet())
    expect(
      screen.queryByRole("radiogroup", { name: "Protocol" })
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Destination ports")).not.toBeInTheDocument()

    await user.click(
      within(screen.getByRole("radiogroup", { name: "Service" })).getByRole(
        "radio",
        {
          name: "Custom…",
        }
      )
    )
    expect(
      screen.getByRole("radiogroup", { name: "Protocol" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Destination ports")).toBeInTheDocument()
  })
})
