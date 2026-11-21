import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import "@/i18n"
import { AccessMatrix } from "@/components/access/access-matrix"
import type { AccessRule } from "@/lib/access-policy"
import { DOCUMENT, SUBJECTS } from "./access-fixtures"

const RULE: AccessRule = {
  name: "",
  enabled: true,
  action: "allow",
  from: ["tag:home"],
  to: ["tag:eu"],
  protocol: "any",
  ports: [],
  sourcePorts: [],
  stateful: true,
}

function renderMatrix(rules: AccessRule[] = [RULE]) {
  return render(
    <AccessMatrix chains={DOCUMENT.chains} rules={rules} subjects={SUBJECTS} />
  )
}

describe("AccessMatrix view", () => {
  it("leads with a sentence per tag and a tag-only matrix by default", async () => {
    const user = userEvent.setup({ document })
    renderMatrix()
    await user.click(screen.getByRole("button", { name: "Who can reach whom" }))

    expect(screen.getByText("home can reach eu")).toBeInTheDocument()
    const table = screen.getByRole("table")
    expect(within(table).queryByText("Admins")).not.toBeInTheDocument()
    expect(
      within(table).getByRole("columnheader", { name: "home" })
    ).toBeInTheDocument()
  })

  it("puts user groups behind their own switch", async () => {
    const user = userEvent.setup({ document })
    renderMatrix()
    await user.click(screen.getByRole("button", { name: "Who can reach whom" }))
    await user.click(screen.getByRole("radio", { name: "User groups" }))

    const table = screen.getByRole("table")
    expect(
      within(table).getByRole("columnheader", { name: "Admins" })
    ).toBeInTheDocument()
    expect(
      within(table).queryByRole("columnheader", { name: "home" })
    ).not.toBeInTheDocument()
  })

  it("explains a partly allowed pair with neutral wording", async () => {
    const user = userEvent.setup({ document })
    renderMatrix([
      RULE,
      {
        ...RULE,
        action: "deny",
        from: ["device:nas-01"],
        to: ["tag:eu"],
      },
    ])
    await user.click(screen.getByRole("button", { name: "Who can reach whom" }))

    expect(screen.getByText("Partly: not for every device")).toBeInTheDocument()
  })
})
