import { describe, expect, it } from "vitest"

import {
  EMPTY_POLICY_DOCUMENT,
  splitList,
  toPolicyDocument,
  toStatementRows,
} from "@/lib/policy-document"

describe("policy document <-> table form", () => {
  it("splits comma and newline separated subjects", () => {
    expect(splitList("tag:web, tag:db\n group:ops")).toEqual([
      "tag:web",
      "tag:db",
      "group:ops",
    ])
    expect(splitList("  ")).toEqual([])
  })

  it("round-trips a document through the form rows", () => {
    const document = {
      ...EMPTY_POLICY_DOCUMENT,
      acls: [
        {
          name: "web-db",
          action: "accept" as const,
          src: ["tag:web", "group:ops"],
          dst: ["tag:db:5432"],
          proto: "tcp" as const,
          rateLimit: 100,
          burst: 50,
          stateful: true,
        },
      ],
    }
    const rows = toStatementRows(document)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: "web-db",
      action: "accept",
      src: "tag:web, group:ops",
      dst: "tag:db:5432",
      proto: "tcp",
      rateLimit: "100",
      burst: "50",
      stateful: true,
    })
    expect(toPolicyDocument(rows, document)).toEqual(document)
  })

  it("drops incomplete rows and keeps the rest of the document", () => {
    const base = { groups: { "group:ops": ["bob@example.com"] }, acls: [] }
    const document = toPolicyDocument(
      [
        {
          name: "",
          action: "deny",
          src: "tag:web",
          dst: "",
          proto: "any",
          rateLimit: "",
          burst: "",
          stateful: false,
        },
      ],
      base,
    )
    expect(document.groups).toEqual(base.groups)
    expect(document.acls).toEqual([])
  })
})
