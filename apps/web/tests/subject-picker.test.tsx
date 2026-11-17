import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import "@/i18n"
import { SubjectPicker, SubjectPickerList } from "@/components/access/subject-picker"
import { SUBJECTS } from "./access-fixtures"

describe("SubjectPicker", () => {
  it("lists labelled sections in order with counts and filters by search", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup({ document })
    render(
      <SubjectPicker
        label="From"
        onChange={onChange}
        side="from"
        subjects={SUBJECTS}
        values={["*"]}
      />
    )

    await user.click(screen.getByRole("button", { name: "From: Anyone" }))
    const panel = screen.getByTestId("subject-picker-panel")
    const text = panel.textContent ?? ""
    const order = [
      "Devices",
      "Tags",
      "User groups",
      "Subnets",
      "Hosts",
      "Custom",
      "Anyone",
    ]
    const positions = order.map((title) => text.indexOf(title))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)

    const search = within(panel).getByRole("searchbox", { name: "Search From" })
    await user.type(search, "nas")
    expect(within(panel).getByRole("option", { name: /nas-01/ })).toBeInTheDocument()
    expect(within(panel).queryByText("Tags")).not.toBeInTheDocument()

    await user.click(within(panel).getByRole("option", { name: /nas-01/ }))
    expect(onChange).toHaveBeenCalledWith(["device:nas-01"])
  })

  it("opens the address tag input for Custom and validates a pasted CIDR", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup({ document })
    render(
      <SubjectPicker
        label="To"
        onChange={onChange}
        side="to"
        subjects={SUBJECTS}
        values={["*"]}
      />
    )
    await user.click(screen.getByRole("button", { name: "To: Anywhere" }))
    await user.click(screen.getByRole("option", { name: /Custom…/ }))
    const input = screen.getByRole("textbox", { name: "To IP addresses or CIDRs" })
    await user.type(input, "192.168.55.0/24{Enter}")
    expect(onChange).toHaveBeenCalledWith(["cidr:192.168.55.0/24"])
  })

  it("searches devices and shows the picker list directly for sheets", async () => {
    const user = userEvent.setup({ document })
    render(
      <SubjectPickerList
        fieldLabel="From"
        onChange={() => undefined}
        side="from"
        subjects={SUBJECTS}
        values={["tag:home"]}
      />
    )
    expect(screen.getByRole("listbox", { name: "From" })).toBeInTheDocument()
    const search = screen.getByRole("searchbox", { name: "Search From" })
    await user.type(search, "vps")
    expect(screen.getByRole("option", { name: /vps-fra/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /nas-01/ })).not.toBeInTheDocument()
  })
})
