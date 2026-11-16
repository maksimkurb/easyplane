import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Socket } from "node:net";

import { instanceIdFor } from "@easyplane/server";
import type { ManagedClient } from "@easyplane/server";

import {
  PORTS,
  RENDEZVOUS_TOPOLOGY,
  dockerComposeAsync,
  execDetachedAsync,
  execInAsync,
  ipv4ToU32,
  openRelayPool,
  prepareDockerConformanceEnvironment,
  probeDockerBridgeIsolation,
  safeStringify,
  startRendezvous,
  startRendezvousRelay,
  startRvCore,
  stopAllCores,
  stopRendezvous,
  underlayBlockList,
  underlayDiagnostics,
  underlayReachable,
  type CoreHandle,
  type RendezvousHandle,
} from "./helpers/index.js";
import {
  authed,
  bootstrapAdmin,
  createTestApp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

/**
 * Rendezvous node conformance against the REAL pinned easytier-core.
 *
 * The node runs `docker/rendezvous/entrypoint.sh`, the same script the
 * production compose uses: private mode on, data relay off by default. Two
 * leaf networks are enrolled through the panel:
 *
 *  - direct pair: both leaves share one docker network with the node, so a
 *    direct P2P path exists and traffic must pass with relay OFF;
 *  - isolated pair: each leaf is on its own docker network, so the only path
 *    is through the node. With relay OFF data must not pass; with
 *    RENDEZVOUS_RELAY_DATA=true it must.
 *
 * The route data comes from CollectNetworkInfo (cost 1 = direct neighbour,
 * cost > 1 = relayed with next_hop_peer_id), which is the same data the panel
 * map uses.
 */
interface DeviceDto {
  id: string;
  networkId: string;
  hostname: string;
  state: string;
  virtualIpv4: string | null;
  appliedRevision: number | null;
  lastPushError: string | null;
}

interface NetworkDto {
  id: string;
  useRendezvous: boolean;
  p2pOnly: boolean;
  rendezvous: {
    configured: boolean;
    secretMatches: boolean | null;
    endpoints: string[];
  };
  peerPlan: { rendezvousEndpoints: number; hasPeerEndpoint: boolean };
}

const LEAVES = {
  "direct-a": {
    machineId: "1a1a1a1a-1111-4111-8111-111111111111",
    service: "core-rv-direct-a",
    relay: "a" as const,
    network: "direct" as const,
  },
  "direct-b": {
    machineId: "1b1b1b1b-2222-4222-8222-222222222222",
    service: "core-rv-direct-b",
    relay: "b" as const,
    network: "direct" as const,
  },
  "iso-a": {
    machineId: "2a2a2a2a-3333-4333-8333-333333333333",
    service: "core-rv-iso-a",
    relay: "c" as const,
    network: "iso" as const,
  },
  "iso-b": {
    machineId: "2b2b2b2b-4444-4444-8444-444444444444",
    service: "core-rv-iso-b",
    relay: "d" as const,
    network: "iso" as const,
  },
} as const;

type LeafName = keyof typeof LEAVES;

/**
 * Leaves that must not reach each other over the docker underlay. The direct
 * pair is expected to be a direct neighbour (that is the relay-OFF control
 * case), so it blocks nothing; the isolated pair must only meet through the
 * node.
 */
const ISOLATED_PEERS: Record<LeafName, LeafName[]> = {
  "direct-a": [],
  "direct-b": [],
  "iso-a": ["iso-b"],
  "iso-b": ["iso-a"],
};

const NODE_ENDPOINTS = [
  `tcp://${RENDEZVOUS_TOPOLOGY.node.direct}:11010`,
  `tcp://${RENDEZVOUS_TOPOLOGY.node.a}:11010`,
  `tcp://${RENDEZVOUS_TOPOLOGY.node.b}:11010`,
];

async function poll<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      lastError = undefined;
    } catch (error) {
      lastError = error;
      last = undefined;
    }
    if (last !== undefined && predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `${label}: condition not met within ${timeoutMs}ms; last=${safeStringify(last)}; ` +
      `error=${lastError instanceof Error ? lastError.message : String(lastError ?? "none")}`,
  );
}

async function httpStatus(service: string, url: string): Promise<number> {
  const result = await execInAsync(
    service,
    [
      "curl",
      "-sS",
      "-m",
      "4",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      url,
    ],
    { allowFailure: true },
  );
  return result.status === 0 ? Number(result.stdout.trim()) || 0 : 0;
}

const normalizePeers = (values: readonly string[] = []) =>
  values.map((value) => value.replace(/\/+$/, ""));

describe("rendezvous conformance: private public node, relay off/on", () => {
  let test: TestApp;
  let admin: LoginResult;
  const networks: Partial<Record<"direct" | "iso", string>> = {};
  const devices: Partial<Record<LeafName, DeviceDto>> = {};
  const cores: Partial<Record<LeafName, CoreHandle>> = {};
  const tunnels: Socket[] = [];
  let node: RendezvousHandle;

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

  async function getDevice(letter: LeafName): Promise<DeviceDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${devices[letter]!.id}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    devices[letter] = response.json() as DeviceDto;
    return devices[letter]!;
  }

  async function getNetwork(kind: "direct" | "iso"): Promise<NetworkDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networks[kind]}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as NetworkDto;
  }

  function clientFor(letter: LeafName): ManagedClient {
    const clients = test.context.controlPlane.listClients();
    const client = clients.find(
      (entry) => entry.latestHeartbeat?.machineId === LEAVES[letter].machineId,
    );
    if (!client) {
      throw new Error(
        `no live session for ${letter}; connected: ${clients
          .map((entry) => entry.latestHeartbeat?.machineId ?? "?")
          .join(",")}`,
      );
    }
    return client;
  }

  function instanceFor(letter: LeafName): string {
    return instanceIdFor(devices[letter]!.networkId, devices[letter]!.id);
  }

  async function pushedConfig(letter: LeafName) {
    return clientFor(letter).remote.getNetworkInstanceConfig(instanceFor(letter));
  }

  async function routesFor(letter: LeafName) {
    const id = instanceFor(letter);
    const info = await clientFor(letter).remote.collectNetworkInfo([id]);
    return info.info?.map[id]?.routes ?? [];
  }

  async function nodeLogs(): Promise<string> {
    return node.logs();
  }

  function occurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  /**
   * Fails with the underlay state when the "isolated" pair passes traffic.
   *
   * A bare `expect(status).not.toBe(200)` cannot distinguish "the node relayed
   * data it was told not to" from "the pair was never isolated": the message
   * alone costs a full investigation cycle on a black-box runner.
   */
  async function failIsolatedTrafficPassed(label: string): Promise<never> {
    const routes = await routesFor("iso-a").catch((error: unknown) =>
      error instanceof Error ? `error: ${error.message}` : String(error),
    );
    const id = instanceFor("iso-a");
    const peers = await clientFor("iso-a")
      .remote.collectNetworkInfo([id])
      .then((info) =>
        (info.info?.map[id]?.peers ?? []).map((peer) => ({
          peerId: peer.peerId,
          conns: peer.conns.map((conn) => ({
            tunnel: conn.tunnel,
            isClient: conn.isClient,
            lossRate: conn.lossRate,
          })),
        })),
      )
      .catch((error: unknown) =>
        error instanceof Error ? `error: ${error.message}` : String(error),
      );
    throw new Error(
      `${label}, but iso-a reached iso-b over the overlay (HTTP 200); ` +
        `iso-a routes=${safeStringify(routes)}\n` +
        `iso-a peer connections=${safeStringify(peers)}\n` +
        (await underlayDiagnostics([
          { label: "iso-a", service: LEAVES["iso-a"].service },
          { label: "iso-b", service: LEAVES["iso-b"].service },
        ])),
    );
  }

  beforeAll(async () => {
    prepareDockerConformanceEnvironment();
    test = await createTestApp({
      oidc: false,
      env: {
        EASYPLANE_HOST: "0.0.0.0",
        EASYPLANE_WS_PORT: String(PORTS.rendezvous),
        EASYPLANE_TCP_PORT: "0",
        EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: "5000",
        EASYPLANE_RECONCILE_INTERVAL_MS: "1000",
        EASYPLANE_ROUTE_REPORT_INTERVAL_MS: "1000",
        // The relay host pool opens a few tunnels up front; unused ones must
        // not be reaped by the heartbeat timeout before a client reconnects.
        EASYPLANE_CLIENT_HEARTBEAT_TIMEOUT_MS: "0",
        EASYPLANE_RENDEZVOUS_ENDPOINTS: NODE_ENDPOINTS.join(","),
        EASYPLANE_RENDEZVOUS_SECRET: RENDEZVOUS_TOPOLOGY.secret,
        EASYPLANE_RENDEZVOUS_NETWORK_NAME: RENDEZVOUS_TOPOLOGY.networkName,
        EASYPLANE_RENDEZVOUS_RELAY_DATA: "false",
      },
    });
    await test.context.controlPlane.start();
    test.context.push.start(1000);
    admin = await bootstrapAdmin(test);

    node = await startRendezvous({ EASYPLANE_RV_RELAY_DATA: "false" });
    await startRendezvousRelay();
  });

  afterAll(async () => {
    for (const socket of tunnels) socket.destroy();
    stopAllCores();
    await test?.context.push.stop();
    await test?.context.controlPlane.stop();
    await test?.stop();
  });

  it("enrols two networks, aligns the secret and compiles the endpoints", async () => {
    for (const kind of ["direct", "iso"] as const) {
      const created = await test.app.inject({
        method: "POST",
        url: "/api/networks",
        headers: headers(),
        payload: {
          name: `Rendezvous ${kind}`,
          ipv4Cidr: kind === "direct" ? "10.91.0.0/24" : "10.92.0.0/24",
        },
      });
      expect(created.statusCode).toBe(201);
      networks[kind] = (created.json() as { id: string }).id;
    }

    const tokenByNetwork = new Map<"direct" | "iso", string>();
    for (const kind of ["direct", "iso"] as const) {
      const invite = await test.app.inject({
        method: "POST",
        url: `/api/networks/${networks[kind]}/invites`,
        headers: headers(),
        payload: { maxUses: null, expiresInHours: null },
      });
      expect(invite.statusCode).toBe(201);
      tokenByNetwork.set(kind, (invite.json() as { token: string }).token);
    }

    for (const letter of Object.keys(LEAVES) as LeafName[]) {
      const leaf = LEAVES[letter];
      tunnels.push(
        ...(await openRelayPool(
          RENDEZVOUS_TOPOLOGY.relay[leaf.relay],
          RENDEZVOUS_TOPOLOGY.hostPort[leaf.relay],
          PORTS.rendezvous,
          16,
        )),
      );
    }
    for (const letter of Object.keys(LEAVES) as LeafName[]) {
      const leaf = LEAVES[letter];
      const url = `ws://${RENDEZVOUS_TOPOLOGY.relay[leaf.relay]}:${RENDEZVOUS_TOPOLOGY.clientPort[leaf.relay]}/${encodeURIComponent(tokenByNetwork.get(leaf.network)!)}`;
      // The isolated pair must have NO direct underlay path, or "relay OFF drops
      // the traffic" is not a statement about the node at all. That premise used
      // to come implicitly from the docker daemon's inter-bridge isolation
      // rules; each isolated leaf now prohibits the other leaf's addresses
      // before its own easytier starts (rendezvous/leaf-entrypoint.sh), so the
      // assertion cannot flip when a runner's iptables state differs. The direct
      // pair must stay directly reachable: that is what the same test proves.
      cores[letter] = await startRvCore(
        leaf.service,
        url,
        underlayBlockList(ISOLATED_PEERS[letter]),
      );
    }

    // Prove the premise instead of assuming it.
    expect(
      await underlayReachable(
        LEAVES["iso-a"].service,
        RENDEZVOUS_TOPOLOGY.leaf["iso-b"].data,
      ),
      "iso-a must not reach iso-b's underlay address; the isolated pair is not isolated",
    ).toBe(false);

    // Record the ambient docker isolation state for this host. It is not
    // asserted (the leaves enforce the premise themselves), but when it is
    // broken the log says so instead of leaving the next failure unexplained.
    const ambientLeak = await probeDockerBridgeIsolation(
      RENDEZVOUS_TOPOLOGY.network.a,
      RENDEZVOUS_TOPOLOGY.leaf["iso-b"].data,
    );
    console.log(
      `[rendezvous] docker bridge isolation rv-a -> rv-b: ` +
        (ambientLeak ? "BROKEN (rv-a can reach rv-b's leaf directly)" : "effective"),
    );

    // The node's effective mode comes from its own log: a stale or wrongly
    // configured container must fail here, not as a mysterious data assertion.
    await poll(
      "node reports relay OFF",
      async () =>
        (await node.logs()).includes("rendezvous: data relay disabled (rendezvous only)"),
      Boolean,
      30_000,
    );
    expect(await node.logs()).not.toContain("rendezvous: data relay ENABLED");

    await poll(
      "four client sessions",
      async () => test.context.controlPlane.listClients().length,
      (count) => count >= 4,
      120_000,
    );
    const pending = await poll(
      "four pending devices",
      getDevices,
      (list) => list.length >= 4,
    );
    for (const letter of Object.keys(LEAVES) as LeafName[]) {
      const leaf = LEAVES[letter];
      const expectedHost = `core-rv-${letter}`;
      const device = pending.find((entry) => entry.hostname === expectedHost);
      if (!device) throw new Error(`device ${expectedHost} not enrolled`);
      expect(device.networkId).toBe(networks[leaf.network]);
      const approved = await test.app.inject({
        method: "POST",
        url: `/api/devices/${device.id}/approve`,
        headers: headers(),
        payload: {},
      });
      expect(approved.statusCode).toBe(200);
      devices[letter] = approved.json() as DeviceDto;
    }

    // The panel knows the node's secret, so it can prove the mismatch before
    // the operator turns the toggle on.
    for (const kind of ["direct", "iso"] as const) {
      const before = await getNetwork(kind);
      expect(before.rendezvous.configured).toBe(true);
      expect(before.rendezvous.secretMatches).toBe(false);
      const refused = await test.app.inject({
        method: "PATCH",
        url: `/api/networks/${networks[kind]}`,
        headers: headers(),
        payload: { useRendezvous: true },
      });
      expect(refused.statusCode).toBe(409);

      const aligned = await test.app.inject({
        method: "POST",
        url: `/api/networks/${networks[kind]}/rendezvous/align-secret`,
        headers: headers(),
      });
      expect(aligned.statusCode).toBe(200);
      const after = await getNetwork(kind);
      expect(after.rendezvous.secretMatches).toBe(true);

      const enabled = await test.app.inject({
        method: "PATCH",
        url: `/api/networks/${networks[kind]}`,
        headers: headers(),
        payload: { useRendezvous: true },
      });
      expect(enabled.statusCode).toBe(200);
      const dto = enabled.json() as NetworkDto;
      expect(dto.useRendezvous).toBe(true);
      expect(dto.rendezvous.endpoints).toEqual(NODE_ENDPOINTS);
      expect(dto.peerPlan.rendezvousEndpoints).toBe(NODE_ENDPOINTS.length);
      expect(dto.peerPlan.hasPeerEndpoint).toBe(true);
    }

    for (const letter of Object.keys(LEAVES) as LeafName[]) {
      const response = await test.app.inject({
        method: "POST",
        url: `/api/devices/${devices[letter]!.id}/revisions`,
        headers: headers(),
        payload: {
          config: { listenerUrls: ["tcp://0.0.0.0:11011"] },
          note: "rendezvous conformance",
        },
      });
      expect(response.statusCode).toBe(201);
    }
    for (const letter of Object.keys(LEAVES) as LeafName[]) {
      await poll(
        `${letter} applied revision 2`,
        () => getDevice(letter),
        (device) => device.appliedRevision === 2 && device.lastPushError === null,
      );
    }

    for (const letter of Object.keys(LEAVES) as LeafName[]) {
      const config = await pushedConfig(letter);
      const peers = new Set(normalizePeers(config.config?.peerUrls));
      for (const endpoint of NODE_ENDPOINTS) {
        expect(peers.has(endpoint), `${letter} dials ${endpoint}`).toBe(true);
      }
      expect(config.config?.secureMode?.enabled, `${letter} secure mode`).toBe(true);
    }
  });

  it("passes direct traffic with relay OFF and cannot cross the isolated pair", async () => {
    const directIp = (await getDevice("direct-b")).virtualIpv4!;
    const isoIp = (await getDevice("iso-b")).virtualIpv4!;
    expect(directIp).toMatch(/^10\.91\./);
    expect(isoIp).toMatch(/^10\.92\./);

    await execDetachedAsync(LEAVES["direct-b"].service, [
      "python3",
      "-m",
      "http.server",
      "8080",
      "--bind",
      "0.0.0.0",
    ]);
    await execDetachedAsync(LEAVES["iso-b"].service, [
      "python3",
      "-m",
      "http.server",
      "8080",
      "--bind",
      "0.0.0.0",
    ]);

    // Direct pair: a real HTTP request over the overlay. It must work while the
    // node drops forwarded data, which proves the path is direct.
    await poll(
      "direct pair HTTP 200",
      async () =>
        await httpStatus(LEAVES["direct-a"].service, `http://${directIp}:8080/`),
      (status) => status === 200,
      90_000,
    );

    const directRoute = await poll(
      "direct route",
      async () => {
        const routes = await routesFor("direct-a");
        return routes.find(
          (route) => route.ipv4Addr?.address?.addr === ipv4ToU32(directIp),
        );
      },
      (route) => route?.cost === 1,
      90_000,
    );
    expect(directRoute?.cost).toBe(1);

    // Isolated pair: the same request must NOT work. The node may still show a
    // (relayed) route, but no data is forwarded while relay is off.
    let lastStatus = 0;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      lastStatus = await httpStatus(LEAVES["iso-a"].service, `http://${isoIp}:8080/`);
      if (lastStatus === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (lastStatus === 200) {
      await failIsolatedTrafficPassed("relay OFF must drop isolated traffic");
    }
    const isoRoutes = await routesFor("iso-a");
    const isoRoute = isoRoutes.find(
      (route) => route.ipv4Addr?.address?.addr === ipv4ToU32(isoIp),
    );
    expect(isoRoute?.cost === 1, "isolated leaves cannot be direct neighbours").toBe(
      false,
    );
  });

  it("relay ON lets the isolated pair communicate and the route is relayed", async () => {
    const isoIp = (await getDevice("iso-b")).virtualIpv4!;
    const directIp = (await getDevice("direct-b")).virtualIpv4!;

    await stopRendezvousNode();
    await startRendezvous({ EASYPLANE_RV_RELAY_DATA: "true" });
    await poll(
      "node reports relay ON",
      async () => (await node.logs()).includes("rendezvous: data relay ENABLED"),
      Boolean,
      30_000,
    );

    // Wait for the leaves to reconnect and the data path to come up.
    await poll(
      "isolated pair HTTP 200 through the relay",
      async () => await httpStatus(LEAVES["iso-a"].service, `http://${isoIp}:8080/`),
      (status) => status === 200,
      120_000,
    );

    const relayedRoute = await poll(
      "relayed route",
      async () => {
        const routes = await routesFor("iso-a");
        return routes.find(
          (route) => route.ipv4Addr?.address?.addr === ipv4ToU32(isoIp),
        );
      },
      (route) => route !== undefined && route.cost > 1 && route.nextHopPeerId !== 0,
      90_000,
    );
    expect(relayedRoute!.cost).toBeGreaterThan(1);
    expect(relayedRoute!.nextHopPeerId).not.toBe(0);

    // The direct pair still passes traffic. Its route may temporarily fall back
    // to the relay after the restart; direct-vs-relayed is proven above (cost 1
    // with relay OFF) and by the isolated pair below (cost > 1 with relay ON).
    expect(
      await httpStatus(LEAVES["direct-a"].service, `http://${directIp}:8080/`),
    ).toBe(200);
  });

  it("private mode rejects a foreign network with a different secret", async () => {
    const marker = "private mode is turned on, foreign network secret mismatch";
    const before = occurrences(await nodeLogs(), marker);
    await dockerComposeAsync(["up", "-d", "--force-recreate", "core-rv-wrong-secret"]);
    await poll(
      "node logs the private-mode rejection",
      async () => occurrences(await nodeLogs(), marker),
      (count) => count > before,
      60_000,
    );
  });

  it("relay_network_whitelist is a second layer: admission and relay", async () => {
    // The panel-generated network names are not "not-this-network", so a strict
    // whitelist rejects the connections entirely.
    const rejection = "not in whitelist";
    await stopRendezvousNode();
    await startRendezvous({
      EASYPLANE_RV_RELAY_DATA: "true",
      EASYPLANE_RV_WHITELIST: "not-this-network",
    });
    await poll(
      "node rejects non-whitelisted networks",
      async () => occurrences(await nodeLogs(), rejection),
      (count) => count > 0,
      90_000,
    );
    const isoIp = (await getDevice("iso-b")).virtualIpv4!;
    const whitelistedStatus = await httpStatus(
      LEAVES["iso-a"].service,
      `http://${isoIp}:8080/`,
    );
    if (whitelistedStatus === 200) {
      await failIsolatedTrafficPassed(
        "a non-whitelisted network must not get data relay",
      );
    }

    // relay_all_peer_rpc=true admits them for rendezvous/peer RPC but still does
    // not forward data: relay stays limited to whitelisted networks.
    await stopRendezvousNode();
    await startRendezvous({
      EASYPLANE_RV_RELAY_DATA: "true",
      EASYPLANE_RV_WHITELIST: "not-this-network",
      EASYPLANE_RV_RELAY_ALL_PEER_RPC: "true",
    });
    await poll(
      "leaves reconnect for peer RPC",
      async () => {
        const routes = await routesFor("iso-a");
        return routes.length;
      },
      (count) => count > 0,
      120_000,
    );
    // The node accepted the connection (no whitelist errors in the new
    // container's log), but data is still dropped because the network is not in
    // the relay whitelist.
    expect(occurrences(await nodeLogs(), rejection)).toBe(0);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      expect(await httpStatus(LEAVES["iso-a"].service, `http://${isoIp}:8080/`)).not.toBe(
        200,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    expect(occurrences(await nodeLogs(), rejection)).toBe(0);
  });

  async function stopRendezvousNode(): Promise<void> {
    await stopRendezvous();
  }
});
