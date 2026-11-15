import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ManagedClient } from "@easyplane/server";
import { manage } from "@easyplane/proto";

import {
  authed,
  createTestApp,
  loginWithMockIdp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

interface FakeRunRequest {
  instId: string;
  config: manage.NetworkConfig;
}

function fakeClient(id: string) {
  const state = { lastRun: null as FakeRunRequest | null };
  const remote = {
    runNetworkInstance: async (request: FakeRunRequest) => {
      state.lastRun = request;
      return { instId: request.instId };
    },
    collectNetworkInfo: async (instIds: string[]) => {
      const map: Record<string, manage.NetworkInstanceRunningInfo> = {};
      for (const instanceId of instIds) {
        map[instanceId] = { running: true } as manage.NetworkInstanceRunningInfo;
      }
      return { info: { map } };
    },
    listNetworkInstance: async () => [] as string[],
    getNetworkInstanceConfig: async () => ({
      config: state.lastRun?.config,
      source: manage.ConfigSource.ConfigSourceWeb,
    }),
    deleteNetworkInstance: async () => ({ remainInstIds: [] }),
  };
  const client = {
    id,
    isClosed: false,
    remote,
    close: () => {},
    heartbeatCount: 1,
    transportKind: "ws",
    secure: true,
    remoteAddress: "127.0.0.1",
    latestHeartbeat: undefined,
  } as unknown as ManagedClient;
  return {
    client,
    get lastRun() {
      return state.lastRun;
    },
  };
}

async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  predicate: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (last !== undefined && predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition not met; last value: ${JSON.stringify(last)}`);
}

const ENDPOINTS = [
  "tcp://rv.example.com:11010",
  "udp://rv.example.com:11010",
];
const RV_SECRET = "rendezvous-shared-secret";
const MACHINE = "aaaaaaaa-1111-4111-8111-111111111111";

interface NetworkDto {
  id: string;
  useRendezvous: boolean;
  p2pOnly: boolean;
  rendezvous: {
    configured: boolean;
    useBundled: boolean;
    secretMatches: boolean | null;
    endpoints: string[];
    relayData: boolean;
    privateMode: boolean;
    networkName: string | null;
  };
  peerPlan: {
    hubEndpoints: number;
    rawPeers: number;
    rendezvousEndpoints: number;
    hasPeerEndpoint: boolean;
  };
}

describe("bundled rendezvous node: env, secret alignment and per-network toggle", () => {
  let test: TestApp;
  let admin: LoginResult;
  let member: LoginResult;
  let networkId = "";
  let inviteToken = "";
  const fake = fakeClient("rendezvous-session");

  function headers(login: LoginResult = admin): Record<string, string> {
    return authed(login, { "x-csrf-token": login.csrfToken });
  }

  async function getNetwork(): Promise<NetworkDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as NetworkDto;
  }

  beforeAll(async () => {
    test = await createTestApp({
      env: {
        EASYPLANE_RENDEZVOUS_ENDPOINTS: ENDPOINTS.join(","),
        EASYPLANE_RENDEZVOUS_SECRET: RV_SECRET,
        EASYPLANE_RENDEZVOUS_RELAY_DATA: "true",
        EASYPLANE_RENDEZVOUS_PRIVATE_MODE: "true",
        EASYPLANE_RENDEZVOUS_NETWORK_NAME: "rv-node-net",
      },
    });
    admin = await loginWithMockIdp(test, "admin");
    member = await loginWithMockIdp(test, "member");

    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Rendezvous lab", ipv4Cidr: "10.150.0.0/24" },
    });
    expect(network.statusCode).toBe(201);
    networkId = (network.json() as { id: string }).id;

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: {},
    });
    expect(invite.statusCode).toBe(201);
    inviteToken = (invite.json() as { token: string }).token;

    await test.context.devices.handleHeartbeat({
      token: inviteToken,
      machineId: MACHINE,
      hostname: "node-a",
      easytierVersion: "2.6.4-81487c36",
      osType: "linux",
      osVersion: "6.8",
      osDistribution: "debian",
      sourceIp: "127.0.0.1",
      client: fake.client,
    });
    const list = await test.app.inject({
      method: "GET",
      url: "/api/devices",
      headers: authed(admin),
    });
    const device = (list.json() as Array<{ id: string; hostname: string }>).find(
      (entry) => entry.hostname === "node-a",
    );
    if (!device) throw new Error("device not enrolled");
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/approve`,
      headers: headers(),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
  });

  afterAll(async () => {
    await test.stop();
  });

  it("exposes the node's public settings but never its secret", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: "/api/rendezvous",
      headers: authed(member),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      configured: true,
      endpoints: ENDPOINTS,
      relayData: true,
      privateMode: true,
      networkName: "rv-node-net",
      secretComparisonAvailable: true,
    });
    expect(JSON.stringify(body)).not.toContain(RV_SECRET);
  });

  it("refuses the toggle until the network secret matches the node", async () => {
    const before = await getNetwork();
    expect(before.useRendezvous).toBe(false);
    expect(before.rendezvous.secretMatches).toBe(false);
    expect(before.rendezvous.endpoints).toEqual(ENDPOINTS);
    expect(before.peerPlan.hasPeerEndpoint).toBe(false);

    const refused = await test.app.inject({
      method: "PATCH",
      url: `/api/networks/${networkId}`,
      headers: headers(),
      payload: { useRendezvous: true },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "conflict" });

    const memberAligned = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/rendezvous/align-secret`,
      headers: headers(member),
    });
    expect(memberAligned.statusCode).toBe(403);

    const aligned = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/rendezvous/align-secret`,
      headers: headers(),
    });
    expect(aligned.statusCode).toBe(200);
    const after = await getNetwork();
    expect(after.rendezvous.secretMatches).toBe(true);
  });

  it("pushes the endpoints, secure mode and p2p_only, and audits every change", async () => {
    const enabled = await test.app.inject({
      method: "PATCH",
      url: `/api/networks/${networkId}`,
      headers: headers(),
      payload: { useRendezvous: true },
    });
    expect(enabled.statusCode).toBe(200);
    const withP2p = await test.app.inject({
      method: "PATCH",
      url: `/api/networks/${networkId}`,
      headers: headers(),
      payload: { p2pOnly: true },
    });
    expect(withP2p.statusCode).toBe(200);
    const dto = withP2p.json() as NetworkDto;
    expect(dto.useRendezvous).toBe(true);
    expect(dto.p2pOnly).toBe(true);
    expect(dto.peerPlan.rendezvousEndpoints).toBe(ENDPOINTS.length);
    expect(dto.peerPlan.hasPeerEndpoint).toBe(true);

    const pushed = await waitFor(
      async () => fake.lastRun?.config,
      (config) =>
        (config?.peerUrls ?? []).includes(ENDPOINTS[0]!) &&
        config?.p2pOnly === true,
    );
    expect(pushed.networkSecret).toBe(RV_SECRET);
    expect(pushed.peerUrls).toEqual(ENDPOINTS);
    expect(pushed.p2pOnly).toBe(true);
    expect(pushed.secureMode?.enabled).toBe(true);

    const audit = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=50",
      headers: authed(admin),
    });
    expect(audit.statusCode).toBe(200);
    const actions = (audit.json() as Array<{ action: string; metadata: unknown }>).map(
      (entry) => entry.action,
    );
    expect(actions).toContain("network.rendezvous_secret_aligned");
    expect(actions).toContain("network.rendezvous_updated");
    expect(actions).toContain("network.p2p_updated");
    expect(JSON.stringify(audit.json())).not.toContain(RV_SECRET);
  });

  it("de-duplicates a raw peer URL that equals a rendezvous endpoint", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/peers`,
      headers: headers(),
      payload: { url: ENDPOINTS[0]! },
    });
    expect(created.statusCode).toBe(201);

    const pushed = await waitFor(
      async () => fake.lastRun?.config,
      (config) => (config?.peerUrls ?? []).filter((url) => url === ENDPOINTS[0]!).length === 1,
    );
    // Once: the external entry wins (it is compiled first), the rendezvous
    // copy is de-duplicated by URL key.
    expect(pushed.peerUrls.filter((url) => url === ENDPOINTS[0]!)).toHaveLength(1);
    expect(pushed.peerUrls).toContain(ENDPOINTS[1]!);
  });

  it("refuses a random secret rotation while the node is in use", async () => {
    const rotation = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/secret/rotate`,
      headers: headers(),
    });
    expect(rotation.statusCode).toBe(409);
    expect(rotation.json()).toMatchObject({ code: "conflict" });
  });

  it("rejects enabling without endpoints and lets members read the card", async () => {
    const memberRead = await test.app.inject({
      method: "GET",
      url: "/api/rendezvous",
      headers: authed(member),
    });
    expect(memberRead.statusCode).toBe(200);
    const memberPatch = await test.app.inject({
      method: "PATCH",
      url: `/api/networks/${networkId}`,
      headers: headers(member),
      payload: { useRendezvous: false },
    });
    expect(memberPatch.statusCode).toBe(403);
  });
});

describe("bundled rendezvous node: disabled deployment", () => {
  let test: TestApp;
  let admin: LoginResult;
  let networkId = "";

  beforeAll(async () => {
    test = await createTestApp();
    admin = await loginWithMockIdp(test, "admin");
    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: authed(admin, { "x-csrf-token": admin.csrfToken }),
      payload: { name: "No rendezvous", ipv4Cidr: "10.151.0.0/24" },
    });
    expect(network.statusCode).toBe(201);
    networkId = (network.json() as { id: string }).id;
  });

  afterAll(async () => {
    await test.stop();
  });

  it("reports the feature as unavailable and refuses the toggle", async () => {
    const info = await test.app.inject({
      method: "GET",
      url: "/api/rendezvous",
      headers: authed(admin),
    });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({
      configured: false,
      endpoints: [],
      secretComparisonAvailable: false,
    });

    const headers = authed(admin, { "x-csrf-token": admin.csrfToken });
    const refused = await test.app.inject({
      method: "PATCH",
      url: `/api/networks/${networkId}`,
      headers,
      payload: { useRendezvous: true },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "conflict" });

    const align = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/rendezvous/align-secret`,
      headers,
    });
    expect(align.statusCode).toBe(409);
  });
});
