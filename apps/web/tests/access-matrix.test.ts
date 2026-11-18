import { describe, expect, it } from "vitest"

import { computeAccessMatrix } from "@/components/access/access-rule-summary"
import { DOCUMENT, SUBJECTS } from "./access-fixtures"

describe("who can reach whom matrix", () => {
  it("evaluates tag rows and columns with first-match-wins", () => {
    const matrix = computeAccessMatrix(
      SUBJECTS,
      [
        {
          name: "home to everyone",
          enabled: true,
          action: "allow",
          from: ["tag:home"],
          to: ["*"],
          protocol: "any",
          ports: [],
          sourcePorts: [],
          stateful: true,
        },
        {
          name: "block eu to home",
          enabled: true,
          action: "deny",
          from: ["tag:eu"],
          to: ["tag:home"],
          protocol: "any",
          ports: [],
          sourcePorts: [],
          stateful: true,
        },
      ],
      DOCUMENT.chains
    )

    const home = matrix.rows.findIndex((row) => row.label === "home")
    const eu = matrix.rows.findIndex((row) => row.label === "eu")
    expect(home).toBeGreaterThanOrEqual(0)
    expect(eu).toBeGreaterThanOrEqual(0)

    expect(matrix.cells[home]![eu]!.status).toBe("allow")
    expect(matrix.cells[eu]![home]!.status).toBe("deny")
    expect(matrix.cells[eu]![home]!.rules).toContain("block eu to home")
  })

  it("uses the chain defaults when no rule matches", () => {
    const matrix = computeAccessMatrix(SUBJECTS, [], DOCUMENT.chains)
    const home = matrix.rows.findIndex((row) => row.label === "home")
    const eu = matrix.rows.findIndex((row) => row.label === "eu")
    // inbound defaults to block in the fixture chains.
    expect(matrix.cells[home]![eu]!.status).toBe("deny")
    expect(matrix.cells[home]![eu]!.usesDefault).toBe(true)
  })
})
