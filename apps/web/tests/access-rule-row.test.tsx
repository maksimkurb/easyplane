import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"

import "@/i18n"
import { RuleRow } from "@/components/access/rule-row"
import { SubjectChips } from "@/components/access/access-chips"
import { SUBJECTS } from "./access-fixtures"
import type { AccessRule } from "@/lib/access-policy"

const RULE: AccessRule = {
  name: "Block SSH to NAS",
  enabled: false,
  action: "deny",
  from: ["*"],
  to: ["device:nas-01"],
  protocol: "tcp",
  ports: ["22"],
  sourcePorts: [],
  stateful: true,
}

function row(overrides?: Partial<ComponentProps<typeof RuleRow>>) {
  return (
    <RuleRow
      busy={false}
      canEdit
      index={0}
      onDelete={vi.fn()}
      onDragStart={vi.fn()}
      onDrop={vi.fn()}
      onMove={vi.fn()}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
      rule={RULE}
      subjects={SUBJECTS}
      {...overrides}
    />
  )
}

describe("RuleRow", () => {
  it("renders the name, sentence, off pill and disabled switch for a disabled rule", () => {
    render(row())
    expect(screen.getByText("Block SSH to NAS")).toBeInTheDocument()
    expect(screen.getByText("Off")).toBeInTheDocument()
    expect(screen.getByText("TCP 22")).toBeInTheDocument()
    expect(screen.getByRole("switch")).not.toBeChecked()
    expect(
      screen.getByRole("button", { name: /Anyone to nas-01 on TCP 22/ })
    ).toBeInTheDocument()
  })

  it("gives a short rows-for-people pill and hides edit controls for read-only roles", () => {
    render(row({ canEdit: false }))
    expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true")
    expect(screen.queryByRole("button", { name: "Remove rule" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Drag to reorder/ })).toBeDisabled()
  })

  it("labels tags and user groups differently", () => {
    render(
      <div>
        <SubjectChips side="from" subjects={SUBJECTS} values={["tag:home"]} />
        <SubjectChips side="from" subjects={SUBJECTS} values={["group:Admins"]} />
      </div>
    )
    expect(screen.getByLabelText("Tag home")).toHaveClass("rounded-[4px]")
    expect(screen.getByLabelText("User group Admins")).toHaveClass("rounded-full")
  })
})
