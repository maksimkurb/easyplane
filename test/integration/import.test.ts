import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { manage } from "@easyplane/proto";
import type { ManagedClient } from "@easyplane/server";

import {
  TEST_HOST,
  authed,
  createTestApp,
  loginWithMockIdp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

const IMPORT_TOML = `
instance_name = "imported-lab"
ipv4 = "10.77.0.10/24"

[network_identity]
network_name = "imported-lab-net"
network_secret = "imported-secret-do-not-log"

listeners = ["tcp://0.0.0.0:11010"]

[[peer]]
uri = "tcp://public.example.com:11010"

[flags]
no_tun = true
accept_dns = true
`;

const ADOPTED_SECRET = "adopted-secret-do-not-log";
const ADOPTED_INSTANCE = "11111111-2222-4333-8444-555555555555";

function fakeClient(config: manage.NetworkConfig): ManagedClient {
  const remote = {
    runNetworkInstance: vi.fn(async () => ({ instId: "" })),
    collectNetworkInfo: vi.fn(async () => ({ info: { map: {} } })),
    listNetworkInstance: vi.fn(async () => [ADOPTED_INSTANCE]),
    getNetworkInstanceConfig: vi.fn(async () => ({
      config,
      source: manage.ConfigSource.ConfigSourceUser,
    })),
    deleteNetworkInstance: vi.fn(async () => ({ remainInstIds: [] })),
  };
  return {
    id: "adopt-session",
    isClosed: false,
    remote,
    close: vi.fn(),
    heartbeatCount: 1,
    transportKind: "ws",
    secure: true,
    remoteAddress: "127.0.0.1",
    latestHeartbeat: undefined,
  } as unknown as ManagedClient;
}

describe("M4 import flows", () => {
  let test: TestApp;
  let admin: LoginResult;
  let member: LoginResult;
  let viewer: LoginResult;
  let sourceNetworkId = "";
  let inviteToken = "";
  let deviceId = "";
  let importedNetworkId = "";
  let draftId = "";
  let adoptedClient: ManagedClient;

  function headers(login: LoginResult, extra: Record<string, string> = {}) {
    return authed(login, { "x-csrf-token": login.csrfToken, ...extra });
  }

  async function preview(
    payload: unknown,
    login: LoginResult = admin,
  ) {
    return test.app.inject({
      method: "POST",
      url: "/api/networks/import/preview",
      headers: headers(login),
      payload: payload as Record<string, unknown>,
    });
  }

  beforeAll(async () => {
    test = await createTestApp({ env: { EASYPLANE_LOG_LEVEL: "error" } });
    admin = await loginWithMockIdp(test, "admin");
    member = await loginWithMockIdp(test, "member");
    viewer = await loginWithMockIdp(test, "viewer");

    // A network+device the adoption flow can read from.
    const created = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(admin),
      payload: { name: "Device source", ipv4Cidr: "10.66.0.0/24" },
    });
    expect(created.statusCode).toBe(201);
    sourceNetworkId = (created.json() as { id: string }).id;
    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${sourceNetworkId}/invites`,
      headers: headers(admin),
      payload: { label: "adopt", maxUses: 5 },
    });
    expect(invite.statusCode).toBe(201);
    inviteToken = (invite.json() as { token: string }).token;

    const client = fakeClient({
      instanceId: ADOPTED_INSTANCE,
      hostname: "adopt-node",
      networkName: "adopted-running-net",
      networkSecret: ADOPTED_SECRET,
      networkingMethod: manage.NetworkingMethod.Manual,
      dhcp: false,
      virtualIpv4: "10.66.0.10",
      networkLength: 24,
      peerUrls: ["tcp://relay.example.com:11010"],
      listenerUrls: [],
      proxyCidrs: ["192.168.77.0/24"],
      routes: [],
      relayNetworkWhitelist: [],
      exitNodes: [],
      mappedListeners: [],
      portForwards: [],
      peers: [],
      managedCredentials: [],
    });
    await test.context.devices.handleHeartbeat({
      token: inviteToken,
      machineId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      hostname: "adopt-node",
      easytierVersion: "2.6.4-81487c36",
      osType: "linux",
      osVersion: "6.8",
      osDistribution: "debian",
      sourceIp: "127.0.0.1",
      client,
    });
    const devices = await test.context.db.query.devices.findMany();
    expect(devices).toHaveLength(1);
    deviceId = devices[0]!.id;
    adoptedClient = client;
    test.context.deviceSessions.bind(deviceId, client);
  });

  afterAll(async () => {
    await test.stop();
  });

  it("requires the admin role", async () => {
    for (const login of [member, viewer]) {
      const response = await preview(
        { source: { type: "toml", text: IMPORT_TOML } },
        login,
      );
      expect(response.statusCode).toBe(403);
    }
    const anonymous = await test.app.inject({
      method: "POST",
      url: "/api/networks/import/preview",
      headers: { host: TEST_HOST },
      payload: { source: { type: "toml", text: IMPORT_TOML } },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("requires CSRF on the preview", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: "/api/networks/import/preview",
      headers: authed(admin),
      payload: { source: { type: "toml", text: IMPORT_TOML } },
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { code: string }).code).toBe("invalid_csrf");
  });

  it("previews TOML with a diff and never returns the secret", async () => {
    const response = await preview({
      source: { type: "toml", text: IMPORT_TOML },
      existingNetworkId: sourceNetworkId,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      draftId: string;
      network: { name: string; networkName: string; ipv4Cidr: string };
      secret: { present: boolean; sameAsExisting: boolean | null };
      summary: { peerUrls: string[]; listenerUrls: string[]; aclChains: number };
      diff: Array<{ field: string; changed: boolean }>;
      unsupported: string[];
      warnings: string[];
    };
    draftId = body.draftId;
    expect(body.draftId.length).toBeGreaterThan(20);
    expect(body.network.networkName).toBe("imported-lab-net");
    expect(body.network.ipv4Cidr).toBe("10.77.0.0/24");
    expect(body.secret).toEqual({ present: true, sameAsExisting: false });
    expect(body.summary.peerUrls).toEqual(["tcp://public.example.com:11010"]);
    expect(body.diff.map((entry) => entry.field)).toContain("networkName");
    expect(body.diff.find((entry) => entry.field === "networkSecret")?.changed).toBe(
      true,
    );
    expect(body.warnings.join(" ")).toContain("creates a new network");
    expect(response.body).not.toContain("imported-secret-do-not-log");
    // The secret is not in the response object at any depth.
    expect(JSON.stringify(body)).not.toContain("imported-secret-do-not-log");
  });

  it("rejects another user's draft and an unknown draft", async () => {
    const other = await preview(
      { source: { type: "toml", text: IMPORT_TOML } },
      admin,
    );
    const otherId = (other.json() as { draftId: string }).draftId;
    const asMember = await test.app.inject({
      method: "POST",
      url: `/api/networks/import/${otherId}/commit`,
      headers: headers(member),
      payload: {},
    });
    expect(asMember.statusCode).toBe(403);
    const unknown = await test.app.inject({
      method: "POST",
      url: "/api/networks/import/not-a-real-draft/commit",
      headers: headers(admin),
      payload: {},
    });
    expect(unknown.statusCode).toBe(400);
  });

  it("commits the import, preserving the source secret", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/networks/import/${draftId}/commit`,
      headers: headers(admin),
      payload: { name: "Imported lab" },
    });
    expect(response.statusCode).toBe(201);
    const network = response.json() as {
      id: string;
      name: string;
      networkName: string;
      ipv4Cidr: string;
      defaultConfig: Record<string, unknown>;
      magicDnsEnabled: boolean;
    };
    importedNetworkId = network.id;
    expect(network.name).toBe("Imported lab");
    expect(network.networkName).toBe("imported-lab-net");
    expect(network.ipv4Cidr).toBe("10.77.0.0/24");
    expect(network.magicDnsEnabled).toBe(true);
    expect(network.defaultConfig).toMatchObject({
      noTun: true,
      networkingMethod: "manual",
      peerUrls: ["tcp://public.example.com:11010"],
    });

    const stored = await test.context.db.query.networks.findFirst({
      where: (table, { eq }) => eq(table.id, importedNetworkId),
    });
    expect(stored?.secretCiphertext).toMatch(/^v1\./);
    expect(stored?.secretCiphertext).not.toContain("imported-secret-do-not-log");
    const revealed = await test.app.inject({
      method: "POST",
      url: `/api/networks/${importedNetworkId}/secret/reveal`,
      headers: headers(admin),
    });
    expect((revealed.json() as { secret: string }).secret).toBe(
      "imported-secret-do-not-log",
    );
  });

  it("cannot reuse a committed draft", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/networks/import/${draftId}/commit`,
      headers: headers(admin),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it("refuses a duplicate network_name with a clear conflict", async () => {
    const previewed = await preview({
      source: { type: "toml", text: IMPORT_TOML },
    });
    const body = previewed.json() as {
      draftId: string;
      networkNameTaken: boolean;
      warnings: string[];
    };
    expect(body.networkNameTaken).toBe(true);
    expect(body.warnings.join(" ")).toContain("already exists");
    const commit = await test.app.inject({
      method: "POST",
      url: `/api/networks/import/${body.draftId}/commit`,
      headers: headers(admin),
      payload: {},
    });
    expect(commit.statusCode).toBe(409);
  });

  it("exports TOML and a share link for admins only", async () => {
    const toml = await test.app.inject({
      method: "GET",
      url: `/api/networks/${importedNetworkId}/export?format=toml`,
      headers: authed(admin),
    });
    expect(toml.statusCode).toBe(200);
    const exported = toml.json() as { format: string; content: string };
    expect(exported.format).toBe("toml");
    expect(exported.content).toContain("imported-lab-net");
    expect(exported.content).toContain("imported-secret-do-not-log");

    const link = await test.app.inject({
      method: "GET",
      url: `/api/networks/${importedNetworkId}/export?format=share-link`,
      headers: authed(admin),
    });
    expect(link.statusCode).toBe(200);
    const linkBody = link.json() as { content: string };
    expect(linkBody.content).toContain("https://easytier.cn/comp_cfg?cfg=");

    const forbidden = await test.app.inject({
      method: "GET",
      url: `/api/networks/${importedNetworkId}/export?format=toml`,
      headers: authed(viewer),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("adopts the config a connected device is running", async () => {
    const instances = await test.app.inject({
      method: "GET",
      url: `/api/devices/${deviceId}/import/instances`,
      headers: authed(admin),
    });
    expect(instances.statusCode).toBe(200);
    expect(instances.json()).toEqual([
      { instanceId: ADOPTED_INSTANCE, managed: false },
    ]);

    const response = await preview({
      source: { type: "device", deviceId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      draftId: string;
      source: { type: string; detail: string };
      network: { networkName: string; ipv4Cidr: string };
      summary: { proxyCidrs: string[] };
      warnings: string[];
      unsupported: string[];
      secret: { present: boolean };
    };
    expect(body.source.type).toBe("device");
    expect(body.source.detail).toContain("adopt-node");
    expect(body.network.networkName).toBe("adopted-running-net");
    expect(body.network.ipv4Cidr).toBe("10.66.0.0/24");
    expect(body.summary.proxyCidrs).toEqual(["192.168.77.0/24"]);
    expect(body.secret.present).toBe(true);
    expect(body.unsupported.join(" ")).toContain("proxy CIDRs");
    expect(JSON.stringify(body)).not.toContain(ADOPTED_SECRET);

    const commit = await test.app.inject({
      method: "POST",
      url: `/api/networks/import/${body.draftId}/commit`,
      headers: headers(admin),
      payload: { name: "Adopted" },
    });
    expect(commit.statusCode).toBe(201);
    const network = commit.json() as { id: string };
    const revealed = await test.app.inject({
      method: "POST",
      url: `/api/networks/${network.id}/secret/reveal`,
      headers: headers(admin),
    });
    expect((revealed.json() as { secret: string }).secret).toBe(ADOPTED_SECRET);
  });

  it("refuses to adopt from an offline device", async () => {
    test.context.deviceSessions.unbindClient(adoptedClient);
    const response = await preview({ source: { type: "device", deviceId } });
    expect(response.statusCode).toBe(409);
  });

  it("audits imports without writing the secret", async () => {
    const audit = await test.context.db.query.auditLog.findMany({
      where: (table, { eq }) => eq(table.action, "network.imported"),
    });
    expect(audit.length).toBe(2);
    for (const entry of audit) {
      expect(JSON.stringify(entry.metadata)).not.toContain(
        "imported-secret-do-not-log",
      );
      expect(JSON.stringify(entry.metadata)).not.toContain(ADOPTED_SECRET);
      expect(entry.metadata).toMatchObject({ sourceIdentityKept: true });
    }
    const exported = await test.context.db.query.auditLog.findMany({
      where: (table, { eq }) => eq(table.action, "network.exported"),
    });
    expect(exported.length).toBe(2);
    expect(JSON.stringify(exported[0]!.metadata)).not.toContain(
      "imported-secret-do-not-log",
    );
  });
});
