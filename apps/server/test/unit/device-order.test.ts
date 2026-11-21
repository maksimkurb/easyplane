import { describe, expect, it } from "vitest";

import { compareDevicesForList } from "@easyplane/server";

/**
 * The device list is ordered by creation time (SQL `orderBy`) with a pure
 * comparator as the contract. `lastSeenAt` changes on every heartbeat, so it
 * must never influence the order.
 */

type DeviceRow = Parameters<typeof compareDevicesForList>[0];

function device(
  input: Pick<DeviceRow, "id" | "hostname" | "createdAt"> &
    Partial<Pick<DeviceRow, "lastSeenAt">>,
): DeviceRow {
  return input as unknown as DeviceRow;
}

describe("compareDevicesForList", () => {
  it("orders by creation time even when newer devices were seen more recently", () => {
    const older = device({
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      hostname: "zeta",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      lastSeenAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = device({
      id: "aaaaaaaa-0000-0000-0000-000000000002",
      hostname: "alpha",
      createdAt: new Date("2026-01-02T00:00:00Z"),
      lastSeenAt: new Date("2026-03-01T00:00:00Z"),
    });
    expect([newer, older].sort(compareDevicesForList)).toEqual([older, newer]);
  });

  it("ignores lastSeenAt changes on every heartbeat", () => {
    const same = (lastSeenAt: Date) =>
      [
        device({
          id: "b",
          hostname: "router-b",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          lastSeenAt,
        }),
        device({
          id: "a",
          hostname: "router-a",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          lastSeenAt,
        }),
      ].sort(compareDevicesForList);

    const first = same(new Date("2026-01-01T00:00:01Z")).map((entry) => entry.id);
    const second = same(new Date("2026-01-02T00:00:00Z")).map((entry) => entry.id);
    expect(second).toEqual(first);
  });

  it("breaks creation-time ties by hostname and then id", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const rows = [
      device({ id: "id-3", hostname: "router-b", createdAt }),
      device({ id: "id-2", hostname: "router-a", createdAt }),
      device({ id: "id-1", hostname: "router-a", createdAt }),
    ];
    expect(rows.sort(compareDevicesForList).map((entry) => entry.id)).toEqual([
      "id-1",
      "id-2",
      "id-3",
    ]);
  });

  it("produces the same order for any input permutation", () => {
    const rows = [
      device({
        id: "id-a",
        hostname: "router-a",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      device({
        id: "id-b",
        hostname: "router-b",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      device({
        id: "id-c",
        hostname: "router-c",
        createdAt: new Date("2026-01-03T00:00:00Z"),
      }),
    ];
    const expected = ["id-a", "id-b", "id-c"];
    const permutations = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
      [2, 0, 1],
    ];
    for (const permutation of permutations) {
      const shuffled = permutation.map((index) => rows[index]!);
      expect(shuffled.sort(compareDevicesForList).map((entry) => entry.id)).toEqual(
        expected,
      );
    }
  });
});
