import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ManagedClient } from "@easyplane/server";

import {
  TEST_HOST,
  authed,
  bootstrapAdmin,
  createTestApp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

const MACHINE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const MACHINE_B = "bbbbbbbb-2222-4222-8222-222222222222";
const MACHINE_C = "cccccccc-3333-4333-8333-333333333333";

function stubClient(id: string): ManagedClient {
  return {
    id,
    isClosed: false,
    close: () => undefined,
    latestHeartbeat: undefined,
    remoteAddress: "127.0.0.1",
    transportKind: "ws",
    secure: true,
  } as unknown as ManagedClient;
}

describe("enrolment limits and invite expiry", () => {
  let test: TestApp;
  let admin: LoginResult;
  let networkId = "";
  let reusableToken = "";
  let expiringToken = "";
  let expiringId = "";

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return authed(admin, { "x-csrf-token": admin.csrfToken, ...extra });
  }

  async function heartbeat(token: string, machineId: string) {
    return test.context.devices.handleHeartbeat({
      token,
      machineId,
      hostname: "node",
      easytierVersion: "2.6.4-81487c36",
      osType: "linux",
      osVersion: "6.8",
      osDistribution: "debian",
      sourceIp: "127.0.0.1",
      client: stubClient(`session-${machineId}`),
    });
  }

  beforeAll(async () => {
    test = await createTestApp({
      oidc: false,
      env: { EASYPLANE_MAX_PENDING_DEVICES_PER_NETWORK: "1" },
    });
    admin = await bootstrapAdmin(test);

    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Limits" },
    });
    networkId = (network.json() as { id: string }).id;

    const reusable = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: { maxUses: null, expiresInHours: null },
    });
    reusableToken = (reusable.json() as { token: string }).token;

    const expiring = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: { maxUses: null, expiresInHours: 1 },
    });
    expiringToken = (expiring.json() as { token: string }).token;
    expiringId = (expiring.json() as { invite: { id: string } }).invite.id;
  });

  afterAll(async () => {
    await test.stop();
  });

  it("enrols the first device as pending", async () => {
    const result = await heartbeat(reusableToken, MACHINE_A);
    expect(result.created).toBe(true);
    expect(result.device.state).toBe("pending");
    expect(result.device.sourceIp).toBe("127.0.0.1");
  });

  it("rejects a second pending device when the cap is reached", async () => {
    await expect(heartbeat(reusableToken, MACHINE_B)).rejects.toThrow(
      /pending device limit/,
    );
    expect(await test.context.db.query.devices.findMany()).toHaveLength(1);
  });

  it("rejects an expired invite for a new device", async () => {
    await test.database.pool.query(
      "UPDATE invites SET expires_at = now() - interval '1 hour' WHERE id = $1",
      [expiringId],
    );
    await expect(heartbeat(expiringToken, MACHINE_C)).rejects.toThrow(/expired/);
  });

  it("does not create a device for a revoked invite", async () => {
    await test.app.inject({
      method: "DELETE",
      url: `/api/invites/${expiringId}`,
      headers: headers(),
    });
    await expect(heartbeat(expiringToken, MACHINE_C)).rejects.toThrow(/revoked/);
  });
});
