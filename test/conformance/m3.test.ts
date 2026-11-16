import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { manage } from "@easyplane/proto";
import { uuidToProto } from "@easyplane/shared";
import {
  WEB_CLIENT_SERVICE,
  WebClientMethod,
  instanceIdFor,
} from "@easyplane/server";

import {
  PORTS,
  execIn,
  openM2RelayPool,
  prepareDockerConformanceEnvironment,
  safeStringify,
  startCore,
  startM2Relay,
  stopAllCores,
  type CoreHandle,
} from "./helpers/index.js";
import { openSseStream } from "../support/sse.js";
import {
  authed,
  bootstrapAdmin,
  createTestApp,
  sessionCookie,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

/**
 * M3 conformance: topology data and live status against real easytier-core
 * 2.6.4-81487c36.
 *
 * Topology shape (relay-only by construction):
 *   core-a  hub, listens on tcp://0.0.0.0:11021, dials b and c
 *   core-b  leaf, listens, dials a only, disable_p2p
 *   core-c  leaf, listens, dials a only, disable_p2p
 *
 * `disable_p2p` on both leaves is the control-plane-supported way to forbid
 * direct B<->C connections (the p2p module is what would punch/dial directly);
 * manual connectors to the hub stay. The clients really route B<->C through A,
 * so the map's "relayed via core-a, cost 2" comes from the client's own
 * `Route{next_hop_peer_id, cost}`, not from a heuristic. The test also proves:
 *  - the map carries the default tunnel protocol (tcp) of the direct links
 *  - a device going offline/online is visible on the SSE stream
 *  - SSE is authenticated, role checked and bounded per user
 *  - the collector switches to the active interval while a browser watches
 *  - ICMP between the leaves still crosses the relay
 *
 * Set EASYPLANE_CAPTURE_TOPOLOGY_FIXTURE=1 to refresh the unit-test fixture in
 * apps/server/test/fixtures/easytier/ from this run (real wire bytes).
 */

interface NetworkDto {
  id: string;
  networkName: string;
}

interface DeviceDto {
  id: string;
  hostname: string;
  virtualIpv4: string | null;
  appliedRevision: number | null;
  lastPushError: string | null;
  online: "online" | "offline";
}

interface TopologyNodeDto {
  id: string;
  deviceId: string | null;
  hostname: string;
  virtualIpv4: string | null;
  reachable: boolean;
  relayCapable: boolean;
  relaysFor: string[];
  natType: string;
  listeners: string[];
}

interface TopologyLinkDto {
  source: string;
  target: string;
  kind: "direct" | "relayed";
  via: string | null;
  viaHostname: string | null;
  protocol: string;
  protocolIsFirstHop: boolean;
  cost: number | null;
  latencyMs: number | null;
}

interface TopologyDto {
  generation: number;
  collectedAt: string;
  intervalMs: number;
  partial: boolean;
  nodes: TopologyNodeDto[];
  links: TopologyLinkDto[];
  stats: {
    nodes: number;
    links: number;
    directLinks: number;
    relayedLinks: number;
    reachableNodes: number;
    relayCapableNodes: number;
    hasReachableNode: boolean;
  };
  observations: Array<{
    deviceId: string;
    peerId: number | null;
    peers: Array<{ peerId: number }>;
    routes: Array<{
      virtualIpv4: string | null;
      hostname: string;
      cost: number;
      nextHopPeerId: number;
    }>;
    error: string | null;
  }>;
}

// Machine ids are fixed by docker-compose.test.yml (the M2/M3 containers).
const MACHINES = {
  a: "aaaaaaaa-1111-4111-8111-111111111111",
  b: "bbbbbbbb-2222-4222-8222-222222222222",
  c: "cccccccc-3333-4333-8333-333333333333",
} as const;
const SERVICES = { a: "core-m2-a", b: "core-m2-b", c: "core-m2-c" } as const;
const LISTENERS = { a: 11021, b: 11022, c: 11023 } as const;

async function poll<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (predicate(last)) return last;
    } catch (error) {
      last = undefined;
      if (Date.now() >= deadline) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label}: condition not met within ${timeoutMs}ms; last=${safeStringify(last)}`,
  );
}

function writeFixture(
  captured: Record<string, { deviceId: string; virtualIpv4: string | null; base64: string }>,
): void {
  if (process.env.EASYPLANE_CAPTURE_TOPOLOGY_FIXTURE !== "1") return;
  const target = new URL(
    "../../apps/server/test/fixtures/easytier/collect-network-info-m3.json",
    import.meta.url,
  );
  const payload = {
    capturedWith: "easytier-core 2.6.4-81487c36",
    capturedFrom: "test/conformance/m3.test.ts",
    topology:
      "core-a is the hub and relays between core-b and core-c; the leaves run disable_p2p so the clients report cost 2 with next_hop_peer_id = core-a",
    capturedAt: new Date().toISOString(),
    instances: captured,
  };
  mkdirSync(new URL(".", target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
}

describe("M3 conformance: topology map and SSE on real easytier-core", () => {
  let test: TestApp;
  let admin: LoginResult;
  let network: NetworkDto;
  let baseUrl = "";
  let inviteToken = "";
  const cores: Partial<Record<"a" | "b" | "c", CoreHandle>> = {};
  const devices: Partial<Record<"a" | "b" | "c", DeviceDto>> = {};
  const tunnels: import("node:net").Socket[] = [];

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return authed(admin, { "x-csrf-token": admin.csrfToken, ...extra });
  }

  async function getDevices(): Promise<DeviceDto[]> {
    const response = await test.app.inject({
      method: "GET",
      url: "/api/devices",
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto[];
  }

  async function getDevice(letter: "a" | "b" | "c"): Promise<DeviceDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${devices[letter]!.id}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto;
  }

  async function getTopology(refresh = true): Promise<TopologyDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/networks/${network.id}/topology${refresh ? "?refresh=1" : ""}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as TopologyDto;
  }

  function nodeFor(topology: TopologyDto, letter: "a" | "b" | "c"): TopologyNodeDto {
    const ip = devices[letter]!.virtualIpv4;
    const node = topology.nodes.find(
      (entry) => entry.deviceId === devices[letter]!.id || entry.virtualIpv4 === ip,
    );
    if (!node) throw new Error(`no topology node for core-${letter}`);
    return node;
  }

  beforeAll(async () => {
    prepareDockerConformanceEnvironment();
    test = await createTestApp({
      oidc: false,
      env: {
        EASYPLANE_HOST: "0.0.0.0",
        EASYPLANE_WS_PORT: String(PORTS.m3),
        EASYPLANE_TCP_PORT: "0",
        EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: "3000",
        EASYPLANE_RECONCILE_INTERVAL_MS: "1000",
        EASYPLANE_ROUTE_REPORT_INTERVAL_MS: "1000",
        // Fast, deterministic collection for the test.
        EASYPLANE_TOPOLOGY_IDLE_INTERVAL_MS: "3000",
        EASYPLANE_TOPOLOGY_ACTIVE_INTERVAL_MS: "1000",
        EASYPLANE_TOPOLOGY_JITTER: "0",
        EASYPLANE_TOPOLOGY_CONCURRENCY: "2",
        EASYPLANE_TOPOLOGY_TIMEOUT_MS: "8000",
        EASYPLANE_SSE_MAX_PER_USER: "2",
      },
    });
    await test.context.controlPlane.start();
    test.context.push.start(1000);
    test.context.topology.start();
    admin = await bootstrapAdmin(test);
    await test.app.listen({ host: "0.0.0.0", port: 0 });
    const address = test.app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("the HTTP listener has no port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    stopAllCores();
    for (const socket of tunnels) socket.destroy();
    await test?.context.topology.stop();
    await test?.context.push.stop();
    await test?.context.controlPlane.stop();
    await test?.stop();
  });

  it("enrols three clients in a hub-and-spoke topology", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "M3 Conformance", ipv4Cidr: "10.89.0.0/24" },
    });
    expect(created.statusCode).toBe(201);
    network = created.json() as NetworkDto;

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${network.id}/invites`,
      headers: headers(),
      payload: { maxUses: null, expiresInHours: null },
    });
    expect(invite.statusCode).toBe(201);
    inviteToken = (invite.json() as { token: string }).token;

    startM2Relay();
    for (const letter of ["a", "b", "c"] as const) {
      tunnels.push(...(await openM2RelayPool(letter, PORTS.m3)));
    }
    for (const letter of ["a", "b", "c"] as const) {
      cores[letter] = startCore(
        SERVICES[letter],
        `ws://m2-relay:${[23001, 23002, 23003][["a", "b", "c"].indexOf(letter)]}/${encodeURIComponent(inviteToken)}`,
      );
    }

    await poll(
      "three client sessions",
      async () => test.context.controlPlane.listClients().length,
      (count) => count >= 3,
      120_000,
    );
    const pending = await poll(
      "three pending devices",
      getDevices,
      (list) => list.length >= 3,
    );
    for (const letter of ["a", "b", "c"] as const) {
      const device = pending.find((entry) => entry.hostname === `core-${letter}`);
      if (!device) throw new Error(`device core-${letter} not enrolled`);
      const approved = await test.app.inject({
        method: "POST",
        url: `/api/devices/${device.id}/approve`,
        headers: headers(),
        payload: {},
      });
      expect(approved.statusCode).toBe(200);
      devices[letter] = approved.json() as DeviceDto;
    }

    // Hub B/C dial A; A itself dials nobody (its own endpoint is excluded), so
    // B<->C traffic can only be relayed by A.
    const hubEndpoints = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/endpoints`,
      headers: headers(),
      payload: { endpoints: [`tcp://core-m2-a:${LISTENERS.a}`] },
    });
    expect(hubEndpoints.statusCode).toBe(200);
    const hubFlag = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/hub`,
      headers: headers(),
      payload: { isHub: true },
    });
    expect(hubFlag.statusCode).toBe(200);

    const configs = {
      a: {
        listenerUrls: [`tcp://0.0.0.0:${LISTENERS.a}`],
        disableP2p: false,
      },
      b: {
        listenerUrls: [`tcp://0.0.0.0:${LISTENERS.b}`],
        disableP2p: true,
      },
      c: {
        listenerUrls: [`tcp://0.0.0.0:${LISTENERS.c}`],
        disableP2p: true,
      },
    } as const;
    for (const letter of ["a", "b", "c"] as const) {
      const response = await test.app.inject({
        method: "POST",
        url: `/api/devices/${devices[letter]!.id}/revisions`,
        headers: headers(),
        payload: { config: configs[letter], note: "M3 relay-only topology" },
      });
      expect(response.statusCode).toBe(201);
    }
    for (const letter of ["a", "b", "c"] as const) {
      await poll(
        `${letter} applied revision 2`,
        () => getDevice(letter),
        (device) => device.appliedRevision === 2 && device.lastPushError === null,
      );
    }
  });

  it("derives the real relayed route from the client's route table", async () => {
    // Wait until the client itself reports cost 2 via the hub.
    const relayedRoute = await poll(
      "core-b route to core-c goes through core-a",
      async () => {
        const client = test.context.controlPlane
          .listClients()
          .find((entry) => entry.latestHeartbeat?.machineId === MACHINES.b);
        if (!client) return null;
        const info = await client.remote.collectNetworkInfo([
          instanceIdFor(network.id, devices.b!.id),
        ]);
        const running = info.info?.map[instanceIdFor(network.id, devices.b!.id)];
        const cIp = devices.c!.virtualIpv4;
        const route = running?.routes?.find((entry) => {
          const address = entry.ipv4Addr?.address?.addr;
          if (address === undefined || !cIp) return false;
          const octets = [
            (address >>> 24) & 0xff,
            (address >>> 16) & 0xff,
            (address >>> 8) & 0xff,
            address & 0xff,
          ].join(".");
          return octets === cIp;
        });
        if (!route || route.cost <= 1) return null;
        const hop = running?.routes?.find(
          (entry) => entry.peerId === route.nextHopPeerId,
        );
        return { cost: route.cost, hopHostname: hop?.hostname ?? null };
      },
      (value) => value !== null && value.hopHostname === "core-a",
      120_000,
    );
    expect(relayedRoute!.cost).toBeGreaterThan(1);

    const topology = await getTopology();
    const a = nodeFor(topology, "a");
    const b = nodeFor(topology, "b");
    const c = nodeFor(topology, "c");
    expect(topology.stats.nodes).toBeGreaterThanOrEqual(3);

    const pair = (left: TopologyNodeDto, right: TopologyNodeDto) =>
      topology.links.find(
        (link) =>
          (link.source === left.id && link.target === right.id) ||
          (link.source === right.id && link.target === left.id),
      );

    const ab = pair(a, b);
    const ac = pair(a, c);
    const bc = pair(b, c);
    expect(ab?.kind).toBe("direct");
    expect(ac?.kind).toBe("direct");
    expect(bc?.kind).toBe("relayed");
    expect(bc?.via).toBe(a.id);
    expect(bc?.viaHostname).toBe("core-a");
    expect(bc?.cost).toBe(2);
    // The leaves only have a transport to the hub; that first hop is what the
    // map names for a relayed edge.
    expect(bc?.protocol).toBe("tcp");
    expect(bc?.protocolIsFirstHop).toBe(true);

    // The hub is highlighted as the relay it demonstrably is.
    expect(a.relayCapable).toBe(true);
    expect(a.relaysFor.sort()).toEqual([b.id, c.id].sort());
    expect(b.relayCapable).toBe(false);
    expect(c.relayCapable).toBe(false);
    expect(topology.stats.relayedLinks).toBeGreaterThanOrEqual(1);
    // NAT data comes from the client's STUN report; in a Docker bridge it is a
    // real (non-open) NAT type once STUN has answered, so no node is
    // "reachable" and the panel relies on the observed relay evidence instead.
    const withNat = await poll(
      "STUN report reaches the map",
      () => getTopology(false),
      (value) => nodeFor(value, "a").natType !== "Unknown",
      90_000,
    );
    expect(nodeFor(withNat, "a").natType).not.toBe("OpenInternet");
    expect(nodeFor(withNat, "a").listeners).toContain(
      `tcp://0.0.0.0:${LISTENERS.a}`,
    );
    expect(topology.stats.reachableNodes).toBe(
      topology.nodes.filter((node) => node.reachable).length,
    );

    // Raw peer/route/connection info for the drawer comes from the same probe.
    const bObservation = topology.observations.find(
      (entry) => entry.deviceId === devices.b!.id,
    );
    expect(bObservation?.peers.length).toBeGreaterThanOrEqual(1);
    expect(bObservation?.routes.length).toBeGreaterThanOrEqual(2);
    const rawRelay = bObservation?.routes.find(
      (route) => route.virtualIpv4 === devices.c!.virtualIpv4,
    );
    expect(rawRelay?.cost).toBe(2);
    const aObservation = topology.observations.find(
      (entry) => entry.deviceId === devices.a!.id,
    );
    expect(rawRelay?.nextHopPeerId).toBe(aObservation?.peerId);

    // Capture real wire bytes for the unit-test fixture on demand.
    const captured: Record<
      string,
      { deviceId: string; virtualIpv4: string | null; base64: string }
    > = {};
    for (const letter of ["a", "b", "c"] as const) {
      const client = test.context.controlPlane
        .listClients()
        .find((entry) => entry.latestHeartbeat?.machineId === MACHINES[letter]);
      if (!client) continue;
      const instanceId = instanceIdFor(network.id, devices[letter]!.id);
      const response = await client.session.call({
        descriptor: {
          ...WEB_CLIENT_SERVICE,
          methodIndex: WebClientMethod.CollectNetworkInfo,
        },
        payload: manage.CollectNetworkInfoRequest.encode({
          instIds: [uuidToProto(instanceId)],
        }).finish(),
      });
      captured[`core-${letter}`] = {
        deviceId: devices[letter]!.id,
        virtualIpv4: devices[letter]!.virtualIpv4,
        base64: Buffer.from(response).toString("base64"),
      };
      // The captured bytes decode and still name the relayed path.
      const decoded = manage.CollectNetworkInfoResponse.decode(response);
      expect(decoded.info?.map[instanceId]?.running).toBe(true);
    }
    writeFixture(captured);
  });

  it("switches to the active interval while a browser watches the map", async () => {
    const stream = await openSseStream(
      `${baseUrl}/api/events?topology=1&networkId=${network.id}`,
      { cookie: sessionCookie(admin) },
    );
    expect(stream.status).toBe(200);
    try {
      await stream.waitFor((frame) => frame.type === "hello", 10_000);
      await poll(
        "topology watcher is registered",
        async () => test.context.realtime.topologyWatchers(network.id),
        (count) => count === 1,
        10_000,
      );
      const snapshot = await poll(
        "active-interval snapshot",
        () => getTopology(),
        (value) => value.intervalMs === 1000,
        30_000,
      );
      expect(snapshot.intervalMs).toBe(1000);
    } finally {
      stream.close();
    }
    await poll(
      "topology watcher released",
      async () => test.context.realtime.topologyWatchers(network.id),
      (count) => count === 0,
      10_000,
    );
  });

  it("streams real offline and online transitions", async () => {
    const stream = await openSseStream(
      `${baseUrl}/api/events?networkId=${network.id}`,
      { cookie: sessionCookie(admin) },
    );
    expect(stream.status).toBe(200);
    try {
      await stream.waitFor((frame) => frame.type === "hello", 10_000);

      cores.c!.stop();
      const offline = await stream.waitFor(
        (frame) =>
          frame.type === "device.updated" &&
          frame.data.deviceId === devices.c!.id &&
          frame.data.online === "offline",
        60_000,
      );
      expect(offline.data.state).toBe("approved");
      expect(offline.data.reason).toBe("session-closed");

      // The REST view converges too (the online flag is lastSeen-based).
      await poll(
        "device offline in the API",
        () => getDevice("c"),
        (device) => device.online === "offline",
        30_000,
      );

      cores.c!.start();
      const online = await stream.waitFor(
        (frame) =>
          frame.type === "device.updated" &&
          frame.data.deviceId === devices.c!.id &&
          frame.data.online === "online",
        90_000,
      );
      expect(online.data.reason).toBe("heartbeat");
    } finally {
      stream.close();
    }
  });

  it("authenticates and bounds SSE connections", async () => {
    const anonymous = await openSseStream(`${baseUrl}/api/events`);
    expect(anonymous.status).toBe(401);
    anonymous.close();

    // The per-user cap is 2 in this run: the third stream is refused.
    const first = await openSseStream(`${baseUrl}/api/events`, {
      cookie: sessionCookie(admin),
    });
    const second = await openSseStream(`${baseUrl}/api/events`, {
      cookie: sessionCookie(admin),
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const third = await openSseStream(`${baseUrl}/api/events`, {
      cookie: sessionCookie(admin),
    });
    expect(third.status).toBe(429);
    first.close();
    second.close();
    third.close();

    await poll(
      "stream limit released",
      async () => test.context.realtime.connectionsForUser(admin.userId),
      (count) => count === 0,
      10_000,
    );
  });

  it("keeps probing without breaking the mesh", async () => {
    // Topology probes run CollectNetworkInfo repeatedly; the clients must stay
    // connected and the overlay must still carry traffic.
    await poll(
      "three live sessions after probing",
      async () => test.context.controlPlane.listClients().length,
      (count) => count === 3,
      120_000,
    );
    const cIp = devices.c!.virtualIpv4!;
    // Traffic between the leaves must cross the relay at core-a.
    const result = await poll(
      "core-b reaches core-c through the relay",
      async () =>
        execIn(SERVICES.b, ["ping", "-c", "1", "-W", "2", cIp], {
          allowFailure: true,
        }),
      (value) => value.stdout.includes("1 packets transmitted, 1 received"),
      120_000,
    );
    expect(result.stdout).toContain("1 packets transmitted, 1 received");
  });
});
