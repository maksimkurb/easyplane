import { describe, expect, it } from "vitest"

import { groupConsecutive } from "@/lib/sequence"

describe("groupConsecutive", () => {
  it("collapses consecutive items with the same signature and keeps the count", () => {
    const items = [
      { label: "policy", revision: 20 },
      { label: "policy", revision: 19 },
      { label: "policy", revision: 18 },
      { label: "manual", revision: 17 },
      { label: "policy", revision: 16 },
    ]

    const groups = groupConsecutive(items, (item) => item.label)

    expect(groups.map((group) => group.count)).toEqual([3, 1, 1])
    expect(groups[0].items.map((item) => item.revision)).toEqual([20, 19, 18])
    expect(groups[1].items[0].revision).toBe(17)
    // A repeat after a different entry starts a new group instead of merging.
    expect(groups[2].items[0].revision).toBe(16)
  })

  it("gives every group a unique key even for identical signatures", () => {
    const groups = groupConsecutive(
      [{ kind: "a" }, { kind: "b" }, { kind: "a" }],
      (item) => item.kind
    )
    expect(new Set(groups.map((group) => group.id)).size).toBe(3)
  })

  it("returns nothing for an empty list", () => {
    expect(groupConsecutive([], () => "x")).toEqual([])
  })
})
