import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ManagedClient } from "@easyplane/server";

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
  tags: string[];
  virtualIpv4: string | null;
  policyVersion: number;
}

interface NetworkDto {
  id: string;
  policyVersion: number;
  policyMode: "open" | "rules" | "json";
}

const chainDefault = (action: "allow" | "block") => ({ default: action, enabled: true });

describe("policy model v2 API: rules, subjects, tags, user groups and compiled ACL", () => {
  let test: TestApp;
  let admin: LoginResult;
  let member: LoginResult;
  let viewer: LoginResult;
  let networkId = "";
  let token = "";
  const devices: Record<"web1" | "db" | "router", DeviceDto> = {} as never;

  function headers(login: LoginResult): Record<string, string> {
    return authed(login, { "x-csrf-token": login.csrfToken });
  }

  async function enrol(hostname: string, machineId: string): Promise<DeviceDto> {
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

  const v2Document = {
    version: 2,
    mode: "rules",
    subnets: { "home-lan": { cidr: "192.168.55.0/24", via: "router" } },
    tags: { web: ["web1"], db: ["db"] },
    userGroups: { ops: { source: "manual", members: ["member@example.com"] } },
    chains: {
      inbound: chainDefault("block"),
      outbound: chainDefault("block"),
      forward: chainDefault("block"),
    },
    rules: [
      {
        name: "web-db",
        action: "allow",
        from: ["tag:web"],
        to: ["tag:db"],
        protocol: "tcp",
        ports: ["5432"],
      },
      {
        name: "lan-db",
        action: "allow",
        from: ["subnet:home-lan"],
        to: ["device:db"],
        protocol: "tcp",
        ports: ["8080"],
      },
      {
        name: "ops-web",
        action: "allow",
        from: ["group:ops"],
        to: ["device:web1"],
        protocol: "tcp",
        ports: ["22"],
      },
    ],
  };

  beforeAll(async () => {
    test = await createTestApp({ env: { EASYPLANE_RECONCILE_INTERVAL_MS: "60000" } });
    admin = await bootstrapAdmin(test);
    member = await loginWithMockIdp(test, "member");
    viewer = await loginWithMockIdp(test, "viewer");

    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(admin),
      payload: { name: "V2 Policy", ipv4Cidr: "10.78.0.0/24" },
    });
    expect(network.statusCode).toBe(201);
    networkId = (network.json() as NetworkDto).id;

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(admin),
      payload: { maxUses: null, expiresInHours: null },
    });
    token = (invite.json() as { token: string }).token;

    devices.web1 = await enrol("web1", "11111111-1111-4111-8111-111111111111");
    devices.db = await enrol("db", "22222222-2222-4222-8222-222222222222");
    devices.router = await enrol("router", "33333333-3333-4333-8333-333333333333");

    // v1 policies reference existing tags; the v2 document can declare them.
    for (const name of ["web", "db"]) {
      const created = await test.app.inject({
        method: "POST",
        url: "/api/tags",
        headers: headers(admin),
        payload: { name },
      });
      expect(created.statusCode).toBe(201);
    }

    const route = await test.app.inject({
      method: "POST",
      url: `/api/devices/${devices.router.id}/routes`,
      headers: headers(member),
      payload: { kind: "subnet", cidr: "192.168.55.0/24" },
    });
    expect(route.statusCode).toBe(201);
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/routes/${(route.json() as { id: string }).id}/decision`,
      headers: headers(admin),
      payload: { state: "approved" },
    });
    expect(approved.statusCode).toBe(200);
  });

  afterAll(async () => {
    await test?.stop();
  });

  it("builds the subject catalog from devices, tags, people and approved subnets", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/policy/subjects`,
      headers: authed(viewer),
    });
    expect(response.statusCode).toBe(200);
    const catalog = response.json() as {
      devices: Array<{ name: string; virtualIpv4: string }>;
      tags: Array<{ name: string; subject: string; deviceCount: number }>;
      userGroups: Array<{
        name: string;
        source: string;
        readOnly: boolean;
        peopleCount: number;
      }>;
      subnets: Array<{
        id: string;
        cidr: string;
        viaHostname: string;
        approved: boolean;
        display: string;
      }>;
    };
    expect(catalog.devices.map((device) => device.name).sort()).toEqual([
      "db",
      "router",
      "web1",
    ]);
    // The approved route is exposed as a named subnet with its router.
    expect(catalog.subnets).toEqual([
      expect.objectContaining({
        cidr: "192.168.55.0/24",
        viaHostname: "router",
        approved: true,
      }),
    ]);
    expect(catalog.subnets[0]!.display).toContain("192.168.55.0/24");
    // People come from the IdP claim and are read-only; manual groups are not
    // listed until created.
    const synced = catalog.userGroups.find(
      (group) => group.name === "easyplane-members",
    );
    expect(synced).toMatchObject({ source: "oidc", readOnly: true, peopleCount: 1 });
  });

  it("upgrades a v1 document on save and reports it", async () => {
    const saved = await test.app.inject({
      method: "PUT",
      url: `/api/networks/${networkId}/policy`,
      headers: headers(admin),
      payload: {
        document: {
          groups: { "group:ops": ["member@example.com"] },
          acls: [
            {
              name: "web-db",
              action: "accept",
              src: ["tag:web"],
              dst: ["tag:db:5432"],
              proto: "tcp",
            },
          ],
        },
        note: "v1 imported",
      },
    });
    expect(saved.statusCode).toBe(200);
    const body = saved.json() as {
      upgradedFromV1: boolean;
      policy: { version: number; document: Record<string, unknown> };
    };
    expect(body.upgradedFromV1).toBe(true);
    expect(body.policy.version).toBe(1);
    const document = body.policy.document as {
      version: number;
      rules: Array<{ action: string; from: string[]; ports: string[] }>;
      userGroups: Record<string, unknown>;
      chains: Record<string, { default: string }>;
    };
    expect(document.version).toBe(2);
    expect(document.rules[0]).toMatchObject({
      action: "allow",
      from: ["tag:web"],
      ports: ["5432"],
    });
    expect(document.userGroups).toHaveProperty("ops");
    expect(document.chains.outbound?.default).toBe("allow");

    // The network is no longer "open" after a save.
    const network = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}`,
      headers: authed(viewer),
    });
    expect(network.json()).toMatchObject({ policyVersion: 1, policyMode: "rules" });
  });

  it("returns structured rules, the enriched document and per-device compilations", async () => {
    const saved = await test.app.inject({
      method: "PUT",
      url: `/api/networks/${networkId}/policy`,
      headers: headers(admin),
      payload: { document: v2Document, note: "v2 model" },
    });
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as { policy: { version: number } }).policy.version).toBe(2);

    const state = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/policy`,
      headers: authed(viewer),
    });
    expect(state.statusCode).toBe(200);
    const body = state.json() as {
      version: number;
      mode: string;
      deviceCount: number;
      rules: Array<{
        index: number;
        name: string | null;
        from: Array<{ kind: string; name: string; deviceCount: number }>;
        to: Array<{ kind: string; name: string; detail?: string }>;
        affectedDeviceCount: number;
      }>;
      document: {
        tags: Record<string, string[]>;
        userGroups: Record<string, { source: string; members: string[] }>;
        subnets: Record<string, { cidr: string; via?: string }>;
      };
    };
    expect(body.version).toBe(2);
    expect(body.mode).toBe("rules");
    expect(body.deviceCount).toBe(3);
    expect(body.rules).toHaveLength(3);
    expect(body.rules[0]).toMatchObject({
      index: 0,
      name: "web-db",
      from: [{ kind: "tag", name: "web", deviceCount: 1 }],
      to: [{ kind: "tag", name: "db", deviceCount: 1 }],
    });
    expect(body.rules[1]!.from[0]).toMatchObject({
      kind: "subnet",
      name: "home-lan",
    });
    expect(body.rules[2]!.from[0]).toMatchObject({
      kind: "group",
      name: "ops",
    });
    expect(body.rules[2]!.from[0]!.deviceCount).toBe(0); // member owns no device
    // The document round-trips with the server-derived collections.
    expect(body.document.tags).toMatchObject({ web: ["web1"], db: ["db"] });
    expect(body.document.userGroups.ops).toMatchObject({
      source: "manual",
      members: ["member@example.com"],
    });
    expect(body.document.subnets["home-lan"]).toMatchObject({
      cidr: "192.168.55.0/24",
      via: "router",
    });

    // The compiled ACL uses EasyTier field names and is inspectable per device.
    const compiled = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/policy/compiled/${devices.db.id}`,
      headers: authed(viewer),
    });
    expect(compiled.statusCode).toBe(200);
    const acl = compiled.json() as {
      enabled: boolean;
      mode: string;
      chains: Array<{
        chainType: string;
        defaultAction: string;
        rules: Array<{
          name: string;
          sourceIps: string[];
          destinationIps: string[];
          sourcePorts: string[];
          ports: string[];
          action: string;
          protocol: string;
          stateful: boolean;
        }>;
      }>;
      group: { members: string[]; declares: Array<{ groupName: string }> };
    };
    expect(acl.enabled).toBe(true);
    expect(acl.mode).toBe("rules");
    const inbound = acl.chains.find((chain) => chain.chainType === "Inbound")!;
    expect(inbound.defaultAction).toBe("Drop");
    expect(inbound.rules.map((rule) => rule.name)).toEqual(
      expect.arrayContaining(["web-db-in", "lan-db-in"]),
    );
    expect(inbound.rules.find((rule) => rule.name === "lan-db-in")).toMatchObject({
      sourceIps: ["192.168.55.0/24"],
      ports: ["8080"],
      action: "Allow",
      stateful: true,
    });
    // The destination device verifies the source tag group.
    expect(acl.group.members).toEqual(["tag:db"]);
    const outbound = acl.chains.find((chain) => chain.chainType === "Outbound")!;
    expect(outbound.defaultAction).toBe("Drop");
    // Reply rules are low priority and carry the service port as source port.
    expect(outbound.rules.find((rule) => rule.name === "web-db-reply-out")).toMatchObject({
      sourcePorts: ["5432"],
      action: "Allow",
    });
  });

  it("tests access from a raw LAN IP and names the deciding chain", async () => {
    const viaLan = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/test`,
      headers: headers(member),
      payload: {
        srcIp: "192.168.55.16",
        dstDeviceId: devices.db.id,
        port: 8080,
        protocol: "tcp",
      },
    });
    expect(viaLan.statusCode).toBe(200);
    const allowed = viaLan.json() as {
      reachability: {
        allowed: boolean;
        decidedBy: { hostname: string; chain: string } | null;
        trace: Array<{ chain: string; action: string; matchedRule: string | null }>;
      };
    };
    expect(allowed.reachability.allowed).toBe(true);
    expect(allowed.reachability.trace.at(-1)).toMatchObject({
      chain: "Inbound",
      action: "allow",
      matchedRule: "lan-db-in",
    });
    expect(allowed.reachability.decidedBy).toMatchObject({ hostname: "db" });

    // The same port from an unrelated address is denied.
    const denied = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/test`,
      headers: headers(member),
      payload: {
        srcIp: "10.99.0.1",
        dstDeviceId: devices.db.id,
        port: 8080,
        protocol: "tcp",
      },
    });
    expect(denied.statusCode).toBe(200);
    expect(
      (denied.json() as { reachability: { allowed: boolean } }).reachability.allowed,
    ).toBe(false);

    // A device source is validated as usual.
    const viaDevice = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/test`,
      headers: headers(member),
      payload: {
        srcDeviceId: devices.web1.id,
        dstDeviceId: devices.db.id,
        port: 5432,
        protocol: "tcp",
      },
    });
    expect(viaDevice.statusCode).toBe(200);
    expect(
      (viaDevice.json() as { reachability: { allowed: boolean } }).reachability.allowed,
    ).toBe(true);
  });

  it("switches open/rules without losing the document", async () => {
    const open = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/mode`,
      headers: headers(admin),
      payload: { mode: "open" },
    });
    expect(open.statusCode).toBe(200);
    expect((open.json() as { version: number }).version).toBe(0);

    const network = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}`,
      headers: authed(viewer),
    });
    expect(network.json()).toMatchObject({ policyVersion: 0, policyMode: "open" });

    const compiled = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/policy/compiled/${devices.db.id}`,
      headers: authed(viewer),
    });
    expect(compiled.json()).toMatchObject({ enabled: false, mode: "open", chains: [] });

    // Access tests are refused while open: nothing is enforced.
    const testWhileOpen = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/test`,
      headers: headers(member),
      payload: { srcDeviceId: devices.web1.id, dstDeviceId: devices.db.id },
    });
    expect(testWhileOpen.statusCode).toBe(409);

    const rules = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/policy/mode`,
      headers: headers(admin),
      payload: { mode: "rules" },
    });
    expect(rules.statusCode).toBe(200);
    expect((rules.json() as { version: number }).version).toBe(2);
    const restored = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/policy`,
      headers: authed(viewer),
    });
    expect(restored.json()).toMatchObject({ mode: "rules", version: 2 });
    expect((restored.json() as { rules: unknown[] }).rules).toHaveLength(3);
  });

  it("manages tags and user groups as separate collections", async () => {
    // Tags: create, bulk assign, counts, delete.
    const createdTag = await test.app.inject({
      method: "POST",
      url: "/api/tags",
      headers: headers(admin),
      payload: { name: "eu" },
    });
    expect(createdTag.statusCode).toBe(201);
    const tag = createdTag.json() as { id: string; name: string; subject: string };
    expect(tag).toMatchObject({ name: "eu", subject: "tag:eu" });
    const assigned = await test.app.inject({
      method: "PUT",
      url: `/api/tags/${tag.id}/devices`,
      headers: headers(member),
      payload: { deviceIds: [devices.web1.id, devices.db.id] },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({ deviceCount: 2 });
    const listed = await test.app.inject({
      method: "GET",
      url: "/api/tags",
      headers: authed(viewer),
    });
    expect(
      (listed.json() as Array<{ name: string; deviceCount: number }>).find(
        (entry) => entry.name === "eu",
      ),
    ).toMatchObject({ deviceCount: 2 });
    const deleted = await test.app.inject({
      method: "DELETE",
      url: `/api/tags/${tag.id}`,
      headers: headers(admin),
    });
    expect(deleted.statusCode).toBe(200);

    // User groups: manual CRUD; synced groups are read-only.
    const manual = await test.app.inject({
      method: "POST",
      url: "/api/user-groups",
      headers: headers(admin),
      payload: { name: "family", members: ["member@example.com"] },
    });
    expect(manual.statusCode).toBe(201);
    const group = manual.json() as { id: string; source: string; readOnly: boolean };
    expect(group).toMatchObject({ source: "manual", readOnly: false });
    const added = await test.app.inject({
      method: "POST",
      url: `/api/user-groups/${group.id}/members`,
      headers: headers(admin),
      payload: { email: "viewer@example.com" },
    });
    expect(added.statusCode).toBe(200);
    expect(
      (added.json() as { members: Array<{ email: string }> }).members.map(
        (entry) => entry.email,
      ).sort(),
    ).toEqual(["member@example.com", "viewer@example.com"]);
    const removed = await test.app.inject({
      method: "DELETE",
      url: `/api/user-groups/${group.id}/members/${encodeURIComponent("viewer@example.com")}`,
      headers: headers(admin),
    });
    expect(removed.statusCode).toBe(200);
    expect(
      (removed.json() as { members: Array<{ email: string }> }).members.map(
        (entry) => entry.email,
      ),
    ).toEqual(["member@example.com"]);

    const groups = await test.app.inject({
      method: "GET",
      url: "/api/user-groups",
      headers: authed(viewer),
    });
    const synced = (groups.json() as Array<{
      id: string;
      name: string;
      readOnly: boolean;
      source: string;
    }>).find((entry) => entry.name === "easyplane-members");
    expect(synced).toMatchObject({ source: "oidc", readOnly: true });
    const deleteSynced = await test.app.inject({
      method: "DELETE",
      url: `/api/user-groups/${encodeURIComponent(synced!.id)}`,
      headers: headers(admin),
    });
    expect(deleteSynced.statusCode).toBe(409); // virtual synced group, read-only
  });

  it("audits policy, tag and group changes without leaking secrets", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=200",
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    const dump = response.body;
    expect(dump).toContain("policy.version_created");
    expect(dump).toContain("policy.mode_changed");
    expect(dump).toContain("tag.created");
    expect(dump).toContain("user_group.created");
    expect(dump).not.toContain("groupSecret");
  });
});
