import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { normalizePolicyDocument, type ManagedClient } from "@easyplane/server";

import {
  authed,
  bootstrapAdmin,
  createTestApp,
  loginWithMockIdp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

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

interface DeviceDto {
  id: string;
  hostname: string;
  dnsName: string | null;
  magicDnsName: string | null;
  magicDnsZone: string;
  tags: string[];
  virtualIpv4: string | null;
  policyVersion: number;
}

describe("M2: policy, MagicDNS and route approval API", () => {
  let test: TestApp;
  let admin: LoginResult;
  let member: LoginResult;
  let viewer: LoginResult;
  let networkId = "";
  let token = "";
  let web: DeviceDto;
  let db: DeviceDto;

  function headers(login: LoginResult, extra: Record<string, string> = {}) {
    return authed(login, { "x-csrf-token": login.csrfToken, ...extra });
  }

  async function enrol(hostname: string, machineId: string) {
    const client = stubClient(`session-${machineId}`);
    await test.context.devices.handleHeartbeat({
      token,
      machineId,
      hostname,
      easytierVersion: "2.6.4-81487c36",
      osType: "linux",
      osVersion: "6.8",
      osDistribution: "debian",
      sourceIp: "127.0.0.1",
      client,
    });
    // There is no real client in this suite, so drop the stub session: pushes
    // then report "offline" instead of failing on a client without `remote`.
    test.context.deviceSessions.unbindClient(client);
    const list = await test.app.inject({
      method: "GET",
      url: `/api/devices?networkId=${networkId}`,
      headers: authed(admin),
    });
    const device = (list.json() as DeviceDto[]).find(
      (entry) => entry.hostname === hostname,
    );
    if (!device) throw new Error(`device ${hostname} not found`);
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/approve`,
      headers: headers(admin),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    return approved.json() as DeviceDto;
  }

  beforeAll(async () => {
    test = await createTestApp({ env: { EASYPLANE_RECONCILE_INTERVAL_MS: "60000" } });
    admin = await bootstrapAdmin(test);
    member = await loginWithMockIdp(test, "member");
    viewer = await loginWithMockIdp(test, "viewer");

    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(admin),
      payload: { name: "M2 Policy", ipv4Cidr: "10.77.0.0/24" },
    });
    expect(network.statusCode).toBe(201);
    networkId = (network.json() as { id: string }).id;

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(admin),
      payload: { maxUses: null, expiresInHours: null },
    });
    token = (invite.json() as { token: string }).token;

    web = await enrol("web", "11111111-1111-4111-8111-111111111111");
    db = await enrol("db", "22222222-2222-4222-8222-222222222222");
    expect(web.virtualIpv4).not.toBeNull();
    expect(db.virtualIpv4).not.toBeNull();
  });

  afterAll(async () => {
    await test?.stop();
  });

  it("assigns unique DNS names even when clients report the same hostname", async () => {
    const duplicate = await enrol("web", "33333333-3333-4333-8333-333333333333");
    expect(duplicate.dnsName).toBe("web-2");
    // Renaming onto a taken name is a conflict, not an overwrite.
    const conflict = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${duplicate.id}/hostname`,
      headers: headers(admin),
      payload: { dnsName: "db" },
    });
    expect(conflict.statusCode).toBe(409);
    const rename = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${duplicate.id}/hostname`,
      headers: headers(admin),
      payload: { dnsName: "web-three" },
    });
    expect(rename.statusCode).toBe(200);
    expect((rename.json() as DeviceDto).dnsName).toBe("web-three");
    // Members cannot rename to an invalid label.
    const invalid = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${duplicate.id}/hostname`,
      headers: headers(member),
      payload: { dnsName: "bad name!" },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("enables MagicDNS per network and shows resolved names/IPs", async () => {
    const patch = await test.app.inject({
      method: "PATCH",
      url: `/api/networks/${networkId}`,
      headers: headers(admin),
      payload: { magicDnsEnabled: true, magicDnsZone: "Corp.EasyPlane.Test" },
    });
    expect(patch.statusCode).toBe(200);
    const dns = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/dns`,
      headers: authed(member),
    });
    expect(dns.statusCode).toBe(200);
    const body = dns.json() as {
      enabled: boolean;
      zone: string;
      clientFlag: string;
      names: Array<{ fqdn: string; ipv4: string; hostname: string }>;
    };
    expect(body.enabled).toBe(true);
    expect(body.zone).toBe("corp.easyplane.test.");
    expect(body.clientFlag).toBe("--tld-dns-zone corp.easyplane.test.");
    const webName = body.names.find((entry) => entry.hostname === "web")!;
    expect(webName.fqdn).toBe("web.corp.easyplane.test.");
    expect(webName.ipv4).toBe(web.virtualIpv4);

    // The device DTO exposes the same name.
    const device = await test.app.inject({
      method: "GET",
      url: `/api/devices/${web.id}`,
      headers: authed(viewer),
    });
    expect((device.json() as DeviceDto).magicDnsName).toBe(
      "web.corp.easyplane.test.",
    );

    const bad = await test.app.inject({
      method: "PATCH",
      url: `/api/networks/${networkId}`,
      headers: headers(admin),
      payload: { magicDnsZone: "localhost" },
    });
    expect(bad.statusCode).toBe(400);
    // Viewers cannot toggle it.
    const forbidden = await test.app.inject({
      method: "PATCH",
      url: `/api/networks/${networkId}`,
      headers: headers(viewer),
      payload: { magicDnsEnabled: false },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("creates tags, assigns them and rejects malformed tag names", async () => {
    const bad = await test.app.inject({
      method: "POST",
      url: "/api/tags",
      headers: headers(admin),
      payload: { name: "server" },
    });
    expect(bad.statusCode).toBe(400);
    for (const name of ["tag:web", "tag:db"]) {
      const created = await test.app.inject({
        method: "POST",
        url: "/api/tags",
        headers: headers(admin),
        payload: { name },
      });
      expect(created.statusCode).toBe(201);
    }
    const tagged = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${web.id}/tags`,
      headers: headers(member),
      payload: { tags: ["tag:web"] },
    });
    expect(tagged.statusCode).toBe(200);
    expect((tagged.json() as DeviceDto).tags).toEqual(["tag:web"]);
    const dbTagged = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${db.id}/tags`,
      headers: headers(member),
      payload: { tags: ["tag:db"] },
    });
    expect(dbTagged.statusCode).toBe(200);
    const tags = await test.app.inject({
      method: "GET",
      url: "/api/tags",
      headers: authed(viewer),
    });
    expect((tags.json() as Array<{ name: string; deviceCount: number }>)).toEqual(
      expect.arrayContaining([{ id: expect.any(String), name: "tag:web", color: "", deviceCount: 1 }]),
    );
  });

  it("validates and saves a policy, creating a revision per device", async () => {
    const document = {
      groups: {},
      tagOwners: { "tag:web": [] },
      acls: [
        {
          name: "web-to-db",
          action: "accept",
          src: ["tag:web"],
          dst: ["tag:db:5432"],
          proto: "tcp",
        },
      ],
    };
    const validation = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/validate`,
      headers: headers(admin),
      payload: { document },
    });
    expect(validation.statusCode).toBe(200);
    const validationBody = validation.json() as {
      warnings: string[];
      devices: Array<{ hostname: string; inboundRules: number }>;
    };
    expect(validationBody.devices.find((entry) => entry.hostname === "db")?.inboundRules).toBe(1);

    const invalid = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/validate`,
      headers: headers(admin),
      payload: { document: { acls: [{ action: "accept", src: ["tag:ghost"], dst: ["*:*"] }] } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toContain("tag:ghost");

    // Members cannot save a policy.
    const forbidden = await test.app.inject({
      method: "PUT",
      url: `/api/networks/${networkId}/policy`,
      headers: headers(member),
      payload: { document },
    });
    expect(forbidden.statusCode).toBe(403);

    const saved = await test.app.inject({
      method: "PUT",
      url: `/api/networks/${networkId}/policy`,
      headers: headers(admin),
      payload: { document, note: "initial" },
    });
    expect(saved.statusCode).toBe(200);
    const savedBody = saved.json() as {
      policy: { version: number };
      revisionsCreated: number;
    };
    expect(savedBody.policy.version).toBe(1);
    expect(savedBody.revisionsCreated).toBeGreaterThanOrEqual(3);

    const devices = await test.app.inject({
      method: "GET",
      url: `/api/devices?networkId=${networkId}`,
      headers: authed(admin),
    });
    for (const device of devices.json() as DeviceDto[]) {
      expect(device.policyVersion).toBe(1);
    }

    const revisions = await test.app.inject({
      method: "GET",
      url: `/api/devices/${db.id}/revisions`,
      headers: authed(admin),
    });
    const rows = revisions.json() as Array<{ source: string; policyVersion: number | null }>;
    expect(rows[0]).toMatchObject({ source: "policy", policyVersion: 1 });
  });

  it("answers can A reach B on port P against the saved policy", async () => {
    const allowed = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/test`,
      headers: headers(member),
      payload: { srcDeviceId: web.id, dstDeviceId: db.id, port: 5432, protocol: "tcp" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      reachability: { allowed: true, ingress: { matchedRule: "web-to-db-in" } },
      policyVersion: 1,
    });

    const denied = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/test`,
      headers: headers(member),
      payload: { srcDeviceId: web.id, dstDeviceId: db.id, port: 22, protocol: "tcp" },
    });
    expect(denied.statusCode).toBe(200);
    expect((denied.json() as { reachability: { allowed: boolean } }).reachability.allowed).toBe(
      false,
    );

    // The advanced editor path accepts HuJSON with comments.
    const preview = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/preview`,
      headers: headers(member),
      payload: {
        document: normalizePolicyDocument({
          acls: [
            { name: "any", action: "accept", src: ["*"], dst: ["*:*"], proto: "any" },
          ],
        }),
        srcDeviceId: web.id,
        dstDeviceId: db.id,
        port: 22,
        protocol: "tcp",
      },
    });
    expect(preview.statusCode).toBe(200);
    expect((preview.json() as { reachability: { allowed: boolean } }).reachability.allowed).toBe(
      true,
    );
  });

  it("keeps route requests pending until an admin approves them", async () => {
    const requested = await test.app.inject({
      method: "POST",
      url: `/api/devices/${db.id}/routes`,
      headers: headers(member),
      payload: { kind: "subnet", cidr: "192.168.44.0/24", note: "lab" },
    });
    expect(requested.statusCode).toBe(201);
    const route = (requested.json() as { id: string; state: string; cidr: string });
    expect(route.state).toBe("pending");

    // Members cannot approve their own request.
    const forbidden = await test.app.inject({
      method: "POST",
      url: `/api/routes/${route.id}/decision`,
      headers: headers(member),
      payload: { state: "approved" },
    });
    expect(forbidden.statusCode).toBe(403);

    const list = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/routes`,
      headers: authed(member),
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as {
      routes: Array<{ id: string; state: string }>;
      reports: Array<{ deviceId: string; report: unknown }>;
    };
    expect(listBody.routes).toHaveLength(1);
    expect(listBody.reports).toHaveLength(3);

    const approved = await test.app.inject({
      method: "POST",
      url: `/api/routes/${route.id}/decision`,
      headers: headers(admin),
      payload: { state: "approved", note: "ok" },
    });
    expect(approved.statusCode).toBe(200);
    expect((approved.json() as { state: string }).state).toBe("approved");

    // Exit-node requests are idempotent per device.
    const exit = await test.app.inject({
      method: "POST",
      url: `/api/devices/${web.id}/routes`,
      headers: headers(member),
      payload: { kind: "exit_node" },
    });
    expect(exit.statusCode).toBe(201);
    const exitAgain = await test.app.inject({
      method: "POST",
      url: `/api/devices/${web.id}/routes`,
      headers: headers(member),
      payload: { kind: "exit_node" },
    });
    expect(exitAgain.statusCode).toBe(201);
    expect((exitAgain.json() as { id: string }).id).toBe((exit.json() as { id: string }).id);

    // An overlapping subnet is rejected outright.
    const overlap = await test.app.inject({
      method: "POST",
      url: `/api/devices/${db.id}/routes`,
      headers: headers(member),
      payload: { kind: "subnet", cidr: "192.168.44.128/25" },
    });
    expect(overlap.statusCode).toBe(400);
  });

  it("stores the routes a client actually reports and flags unapproved ones", async () => {
    const device = (await test.app.inject({
      method: "GET",
      url: `/api/devices/${db.id}`,
      headers: authed(admin),
    })).json() as DeviceDto & { reportedState: Record<string, unknown> };
    const stored = await test.context.db.query.devices.findFirst({
      where: (table, { eq }) => eq(table.id, db.id),
    });
    expect(stored).toBeDefined();
    const report = await test.context.routes.recordReport(stored!, {
      instances: [
        {
          instanceId: "local-file",
          networkName: "m2-policy",
          hostname: "db",
          proxyCidrs: ["10.123.0.0/16"],
          exitNode: false,
          unmanaged: true,
          removable: false,
        },
      ],
      peerObservations: [
        { ipv4: "10.77.0.99", hostname: "stranger", proxyCidrs: ["172.31.0.0/16"] },
      ],
    });
    expect(report.unapprovedCidrs).toEqual(["10.123.0.0/16"]);
    expect(report.unmanagedInstances).toHaveLength(1);
    expect(report.unknownPeers).toHaveLength(1);
    const refreshed = (await test.app.inject({
      method: "GET",
      url: `/api/devices/${db.id}`,
      headers: authed(admin),
    })).json() as { reportedState: { routeReport?: { unapprovedCidrs: string[] } } };
    expect(refreshed.reportedState.routeReport?.unapprovedCidrs).toEqual([
      "10.123.0.0/16",
    ]);
    void device;

    const audit = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=200",
      headers: authed(admin),
    });
    expect(audit.body).toContain("route.unapproved_reported");
    expect(audit.body).toContain("policy.version_created");
    expect(audit.body).toContain("device.renamed");
    expect(audit.body).toContain("network.magicdns_updated");
  });
});
