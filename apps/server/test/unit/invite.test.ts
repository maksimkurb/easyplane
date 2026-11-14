import { describe, expect, it } from "vitest";

import { evaluateInvite } from "@easyplane/server";

const now = new Date("2026-01-01T12:00:00Z");

function invite(overrides: Partial<Parameters<typeof evaluateInvite>[0]> = {}) {
  return evaluateInvite(
    {
      expiresAt: new Date("2026-01-02T12:00:00Z"),
      maxUses: 1,
      uses: 0,
      revokedAt: null,
      ...overrides,
    },
    now,
  );
}

describe("invite rules", () => {
  it("allows a fresh single-use invite", () => {
    expect(invite()).toMatchObject({
      canCreateDevice: true,
      canReconnectDevice: true,
      rejection: null,
      reusable: false,
      remainingUses: 1,
    });
  });

  it("blocks an exhausted single-use invite for new devices", () => {
    expect(invite({ uses: 1 })).toMatchObject({
      canCreateDevice: false,
      rejection: "exhausted",
      remainingUses: 0,
    });
  });

  it("still lets an existing device reconnect with an exhausted invite", () => {
    expect(invite({ uses: 1 }).canReconnectDevice).toBe(true);
  });

  it("blocks expired invites", () => {
    expect(
      invite({ expiresAt: new Date("2026-01-01T11:59:59Z") }).rejection,
    ).toBe("expired");
  });

  it("blocks revoked invites", () => {
    expect(invite({ revokedAt: now }).rejection).toBe("revoked");
  });

  it("treats null maxUses as reusable and unlimited", () => {
    expect(invite({ maxUses: null, uses: 500 })).toMatchObject({
      canCreateDevice: true,
      reusable: true,
      remainingUses: null,
    });
  });

  it("allows an invite without expiry until revoked", () => {
    expect(invite({ expiresAt: null })).toMatchObject({
      canCreateDevice: true,
      rejection: null,
    });
  });

  it("prefers revoked over expired", () => {
    expect(
      invite({ revokedAt: now, expiresAt: new Date("2020-01-01T00:00:00Z") })
        .rejection,
    ).toBe("revoked");
  });
});
