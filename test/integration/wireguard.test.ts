import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ManagedClient } from "@easyplane/server";
import { instance, manage } from "@easyplane/proto";

import {
  authed,
  createTestApp,
  loginWithMockIdp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

const HUB_MACHINE = "dddddddd-1111-4111-8111-111111111111";
const LEAF_MACHINE = "dddddddd-2222-4222-8222-222222222222";

interface FakeRun {
  instId: string;
  config: manage.NetworkConfig;
}

function fakeClient(name: string) {
  const state = {
    closed: false,
    runs: [] as FakeRun[],
    portal: undefined as instance.VpnPortalInfo | undefined,
  };
  const remote = {
    runNetworkInstance: async (request: { instId: string; config: manage.NetworkConfig }) => {
      state.runs.push({ instId: request.instId, config: request.config });
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
      config: state.runs.at(-1)?.config,
      source: manage.ConfigSource.ConfigSourceWeb,
    }),
    listNetworkInstanceMeta: async () => ({ metas: [] }),
    deleteNetworkInstance: async () => ({ remainInstIds: [] }),
    getVpnPortalInfo: async () => ({ vpnPortalInfo: state.portal }),
  };
  const client = {
    id: `${name}-session`,
    get isClosed() {
      return state.closed;
    },
    remote,
    close: () => {
      state.closed = true;
    },
    heartbeatCount: 1,
    transportKind: "ws",
    secure: true,
    remoteAddress: "127.0.0.1",
    latestHeartbeat: undefined,
  } as unknown as ManagedClient;
  return {
    client,
    get lastRun() {
      return state.runs.at(-1);
    },
    setPortal(info: instance.VpnPortalInfo | undefined) {
      state.portal = info;
    },
  };
}

async function waitFor<T>(
  fn: () => Promise<T | undefined> | T | undefined,
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

interface WireguardClientDto {
  id: string;
  networkId: string;
  hubDeviceId: string;
  hubHostname: string;
  name: string;
  virtualIpv4: string;
  tags: string[];
  state: string;
  endpoint: string | null;
  error: string | null;
}

interface DeviceDto {
  id: string;
  dnsName: string | null;
  virtualIpv4: string | null;
  isHub: boolean;
  wgListenPort: number | null;
  wireguardClientCount: number;
}

describe("WireGuard portal clients", () => {
  let test: TestApp;
  let admin: LoginResult;
  let member: LoginResult;
  let networkId = "";
  let hubId = "";
  let leafId = "";
  let token = "";
  const hub = fakeClient("hub");
  const leaf = fakeClient("leaf");

  function adminHeaders(extra: Record<string, string> = {}) {
    return authed(admin, { "x-csrf-token": admin.csrfToken, ...extra });
  }
  function memberHeaders(extra: Record<string, string> = {}) {
    return authed(member, { "x-csrf-token": member.csrfToken, ...extra });
  }

  async function enrol(machineId: string, hostname: string, client: ManagedClient) {
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
    const list = await test.app.inject({
      method: "GET",
      url: "/api/devices",
      headers: authed(admin),
    });
    const device = (list.json() as Array<{ id: string; machineId: string }>).find(
      (entry) => entry.machineId === machineId,
    );
    if (!device) throw new Error(`${hostname} was not enrolled`);
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/approve`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    return device.id;
  }

  async function getDevice(id: string): Promise<DeviceDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${id}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto;
  }

  async function listClients(): Promise<WireguardClientDto[]> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/wireguard-clients`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as WireguardClientDto[];
  }

  beforeAll(async () => {
    test = await createTestApp();
    admin = await loginWithMockIdp(test, "admin");
    member = await loginWithMockIdp(test, "member");

    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: adminHeaders(),
      payload: { name: "WG lab", ipv4Cidr: "10.144.146.0/24" },
    });
    expect(network.statusCode).toBe(201);
    networkId = (network.json() as { id: string }).id;

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(invite.statusCode).toBe(201);
    token = (invite.json() as { token: string }).token;

    hubId = await enrol(HUB_MACHINE, "wg-hub", hub.client);
    leafId = await enrol(LEAF_MACHINE, "wg-leaf", leaf.client);
    // Both devices must be out of `pending` before the hub can serve a portal.
    await waitFor(() => getDevice(hubId), (device) => device.virtualIpv4 !== null);

    const hubUpdate = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${hubId}/hub`,
      headers: adminHeaders(),
      payload: { isHub: true },
    });
    expect(hubUpdate.statusCode).toBe(200);

    for (const name of ["phone"]) {
      const tag = await test.app.inject({
        method: "POST",
        url: "/api/tags",
        headers: adminHeaders(),
        payload: { name },
      });
      expect([200, 201]).toContain(tag.statusCode);
    }
  });

  afterAll(async () => {
    await test.stop();
  });

  it("enables the portal on an approved hub and records the port", async () => {
    const response = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${hubId}/wireguard-portal`,
      headers: adminHeaders(),
      payload: { enabled: true, port: 11013 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true, port: 11013, clientCount: 0 });
    const device = await getDevice(hubId);
    expect(device.wgListenPort).toBe(11013);
  });

  it("refuses a portal on a device that is not a hub", async () => {
    const response = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${leafId}/wireguard-portal`,
      headers: adminHeaders(),
      payload: { enabled: true },
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe(
      "wireguard_portal_hub_required",
    );
  });

  it("creates a client, allocates an address and pushes it to the hub only", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/wireguard-clients`,
      headers: adminHeaders(),
      payload: { name: "phone", tags: ["tag:phone"] },
    });
    expect(response.statusCode).toBe(201);
    const client = response.json() as WireguardClientDto;
    expect(client).toMatchObject({
      name: "phone",
      hubDeviceId: hubId,
      hubHostname: "wg-hub",
      tags: ["tag:phone"],
      state: "unknown",
    });
    // Devices took .2 and .3; the client gets the next pool address.
    expect(client.virtualIpv4).toBe("10.144.146.4");

    const pushed = await waitFor(
      () => hub.lastRun,
      (run) => (run.config.vpnPortalConfig?.clients.length ?? 0) > 0,
    );
    expect(pushed.config.vpnPortalConfig?.wireguardListen).toBe("0.0.0.0:11013");
    expect(pushed.config.vpnPortalConfig?.wireguardPrivateKey?.length).toBeGreaterThan(0);
    expect(pushed.config.vpnPortalConfig?.clients).toEqual([
      { name: "phone", virtualIp: "10.144.146.4", groups: [] },
    ]);
    // No ACL is active, so the client's tag is not declared and must not be
    // sent as a group (upstream rejects undeclared groups).
    expect((await getDevice(hubId)).wireguardClientCount).toBe(1);
    // Other devices must not carry a portal.
    expect(leaf.lastRun?.config.vpnPortalConfig).toBeUndefined();
    expect((await listClients()).map((entry) => entry.name)).toEqual(["phone"]);
  });

  it("validates names and tags and prevents duplicates", async () => {
    const invalidName = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/wireguard-clients`,
      headers: adminHeaders(),
      payload: { name: "Bad Name" },
    });
    expect(invalidName.statusCode).toBe(400);

    const duplicate = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/wireguard-clients`,
      headers: adminHeaders(),
      payload: { name: "phone" },
    });
    expect(duplicate.statusCode).toBe(409);

    const unknownTag = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/wireguard-clients`,
      headers: adminHeaders(),
      payload: { name: "tablet", tags: ["tag:nope"] },
    });
    expect(unknownTag.statusCode).toBe(400);

    const shadowDevice = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/wireguard-clients`,
      headers: adminHeaders(),
      payload: { name: "wg-leaf" },
    });
    expect(shadowDevice.statusCode).toBe(409);
  });

  it("renames and re-tags a client without touching other devices", async () => {
    const [client] = await listClients();
    const renamed = await test.app.inject({
      method: "PUT",
      url: `/api/wireguard-clients/${client!.id}/name`,
      headers: adminHeaders(),
      payload: { name: "phone-maxim" },
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as WireguardClientDto).name).toBe("phone-maxim");

    const tagged = await test.app.inject({
      method: "PUT",
      url: `/api/wireguard-clients/${client!.id}/tags`,
      headers: memberHeaders(),
      payload: { tags: ["tag:phone"] },
    });
    expect(tagged.statusCode).toBe(200);
    expect((tagged.json() as WireguardClientDto).tags).toEqual(["tag:phone"]);

    await waitFor(
      () => hub.lastRun,
      (run) =>
        run.config.vpnPortalConfig?.clients.some(
          (entry) => entry.name === "phone-maxim",
        ) === true,
    );
  });

  it("serves the config to admins only, uncached, with a download variant", async () => {
    const [client] = await listClients();
    hub.setPortal({
      vpnType: "wireguard",
      clientConfig: "",
      connectedClients: [],
      listener: "wg://0.0.0.0:11013",
      clients: [
        {
          name: "phone-maxim",
          virtualIp: "10.144.146.4",
          groups: ["tag:phone"],
          state: instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_ONLINE,
          peerId: 7,
          endpoint: "198.51.100.9:51820",
          tunnelIp: "100.64.0.2",
          clientConfig: "[Interface]\nPrivateKey = topsecret\nAddress = 100.64.0.2/32\n",
          error: undefined,
        },
      ],
    });

    const forbidden = await test.app.inject({
      method: "GET",
      url: `/api/wireguard-clients/${client!.id}/config`,
      headers: authed(member),
    });
    expect(forbidden.statusCode).toBe(403);

    const response = await test.app.inject({
      method: "GET",
      url: `/api/wireguard-clients/${client!.id}/config`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json() as { config: string; filename: string };
    expect(body.config).toContain("PrivateKey");
    expect(body.filename).toBe("phone-maxim.conf");

    const download = await test.app.inject({
      method: "GET",
      url: `/api/wireguard-clients/${client!.id}/config/download`,
      headers: authed(admin),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("text/plain");
    expect(download.headers["cache-control"]).toBe("no-store");
    expect(download.headers["content-disposition"]).toContain(
      'filename="phone-maxim.conf"',
    );
    expect(download.body).toContain("[Interface]");
  });

  it("collects live portal status from the hub", async () => {
    const hubDevice = await test.context.devices.requireDevice(
      test.context.organisation.id,
      hubId,
    );
    await test.context.wireguard.collectStatuses(hubDevice, hub.client);
    await waitFor(
      async () => (await listClients())[0],
      (client) => client.state === "online" && client.endpoint !== null,
    );
    const [client] = await listClients();
    expect(client).toMatchObject({
      state: "online",
      endpoint: "198.51.100.9:51820",
      tunnelIp: "100.64.0.2",
    });
  });

  it("compiles the client's tag into the ACL and declares it on the hub", async () => {
    const policy = await test.app.inject({
      method: "PUT",
      url: `/api/networks/${networkId}/policy`,
      headers: adminHeaders(),
      payload: {
        document: {
          version: 2,
          mode: "rules",
          rules: [
            {
              name: "phone-to-leaf",
              action: "allow",
              from: ["tag:phone"],
              to: ["device:wg-leaf"],
              protocol: "tcp",
              ports: ["22"],
            },
          ],
        },
      },
    });
    expect(policy.statusCode).toBe(200);

    const pushed = await waitFor(
      () => leaf.lastRun,
      (run) => (run.config.acl?.aclV1?.chains.length ?? 0) > 0,
    );
    const inbound = pushed.config.acl?.aclV1?.chains.find(
      (chain) => chain.name === "easyplane-inbound",
    );
    const rule = inbound?.rules.find((entry) => entry.name === "phone-to-leaf-in");
    expect(rule?.sourceIps).toEqual(["10.144.146.4/32"]);

    const hubPushed = await waitFor(
      () => hub.lastRun,
      (run) =>
        (run.config.vpnPortalConfig?.clients[0]?.groups.length ?? 0) > 0,
    );
    expect(hubPushed.config.vpnPortalConfig?.clients[0]).toEqual({
      name: "phone-maxim",
      virtualIp: "10.144.146.4",
      groups: ["tag:phone"],
    });
    const declared = (hubPushed.config.acl?.aclV1?.group?.declares ?? []).map(
      (entry) => entry.groupName,
    );
    expect(declared).toContain("tag:phone");
  });

  it("blocks disabling the portal while clients exist, then releases the address", async () => {
    const blocked = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${hubId}/wireguard-portal`,
      headers: adminHeaders(),
      payload: { enabled: false },
    });
    expect(blocked.statusCode).toBe(409);
    expect((blocked.json() as { code: string }).code).toBe(
      "wireguard_portal_has_clients",
    );

    const [client] = await listClients();
    const removed = await test.app.inject({
      method: "DELETE",
      url: `/api/wireguard-clients/${client!.id}`,
      headers: memberHeaders(),
    });
    expect(removed.statusCode).toBe(200);
    expect(await listClients()).toEqual([]);

    // The freed address is handed out again (no leak in the shared pool).
    const recreated = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/wireguard-clients`,
      headers: adminHeaders(),
      payload: { name: "phone", tags: ["tag:phone"] },
    });
    expect(recreated.statusCode).toBe(201);
    expect((recreated.json() as WireguardClientDto).virtualIpv4).toBe(
      "10.144.146.4",
    );

    // Delete it again so the portal can be turned off.
    const [again] = await listClients();
    await test.app.inject({
      method: "DELETE",
      url: `/api/wireguard-clients/${again!.id}`,
      headers: memberHeaders(),
    });
    const disabled = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${hubId}/wireguard-portal`,
      headers: adminHeaders(),
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect((await getDevice(hubId)).wgListenPort).toBeNull();
    await waitFor(
      () => hub.lastRun,
      (run) => run.config.vpnPortalConfig === undefined,
    );
  });
});
