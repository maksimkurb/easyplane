import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ManagedClient } from "@easyplane/server";

import {
  TEST_HOST,
  authed,
  createTestApp,
  loginWithMockIdp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

const MACHINE_ANCHOR = "aaaaaaaa-1111-4111-8111-111111111111";
const MACHINE_MEMBER = "bbbbbbbb-2222-4222-8222-222222222222";
const MACHINE_LATE = "cccccccc-3333-4333-8333-333333333333";

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

interface DeviceJson {
  id: string;
  state: string;
  role: string;
  effectiveRole: string;
  knowsSecret: boolean;
  accessMode: string;
  credential: {
    credentialId: string;
    status: string;
    expiry: string;
    groups: string[];
    publicKey: string;
  } | null;
}

interface InviteJson {
  id: string;
  role: string;
  token?: string;
}

describe("credential mode: API, roles, migration and revoke", () => {
  let test: TestApp;
  let admin: LoginResult;
  let member: LoginResult;
  let networkId = "";

  function headers(login: LoginResult = admin): Record<string, string> {
    return authed(login, { "x-csrf-token": login.csrfToken });
  }

  async function heartbeat(token: string, machineId: string, hostname: string) {
    return test.context.devices.handleHeartbeat({
      token,
      machineId,
      hostname,
      easytierVersion: "2.6.4-81487c36",
      osType: "linux",
      osVersion: "6.8",
      osDistribution: "debian",
      sourceIp: "127.0.0.1",
      client: stubClient(`session-${machineId}`),
    });
  }

  async function deviceList(): Promise<DeviceJson[]> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices?networkId=${networkId}`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceJson[];
  }

  async function createInvite(role: "anchor" | "member"): Promise<InviteJson> {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: { role, maxUses: null, expiresInHours: null },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { invite: InviteJson; token: string };
    return { ...body.invite, token: body.token };
  }

  async function enrol(machineId: string, hostname: string, role: "anchor" | "member") {
    const invite = await createInvite(role);
    const { device } = await heartbeat(invite.token!, machineId, hostname);
    const approve = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/approve`,
      headers: headers(),
      payload: {},
    });
    return { deviceId: device.id, status: approve.statusCode, approve };
  }

  beforeAll(async () => {
    test = await createTestApp();
    admin = await loginWithMockIdp(test, "admin");
    member = await loginWithMockIdp(test, "member");

    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Credentials" },
    });
    networkId = (network.json() as { id: string }).id;
  });

  afterAll(async () => {
    await test.stop();
  });

  it("enrols shared-secret devices as effective anchors", async () => {
    const first = await enrol(MACHINE_ANCHOR, "anchor-a", "anchor");
    expect(first.status).toBe(200);
    const second = await enrol(MACHINE_MEMBER, "member-1", "member");
    expect(second.status).toBe(200);

    const devices = await deviceList();
    for (const device of devices) {
      expect(device.accessMode).toBe("shared_secret");
      expect(device.effectiveRole).toBe("anchor");
      expect(device.knowsSecret).toBe(true);
      expect(device.credential).toBeNull();
    }
  });

  it("previews and applies the migration to credentials", async () => {
    const devices = await deviceList();
    const anchor = devices.find((device) => device.id.length > 0)!;

    const preview = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/access-mode/preview`,
      headers: headers(),
      payload: { mode: "credentials", anchorDeviceIds: [anchor.id] },
    });
    expect(preview.statusCode).toBe(200);
    const plan = preview.json() as {
      anchors: unknown[];
      members: Array<{ hasCredential: boolean }>;
      warnings: string[];
    };
    expect(plan.anchors).toHaveLength(1);
    expect(plan.members.every((entry) => entry.hasCredential === false)).toBe(true);

    const switched = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/access-mode`,
      headers: headers(),
      payload: { mode: "credentials", anchorDeviceIds: [anchor.id] },
    });
    expect(switched.statusCode).toBe(200);
    const body = switched.json() as { network: { access: { mode: string } } };
    expect(body.network.access.mode).toBe("credentials");

    const after = await deviceList();
    const anchors = after.filter((device) => device.effectiveRole === "anchor");
    const members = after.filter((device) => device.effectiveRole === "member");
    expect(anchors).toHaveLength(1);
    expect(members).toHaveLength(1);
    expect(members[0]!.knowsSecret).toBe(false);
    expect(members[0]!.credential?.status).toBe("active");
    expect(members[0]!.credential?.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
    // The credential is a 32-byte X25519 public key.
    expect(Buffer.from(members[0]!.credential!.publicKey, "base64")).toHaveLength(32);
  });

  it("refuses a member before any anchor exists and explains why", async () => {
    const empty = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Empty credentials" },
    });
    const emptyId = (empty.json() as { id: string }).id;
    // Switch an empty network: there is nothing to lose and no anchor yet.
    const switched = await test.app.inject({
      method: "POST",
      url: `/api/networks/${emptyId}/access-mode`,
      headers: headers(),
      payload: { mode: "credentials", anchorDeviceIds: [] },
    });
    expect(switched.statusCode).toBe(200);

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${emptyId}/invites`,
      headers: headers(),
      payload: { role: "member" },
    });
    // A member invite cannot be created before the first anchor.
    expect(invite.statusCode).toBe(409);
    expect((invite.json() as { error: string }).error).toMatch(/anchor/i);
  });

  it("issues credentials to members approved after the switch", async () => {
    const late = await enrol(MACHINE_LATE, "member-2", "member");
    expect(late.status).toBe(200);
    const devices = await deviceList();
    const created = devices.find((device) => device.id === late.deviceId)!;
    expect(created.effectiveRole).toBe("member");
    expect(created.credential?.status).toBe("active");
  });

  it("renews due credentials, extends their expiry and is idempotent", async () => {
    const devices = await deviceList();
    const member = devices.find(
      (device) => device.effectiveRole === "member" && device.credential,
    )!;
    const before = new Date(member.credential!.expiry).getTime();
    // Move the credential into the renewal window (the real default is 14 days
    // before a 90-day expiry, which no test would reach otherwise).
    await test.database.pool.query(
      "UPDATE credentials SET expiry = now() + interval '1 hour' WHERE device_id = $1",
      [member.id],
    );

    const first = await test.context.credentials.renewDue();
    expect(first.renewed).toBeGreaterThan(0);

    const after = (await deviceList()).find((device) => device.id === member.id)!;
    expect(new Date(after.credential!.expiry).getTime()).toBeGreaterThan(before);

    // A second run inside the window has nothing left to do.
    const second = await test.context.credentials.renewDue();
    expect(second.renewed).toBe(0);

    // Renewal keeps the same credential id (the member does not need a new
    // config); only the expiry moved.
    expect(after.credential!.credentialId).toBe(member.credential!.credentialId);
  });

  it("restricts role changes and revoke to admins", async () => {
    const devices = await deviceList();
    const target = devices.find((device) => device.effectiveRole === "member")!;
    const forbidden = await test.app.inject({
      method: "POST",
      url: `/api/devices/${target.id}/credential/revoke`,
      headers: headers(member),
    });
    expect(forbidden.statusCode).toBe(403);

    const roleForbidden = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${target.id}/role`,
      headers: headers(member),
      payload: { role: "anchor" },
    });
    expect(roleForbidden.statusCode).toBe(403);
  });

  it("revokes a member credential and blocks the device", async () => {
    const devices = await deviceList();
    const target = devices.find((device) => device.effectiveRole === "member")!;
    const response = await test.app.inject({
      method: "POST",
      url: `/api/devices/${target.id}/credential/revoke`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as DeviceJson;
    expect(body.state).toBe("blocked");
    expect(body.credential?.status).toBe("revoked");

    // Re-approving a blocked member issues a fresh credential.
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${target.id}/approve`,
      headers: headers(),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    const reissued = approved.json() as DeviceJson;
    expect(reissued.credential?.status).toBe("active");
    expect(reissued.credential?.credentialId).not.toBe(body.credential?.credentialId);
  });

  it("demotes an anchor only with an explicit acknowledgement", async () => {
    const devices = await deviceList();
    const anchor = devices.find((device) => device.effectiveRole === "anchor")!;
    const refused = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${anchor.id}/role`,
      headers: headers(),
      payload: { role: "member" },
    });
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { error: string }).error).toMatch(/secret/i);

    const accepted = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${anchor.id}/role`,
      headers: headers(),
      payload: { role: "member", acknowledge: true },
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json() as {
      device: DeviceJson;
      needsSecretRotation: boolean;
    };
    expect(body.needsSecretRotation).toBe(true);
    expect(body.device.effectiveRole).toBe("member");
    expect(body.device.credential?.status).toBe("active");
  });

  it("rotates the network secret without invalidating credentials", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/secret/rotate`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { secret: string; credentialsSurvive: boolean };
    expect(body.secret.length).toBeGreaterThan(8);
    expect(body.credentialsSurvive).toBe(true);
  });

  it("switches back to a shared secret only with an acknowledgement", async () => {
    const refused = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/access-mode`,
      headers: headers(),
      payload: { mode: "shared_secret" },
    });
    expect(refused.statusCode).toBe(409);

    const switched = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/access-mode`,
      headers: headers(),
      payload: { mode: "shared_secret", acknowledge: true },
    });
    expect(switched.statusCode).toBe(200);
    const devices = await deviceList();
    for (const device of devices) {
      expect(device.effectiveRole).toBe("anchor");
      expect(device.knowsSecret).toBe(true);
    }
    expect(
      devices
        .filter((device) => device.credential !== null)
        .every((device) => device.credential?.status === "revoked"),
    ).toBe(true);
  });
});
