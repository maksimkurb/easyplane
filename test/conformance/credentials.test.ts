import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Socket } from "node:net";

import { instanceIdFor } from "@easyplane/server";
import type { ManagedClient } from "@easyplane/server";

import {
  PORTS,
  RENDEZVOUS_TOPOLOGY,
  execInAsync,
  openRelayPool,
  prepareDockerConformanceEnvironment,
  safeStringify,
  startRendezvous,
  startRendezvousRelay,
  startRvCore,
  stopAllCores,
  underlayBlockList,
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
 * Credential-mode conformance with the real pinned easytier-core
 * (docs/CREDENTIALS.md).
 *
 * Topology mirrors the rendezvous test: each leaf has its own data network and
 * its own control network, so the only path between leaves is the public node.
 * `core-rv-iso-a` is the anchor, `core-rv-iso-b` and `core-rv-direct-a` are
 * members. The test proves, with real clients:
 *
 *  - a credential member joins through the rendezvous node while an anchor is
 *    online (the anchor establishes the foreign network and publishes the
 *    trusted key over OSPF);
 *  - revoking the credential stops the member (instance deleted, blocked);
 *  - with NO anchor online a new member cannot be admitted by the node (the
 *    spike's key limit), and it recovers when the anchor returns.
 */
interface DeviceDto {
  id: string;
  networkId: string;
  hostname: string;
  state: string;
  role: string;
  effectiveRole: string;
  knowsSecret: boolean;
  virtualIpv4: string | null;
  appliedRevision: number | null;
  lastPushError: string | null;
  credential: { status: string; expiry: string } | null;
}

const ANCHOR = {
  service: "core-rv-iso-a",
  machineId: "2a2a2a2a-3333-4333-8333-333333333333",
  relay: "c" as const,
  hostname: "core-rv-iso-a",
} as const;
const MEMBER = {
  service: "core-rv-iso-b",
  machineId: "2b2b2b2b-4444-4444-8444-444444444444",
  relay: "d" as const,
  hostname: "core-rv-iso-b",
} as const;
const LATE = {
  service: "core-rv-direct-a",
  machineId: "1a1a1a1a-1111-4111-8111-111111111111",
  relay: "a" as const,
  hostname: "core-rv-direct-a",
} as const;

type LeafKind = "anchor" | "member" | "late";

/**
 * Leaves of this test must reach each other only through the node: the
 * no-anchor assertion ("a fresh member cannot be admitted, so it cannot reach
 * the other member") is meaningless if the underlay gives them a direct path.
 * Each leaf therefore prohibits the other leaves' docker addresses before
 * easytier starts (see `underlayBlockList`).
 */
const ISOLATED_PEERS: Record<LeafKind, ReadonlyArray<keyof typeof RENDEZVOUS_TOPOLOGY.leaf>> = {
  anchor: ["iso-b", "direct-a"],
  member: ["iso-a", "direct-a"],
  late: ["iso-a", "iso-b"],
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
  timeoutMs = 120_000,
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `${label}: condition not met within ${timeoutMs}ms; last=${safeStringify(last)}; ` +
      `error=${lastError instanceof Error ? lastError.message : String(lastError ?? "none")}`,
  );
}

async function ping(service: string, ip: string): Promise<boolean> {
  const result = await execInAsync(
    service,
    ["ping", "-c", "1", "-W", "2", ip],
    { allowFailure: true },
  );
  return result.status === 0;
}

describe("credential conformance: anchor, member, revoke, no-anchor window", () => {
  let test: TestApp;
  let admin: LoginResult;
  let networkId = "";
  let node: RendezvousHandle;
  const devices: Partial<Record<"anchor" | "member" | "late", DeviceDto>> = {};
  const cores: Partial<Record<"anchor" | "member" | "late", CoreHandle>> = {};
  const tunnels: Socket[] = [];

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return authed(admin, { "x-csrf-token": admin.csrfToken, ...extra });
  }

  async function getDevice(kind: "anchor" | "member" | "late"): Promise<DeviceDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${devices[kind]!.id}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    devices[kind] = response.json() as DeviceDto;
    return devices[kind]!;
  }

  function clientFor(kind: "anchor" | "member" | "late"): ManagedClient {
    const expected = { anchor: ANCHOR, member: MEMBER, late: LATE }[kind];
    const client = test.context.controlPlane
      .listClients()
      .find(
        (entry) => entry.latestHeartbeat?.machineId === expected.machineId,
      );
    if (!client) throw new Error(`no live session for ${kind}`);
    return client;
  }

  async function instanceId(kind: "anchor" | "member" | "late"): Promise<string> {
    const device = devices[kind]!;
    return instanceIdFor(device.networkId, device.id);
  }

  async function running(kind: "anchor" | "member" | "late"): Promise<boolean> {
    const id = await instanceId(kind);
    const info = await clientFor(kind).remote.collectNetworkInfo([id]);
    return info.info?.map[id]?.running === true;
  }

  async function peerRoutes(
    kind: "anchor" | "member" | "late",
  ): Promise<Array<{ ipv4Addr?: { address?: { addr?: number } } }>> {
    const id = await instanceId(kind);
    const info = await clientFor(kind).remote.collectNetworkInfo([id]);
    return info.info?.map[id]?.routes ?? [];
  }

  async function startLeaf(
    kind: "anchor" | "member" | "late",
    token: string,
  ): Promise<void> {
    const leaf = { anchor: ANCHOR, member: MEMBER, late: LATE }[kind];
    const url = `ws://${RENDEZVOUS_TOPOLOGY.relay[leaf.relay]}:${RENDEZVOUS_TOPOLOGY.clientPort[leaf.relay]}/${encodeURIComponent(token)}`;
    tunnels.push(
      ...(await openRelayPool(
        RENDEZVOUS_TOPOLOGY.relay[leaf.relay],
        RENDEZVOUS_TOPOLOGY.hostPort[leaf.relay],
        PORTS.credentials,
        16,
      )),
    );
    cores[kind] = await startRvCore(
      leaf.service,
      url,
      underlayBlockList(ISOLATED_PEERS[kind]),
    );
  }

  async function invite(role: "anchor" | "member"): Promise<string> {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: { role, maxUses: null, expiresInHours: null },
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as { token: string }).token;
  }

  async function approvePending(machineId: string): Promise<DeviceDto> {
    const hostname = machineHostname(machineId);
    const device = await poll(
      `pending device ${hostname}`,
      async () => {
        const response = await test.app.inject({
          method: "GET",
          url: "/api/devices?state=pending",
          headers: authed(admin),
        });
        const pending = response.json() as DeviceDto[];
        return pending.find((entry) => entry.hostname === hostname) ?? null;
      },
      (found) => found !== null,
      120_000,
    );
    if (!device) throw new Error(`no pending device for ${machineId}`);
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/approve`,
      headers: headers(),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    return approved.json() as DeviceDto;
  }

  function machineHostname(machineId: string): string {
    if (machineId === ANCHOR.machineId) return ANCHOR.hostname;
    if (machineId === MEMBER.machineId) return MEMBER.hostname;
    return LATE.hostname;
  }

  beforeAll(async () => {
    prepareDockerConformanceEnvironment();
    test = await createTestApp({
      oidc: false,
      env: {
        EASYPLANE_HOST: "0.0.0.0",
        EASYPLANE_WS_PORT: String(PORTS.credentials),
        EASYPLANE_TCP_PORT: "0",
        EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: "5000",
        EASYPLANE_RECONCILE_INTERVAL_MS: "1000",
        EASYPLANE_ROUTE_REPORT_INTERVAL_MS: "1000",
        EASYPLANE_CLIENT_HEARTBEAT_TIMEOUT_MS: "0",
        EASYPLANE_RENDEZVOUS_ENDPOINTS: NODE_ENDPOINTS.join(","),
        EASYPLANE_RENDEZVOUS_SECRET: RENDEZVOUS_TOPOLOGY.secret,
        EASYPLANE_RENDEZVOUS_NETWORK_NAME: RENDEZVOUS_TOPOLOGY.networkName,
        EASYPLANE_RENDEZVOUS_RELAY_DATA: "true",
        EASYPLANE_CREDENTIAL_TTL_DAYS: "90",
        EASYPLANE_CREDENTIAL_RENEW_BEFORE_DAYS: "14",
      },
    });
    await test.context.controlPlane.start();
    test.context.push.start(1000);
    admin = await bootstrapAdmin(test);
    node = await startRendezvous({ EASYPLANE_RV_RELAY_DATA: "true" });
    await startRendezvousRelay();
    await poll(
      "node reports relay ON",
      async () => (await node.logs()).includes("rendezvous: data relay ENABLED"),
      Boolean,
      30_000,
    );
  });

  afterAll(async () => {
    for (const socket of tunnels) socket.destroy();
    stopAllCores();
    await test?.context.push.stop();
    await test?.context.controlPlane.stop();
    await test?.stop();
  });

  it("enrols an anchor and a member in a credentials network", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Credential conformance", ipv4Cidr: "10.94.144.0/24" },
    });
    expect(created.statusCode).toBe(201);
    networkId = (created.json() as { id: string }).id;
    // The bundled node has one secret for every network using it.
    const aligned = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/rendezvous/align-secret`,
      headers: headers(),
    });
    expect(aligned.statusCode).toBe(200);
    const patched = await test.app.inject({
      method: "PATCH",
      url: `/api/networks/${networkId}`,
      headers: headers(),
      payload: { useRendezvous: true },
    });
    expect(patched.statusCode).toBe(200);

    const anchorToken = await invite("anchor");
    await startLeaf("anchor", anchorToken);
    devices.anchor = await approvePending(ANCHOR.machineId);
    expect(devices.anchor.role).toBe("anchor");
    expect(devices.anchor.knowsSecret).toBe(true);

    // Migrate to credentials: the approved anchor keeps the secret, every
    // device approved later joins with a per-device key.
    const switched = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/access-mode`,
      headers: headers(),
      payload: { mode: "credentials", anchorDeviceIds: [devices.anchor.id] },
    });
    expect(switched.statusCode).toBe(200);

    const memberToken = await invite("member");
    await startLeaf("member", memberToken);
    devices.member = await approvePending(MEMBER.machineId);
    expect(devices.member.effectiveRole).toBe("member");
    expect(devices.member.knowsSecret).toBe(false);
    expect(devices.member.credential?.status).toBe("active");

    await poll("anchor instance running", () => running("anchor"), Boolean);
    await poll("member instance running", () => running("member"), Boolean);
  });

  it("lets the member reach the anchor through the rendezvous node", async () => {
    const anchorIp = (await getDevice("anchor")).virtualIpv4!;
    await poll(
      "member -> anchor over the relay",
      () => ping(MEMBER.service, anchorIp),
      Boolean,
      180_000,
    );
  });

  it("drops a new member when no anchor is online, then recovers", async () => {
    // Stop the only anchor: the node's foreign-network entry has no
    // secret-verified peer left, so a fresh credential member cannot join.
    cores.anchor!.stop();
    const lateToken = await invite("member");
    await startLeaf("late", lateToken);
    devices.late = await approvePending(LATE.machineId);
    expect(devices.late.credential?.status).toBe("active");

    await poll(
      "anchor session closed",
      async () =>
        test.context.controlPlane
          .listClients()
          .some((client) => client.latestHeartbeat?.machineId === ANCHOR.machineId),
      (present) => present === false,
      60_000,
    );

    // The member-2 instance runs, but it has no path to the other member.
    const memberIp = devices.member!.virtualIpv4!;
    await new Promise((resolve) => setTimeout(resolve, 25_000));
    expect(await ping(LATE.service, memberIp)).toBe(false);
    expect(await peerRoutes("late")).toHaveLength(0);

    // The node rejected the credential peer because the network was not
    // established by a secret holder; the same message the spike recorded.
    const logs = await node.logs();
    expect(logs).toMatch(
      /private mode is turned on, foreign network secret mismatch|is not established by a secret-verified peer yet/,
    );

    // Bring the anchor back: the entry is re-established, the anchor is
    // repushed with the new member credential, and the member connects.
    cores.anchor!.start();
    await poll(
      "anchor session back",
      async () =>
        test.context.controlPlane
          .listClients()
          .some((client) => client.latestHeartbeat?.machineId === ANCHOR.machineId),
      Boolean,
      120_000,
    );
    await poll("anchor instance running again", () => running("anchor"), Boolean);
    await poll(
      "late member reaches the member after recovery",
      () => ping(LATE.service, memberIp),
      Boolean,
      180_000,
    );
  });

  it("revokes the member: instance deleted, blocked and unreachable", async () => {
    const revoked = await test.app.inject({
      method: "POST",
      url: `/api/devices/${devices.member!.id}/credential/revoke`,
      headers: headers(),
    });
    expect(revoked.statusCode).toBe(200);
    const body = revoked.json() as DeviceDto;
    expect(body.state).toBe("blocked");
    expect(body.credential?.status).toBe("revoked");

    await poll(
      "member session closed",
      async () =>
        test.context.controlPlane
          .listClients()
          .some((client) => client.latestHeartbeat?.machineId === MEMBER.machineId),
      (present) => present === false,
      60_000,
    );
    // The control plane deleted the deterministic instance before closing.
    const memberIp = devices.member!.virtualIpv4!;
    await poll(
      "late member can no longer reach the revoked member",
      async () => (await ping(LATE.service, memberIp)) === false,
      Boolean,
      120_000,
    );
  });
});
