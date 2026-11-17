import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import "@/i18n"
import { TagInput } from "@/components/access/tag-input"
import { checkPort } from "@/lib/access-policy"

function validate(value: string): string | null {
  const result = checkPort(value)
  if (result.ok) return null
  return result.error === "range" ? "Range must go from low to high" : "Port must be 1-65535"
}

describe("TagInput", () => {
  it("turns typed, entered and pasted values into pills and merges duplicates", async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <TagInput
        label="Destination ports"
        onChange={onChange}
        placeholder="Add port"
        validate={validate}
        values={[]}
      />
    )
    const input = screen.getByRole("textbox", { name: "Destination ports" })
    const user = userEvent.setup({ document })

    await user.type(input, "22,")
    expect(onChange).toHaveBeenLastCalledWith(["22"])

    rerender(
      <TagInput
        label="Destination ports"
        onChange={onChange}
        placeholder="Add port"
        validate={validate}
        values={["22"]}
      />
    )
    await user.type(screen.getByRole("textbox", { name: "Destination ports" }), "443{Enter}")
    expect(onChange).toHaveBeenLastCalledWith(["22", "443"])
  })

  it("splits a paste, removes the last pill with Backspace on an empty input and merges duplicates", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup({ document })
    const { rerender } = render(
      <TagInput
        label="Destination ports"
        onChange={onChange}
        validate={validate}
        values={[]}
      />
    )

    const input = screen.getByRole("textbox", { name: "Destination ports" })
    fireEvent.paste(input, {
      clipboardData: { getData: () => "80, 443 8000-8100" },
    })
    expect(onChange).toHaveBeenLastCalledWith(["80", "443", "8000-8100"])

    rerender(
      <TagInput
        label="Destination ports"
        onChange={onChange}
        validate={validate}
        values={["80", "443", "8000-8100"]}
      />
    )
    const empty = screen.getByRole("textbox", { name: "Destination ports" })
    await user.type(empty, "{Backspace}")
    expect(onChange).toHaveBeenLastCalledWith(["80", "443"])

    rerender(
      <TagInput
        label="Destination ports"
        onChange={onChange}
        validate={validate}
        values={["22"]}
      />
    )
    await user.type(screen.getByRole("textbox", { name: "Destination ports" }), "22{Enter}")
    expect(onChange).toHaveBeenLastCalledWith(["22"])
  })

  it("marks an invalid pill, dashes ranges and shows one error line", () => {
    render(
      <TagInput
        label="Destination ports"
        onChange={() => undefined}
        validate={validate}
        isRange={(value) => {
          const result = checkPort(value)
          return result.ok && result.range
        }}
        values={["70000", "8000-8100"]}
      />
    )
    expect(screen.getByText("70000")).toBeInTheDocument()
    expect(screen.getByText("8000-8100").parentElement).toHaveClass("outline-dashed")
    expect(screen.getByRole("status")).toHaveTextContent("Port must be 1-65535")
    expect(screen.getByRole("status").textContent?.match(/Port must/g)).toHaveLength(1)
    expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(2)
  })
})
