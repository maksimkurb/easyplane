import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { OptionSelect } from "@/components/shared/option-select"
import { renderWithProviders } from "./test-utils"

describe("OptionSelect", () => {
  it("disables the trigger and shows the hint when there is nothing to choose", () => {
    renderWithProviders(
      <OptionSelect
        aria-label="Device"
        empty={<span>No connected devices</span>}
        onValueChange={vi.fn()}
        options={[]}
        placeholder="Choose a device"
        value=""
      />
    )

    expect(screen.getByRole("combobox", { name: "Device" })).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent("No connected devices")
    expect(screen.getByRole("combobox", { name: "Device" })).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("status").id
    )
  })

  it("stays enabled without a hint when options exist", () => {
    renderWithProviders(
      <OptionSelect
        aria-label="Device"
        empty={<span>No connected devices</span>}
        onValueChange={vi.fn()}
        options={[{ value: "device-1", label: "laptop" }]}
        placeholder="Choose a device"
        value=""
      />
    )

    expect(screen.getByRole("combobox", { name: "Device" })).toBeEnabled()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("keeps a long label selectable and exposes its full name", async () => {
    const onValueChange = vi.fn()
    const longLabel =
      "a-very-long-hostname-that-keeps-going-beyond-any-reasonable-width"

    renderWithProviders(
      <OptionSelect
        aria-label="Device"
        onValueChange={onValueChange}
        options={[{ value: "long", label: longLabel }]}
        placeholder="Choose a device"
        value=""
      />
    )

    await userEvent.click(screen.getByRole("combobox", { name: "Device" }))
    await userEvent.click(await screen.findByRole("option", { name: longLabel }))

    expect(onValueChange).toHaveBeenCalledWith("long")
  })

  it("ignores the hint when the caller does not pass one", () => {
    renderWithProviders(
      <OptionSelect
        aria-label="Device"
        onValueChange={vi.fn()}
        options={[]}
        placeholder="Choose a device"
        value=""
      />
    )

    expect(screen.getByRole("combobox", { name: "Device" })).toBeDisabled()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })
})
