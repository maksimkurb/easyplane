import { describe, expect, it } from "vitest";

import {
  latestRevision,
  nextRevisionNumber,
  planRollback,
} from "@easyplane/server";

const records = [
  { revision: 1, config: { noTun: false, hostname: "a" } },
  { revision: 2, config: { noTun: true, hostname: "b" } },
  { revision: 7, config: { noTun: false, hostname: "c" } },
];

describe("config revisions", () => {
  it("allocates max + 1", () => {
    expect(nextRevisionNumber([])).toBe(1);
    expect(nextRevisionNumber(records)).toBe(8);
  });

  it("finds the latest revision regardless of order", () => {
    expect(latestRevision([...records].reverse())?.revision).toBe(7);
    expect(latestRevision([])).toBeNull();
  });

  it("plans an append-only rollback that copies the target content", () => {
    const plan = planRollback(records, 2);
    expect(plan.revision).toBe(8);
    expect(plan.rollbackOfRevision).toBe(2);
    expect(plan.config).toEqual({ noTun: true, hostname: "b" });
    // A copy: mutating the plan must not mutate history.
    (plan.config as { hostname: string }).hostname = "mutated";
    expect(records[1]!.config.hostname).toBe("b");
  });

  it("rejects rollback to a missing revision", () => {
    expect(() => planRollback(records, 42)).toThrow(/does not exist/);
  });

  it("keeps incrementing after a rollback", () => {
    const plan = planRollback(records, 1);
    expect(nextRevisionNumber([...records, { revision: plan.revision, config: plan.config }])).toBe(9);
  });
});
