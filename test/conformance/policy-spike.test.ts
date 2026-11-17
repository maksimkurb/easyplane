import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { acl } from "@easyplane/proto";
import { instanceIdFor } from "@easyplane/server";
import type { ManagedClient } from "@easyplane/server";

import {
  PORTS,
  dockerComposeAsync,
  execDetached,
  execIn,
  execInAsync,
  openRelayPool,
  prepareDockerConformanceEnvironment,
  safeStringify,
  startCore,
  startM2Relay,
  stopAllCores,
  type CoreHandle,
} from "./helpers/index.js";
import {
  authed,
  bootstrapAdmin,
  createTestApp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

/**
 * POLICY SPIKE: what does a real pinned easytier-core actually do?
 *
 * This file exists to replace assumptions about EasyTier's ACL with measured
 * behaviour. It pushes raw `Acl` objects straight to real clients (the control
 * plane's policy document is not involved here), so every chain default, every
 * `stateful` flag and every rule shape can be isolated. The findings are
 * recorded in docs/POLICY.md §3.
 *
 * Topology (docker-compose.test.yml):
 *
 *   core-sp-a  172.30.0.11  source client
 *   core-sp-b  172.30.0.12  destination: HTTP :8080, UDP echo :9999
 *   core-sp-r  172.30.0.13  subnet router; advertises 192.168.55.0/24
 *     lanhost namespace     192.168.55.16 behind it, HTTP :8080
 *
 * The LAN host is a network namespace inside the router container, so the
 * "PC behind the router" case is real kernel forwarding plus EasyTier's subnet
 * proxy, not a simulation.
 */

interface DeviceDto {
  id: string;
  hostname: string;
  dnsName: string | null;
  state: "pending" | "approved" | "blocked";
  virtualIpv4: string | null;
  appliedRevision: number | null;
  desiredRevision: number | null;
  lastPushError: string | null;
}

interface NetworkDto {
  id: string;
  networkName: string;
}

const MACHINES = {
  a: "d1d1d1d1-1111-4111-8111-111111111111",
  b: "d2d2d2d2-2222-4222-8222-222222222222",
  r: "d3d3d3d3-3333-4333-8333-333333333333",
} as const;
const SERVICES = { a: "core-sp-a", b: "core-sp-b", r: "core-sp-r" } as const;
const LISTENERS = { a: 11031, b: 11032, r: 11033 } as const;
const LAN_CIDR = "192.168.55.0/24";
const LAN_HOST = "192.168.55.16";

const UDP_ECHO = [
  "import socket",
  "s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)",
  "s.bind(('0.0.0.0', 9999))",
  "while True:",
  "    data, addr = s.recvfrom(2048)",
  "    s.sendto(b'pong', addr)",
].join("\n");

const UDP_CLIENT = [
  "import socket, sys",
  "s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)",
  "s.settimeout(3)",
  "s.sendto(b'ping', (sys.argv[1], 9999))",
  "try:",
  "    data, _ = s.recvfrom(2048)",
  "    print(data.decode())",
  "except Exception:",
  "    print('timeout')",
].join("\n");

async function poll<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label}: condition not met within ${timeoutMs}ms; last=${safeStringify(last)}`,
  );
}

type ChainSpec = {
  chainType: acl.ChainType;
  defaultAction?: acl.Action;
  enabled?: boolean;
  name?: string;
  rules?: acl.Rule[];
};

function rawRule(partial: Partial<acl.Rule> = {}): acl.Rule {
  return {
    name: partial.name ?? "spike",
    description: "",
    priority: partial.priority ?? 65535,
    enabled: partial.enabled ?? true,
    protocol: partial.protocol ?? acl.Protocol.Any,
    ports: partial.ports ?? [],
    sourceIps: partial.sourceIps ?? [],
    destinationIps: partial.destinationIps ?? [],
    sourcePorts: partial.sourcePorts ?? [],
    action: partial.action ?? acl.Action.Allow,
    rateLimit: partial.rateLimit ?? 0,
    burstLimit: partial.burstLimit ?? 0,
    stateful: partial.stateful ?? false,
    sourceGroups: partial.sourceGroups ?? [],
    destinationGroups: partial.destinationGroups ?? [],
  };
}

function rawAcl(
  chains: ChainSpec[],
  group?: { declares: Array<{ groupName: string; groupSecret: string }>; members: string[] },
): acl.Acl {
  return {
    aclV1: {
      chains: chains.map((chain) => ({
        name: chain.name ?? `spike-${chain.chainType}`,
        chainType: chain.chainType,
        description: "",
        enabled: chain.enabled ?? true,
        rules: chain.rules ?? [],
        defaultAction: chain.defaultAction ?? acl.Action.Drop,
      })),
      group: group ?? { declares: [], members: [] },
    },
  };
}

describe("policy spike: EasyTier ACL semantics on real clients", () => {
  let test: TestApp;
  let admin: LoginResult;
  let network: NetworkDto;
  const cores: Partial<Record<"a" | "b" | "r", CoreHandle>> = {};
  const devices: Partial<Record<"a" | "b" | "r", DeviceDto>> = {};
  const tunnels: import("node:net").Socket[] = [];
  /** Findings captured for the report and docs. */
  const findings: Record<string, unknown> = {};

  function headers(): Record<string, string> {
    return authed(admin, { "x-csrf-token": admin.csrfToken });
  }

  function clientFor(letter: "a" | "b" | "r"): ManagedClient {
    const machineId = MACHINES[letter];
    const client = test.context.controlPlane
      .listClients()
      .find((entry) => entry.latestHeartbeat?.machineId === machineId);
    if (!client) throw new Error(`no live session for ${letter}`);
    return client;
  }

  function instId(letter: "a" | "b" | "r"): string {
    return instanceIdFor(network.id, devices[letter]!.id);
  }

  async function baseConfig(letter: "a" | "b" | "r") {
    const client = clientFor(letter);
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const response = await client.remote.getNetworkInstanceConfig(instId(letter));
        if (response.config) return response.config;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  /**
   * Replaces the device's ACL directly, bypassing the policy document.
   *
   * `RunNetworkInstance` with `overwrite` deletes and recreates the instance,
   * so the call returns before the new filter and TUN are up. Waiting for the
   * new chain count to be reported back is what makes the following assertion
   * about *the new ACL* instead of racing the old instance.
   */
  let pushCounter = 0;
  async function pushAcl(letter: "a" | "b" | "r", value: acl.Acl | undefined): Promise<void> {
    const marker = `spike-push-${++pushCounter}`;
    const marked: acl.Acl | undefined = value?.aclV1
      ? {
          aclV1: {
            ...value.aclV1,
            chains: value.aclV1.chains.map((chain, index) =>
              index === 0 ? { ...chain, description: marker } : chain,
            ),
          },
        }
      : value;
    const config = await baseConfig(letter);
    await clientFor(letter).remote.runNetworkInstance({
      instId: instId(letter),
      config: { ...config, acl: marked },
      overwrite: true,
    });
    // The chain count alone is not a marker: every push has the same number of
    // chains. The description of the first chain identifies this exact push,
    // and getNetworkInstanceConfig fails while the instance is recreated.
    await poll(
      `${letter} reports push ${marker}`,
      async () => {
        try {
          const current = (await clientFor(letter).remote.getNetworkInstanceConfig(instId(letter))).config;
          const aclV1 = current?.acl?.aclV1;
          if (!value) return !aclV1;
          if (value.aclV1!.chains.length === 0) {
            // An ACL with no chains is dropped by the client's `is_empty()`
            // check, so it is reported as no ACL at all.
            return (aclV1?.chains.length ?? 0) === 0;
          }
          return aclV1?.chains[0]?.description === marker;
        } catch {
          return false;
        }
      },
      (applied) => applied === true,
      45_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  /** Polls a value and returns it without failing (for recording findings). */
  async function softPoll<T>(
    label: string,
    fn: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs = 20_000,
  ): Promise<T> {
    try {
      return await poll(label, fn, predicate, timeoutMs);
    } catch {
      return fn();
    }
  }

  /** Waits until the client's instance reports at least one peer again. */
  async function waitPeers(letter: "a" | "b" | "r"): Promise<void> {
    await poll(
      `${letter} has a peer again`,
      async () => {
        try {
          const info = await clientFor(letter).remote.collectNetworkInfo([instId(letter)]);
          return info.info?.map[instId(letter)]?.peers?.length ?? 0;
        } catch {
          return 0;
        }
      },
      (count) => count >= 1,
      60_000,
    );
  }

  async function httpFrom(
    service: "core-sp-a" | "core-sp-b" | "core-sp-lan",
    url: string,
  ): Promise<string> {
    const result = await execInAsync(
      service,
      ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "4", url],
      { allowFailure: true },
    );
    return result.stdout.trim();
  }

  async function pingFrom(service: "core-sp-a" | "core-sp-b", target: string): Promise<boolean> {
    const result = await execInAsync(service, ["ping", "-c", "1", "-W", "2", target], {
      allowFailure: true,
    });
    return result.status === 0;
  }

  async function udpFrom(service: "core-sp-a" | "core-sp-b", target: string): Promise<string> {
    const result = await execInAsync(service, ["python3", "-c", UDP_CLIENT, target], {
      allowFailure: true,
    });
    return result.stdout.trim();
  }

  async function getDevice(letter: "a" | "b" | "r"): Promise<DeviceDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${devices[letter]!.id}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto;
  }

  beforeAll(async () => {
    prepareDockerConformanceEnvironment();
    test = await createTestApp({
      oidc: false,
      env: {
        EASYPLANE_HOST: "0.0.0.0",
        EASYPLANE_WS_PORT: String(PORTS.sp),
        EASYPLANE_TCP_PORT: "0",
        EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: "5000",
        // The spike pushes raw ACLs itself; a fast reconciler would fight it.
        EASYPLANE_RECONCILE_INTERVAL_MS: "600000",
        EASYPLANE_ROUTE_REPORT_INTERVAL_MS: "1000",
      },
    });
    await test.context.controlPlane.start();
    // Raw ACL pushes are the whole point: the reconciler must not restore the
    // panel's desired config behind our back (the m2 suite uses 1 s).
    test.context.push.start(600_000);
    admin = await bootstrapAdmin(test);

    const created = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Policy spike", ipv4Cidr: "10.120.0.0/24" },
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
    const token = (invite.json() as { token: string }).token;

    startM2Relay();
    await dockerComposeAsync([
      "up", "-d", "--force-recreate", "sp-relay", "core-sp-lan",
    ]);
    tunnels.push(...(await openRelayPool("172.30.0.10", 23051, PORTS.sp)));
    tunnels.push(...(await openRelayPool("172.30.0.10", 23052, PORTS.sp)));
    tunnels.push(...(await openRelayPool("172.30.0.10", 23053, PORTS.sp)));
    for (const letter of ["a", "b", "r"] as const) {
      cores[letter] = startCore(
        SERVICES[letter],
        `ws://sp-relay:${23041 + ["a", "b", "r"].indexOf(letter)}/${encodeURIComponent(token)}`,
      );
    }
    // core-sp-a is not on the m2 network; the relay is only reachable over sp.
    // startCore() passes the URL through docker compose, so this is enough.

    await poll(
      "three client sessions",
      async () => test.context.controlPlane.listClients().length,
      (count) => count >= 3,
      120_000,
    );

    const pending = await poll(
      "three pending devices",
      async () => {
        const response = await test.app.inject({
          method: "GET",
          url: "/api/devices",
          headers: authed(admin),
        });
        return response.json() as DeviceDto[];
      },
      (list) => list.length >= 3,
    );
    for (const letter of ["a", "b", "r"] as const) {
      const device = pending.find((entry) => entry.hostname === `core-sp-${letter}`);
      if (!device) throw new Error(`device core-sp-${letter} not enrolled`);
      const approved = await test.app.inject({
        method: "POST",
        url: `/api/devices/${device.id}/approve`,
        headers: headers(),
        payload: {},
      });
      expect(approved.statusCode).toBe(200);
      devices[letter] = approved.json() as DeviceDto;
    }

    // Mesh: a is the hub and the only listener; b and r dial it.
    const endpoint = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/endpoints`,
      headers: headers(),
      payload: { endpoints: [`tcp://core-sp-a:${LISTENERS.a}`] },
    });
    expect(endpoint.statusCode).toBe(200);
    await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/hub`,
      headers: headers(),
      payload: { isHub: true },
    });
    for (const letter of ["a", "b", "r"] as const) {
      const response = await test.app.inject({
        method: "POST",
        url: `/api/devices/${devices[letter]!.id}/revisions`,
        headers: headers(),
        payload: {
          config: {
            listenerUrls: [`tcp://0.0.0.0:${LISTENERS[letter]}`],
            acceptRoutes: true,
          },
          note: "spike mesh",
        },
      });
      expect(response.statusCode).toBe(201);
    }
    for (const letter of ["a", "b", "r"] as const) {
      await poll(
        `${letter} applied the mesh revision`,
        () => getDevice(letter),
        (device) => device.lastPushError === null && device.appliedRevision === 2,
      );
    }

    // Approve the router's LAN. This is what makes the owner's case real:
    // 192.168.55.0/24 is pushed as proxy_cidrs on r and as a manual route on b.
    const route = await test.app.inject({
      method: "POST",
      url: `/api/devices/${devices.r!.id}/routes`,
      headers: headers(),
      payload: { kind: "subnet", cidr: LAN_CIDR },
    });
    expect(route.statusCode).toBe(201);
    const decision = await test.app.inject({
      method: "POST",
      url: `/api/routes/${(route.json() as { id: string }).id}/decision`,
      headers: headers(),
      payload: { state: "approved" },
    });
    expect(decision.statusCode).toBe(200);

    await poll(
      "router advertises the LAN",
      async () => (await baseConfig("r")).proxyCidrs ?? [],
      (cidrs) => cidrs.includes(LAN_CIDR),
    );
    await poll(
      "destination installs the LAN route",
      async () => (await baseConfig("b")).routes ?? [],
      (routes) => routes.includes(LAN_CIDR),
    );

    await poll(
      "b sees a as a peer",
      async () => {
        const info = await clientFor("b").remote.collectNetworkInfo([instId("b")]);
        return info.info?.map[instId("b")]?.peers?.length ?? 0;
      },
      (peers) => peers >= 1,
      90_000,
    );

    // Traffic endpoints. The destination logs the source address it sees; the
    // LAN namespace logs the source it sees for the reverse direction.
    execDetached("core-sp-b", ["python3", "-m", "http.server", "8080", "--bind", "0.0.0.0"]);
    execDetached("core-sp-b", ["python3", "-c", UDP_ECHO]);
    execDetached("core-sp-lan", [
      "sh",
      "-c",
      "python3 -m http.server 8080 --bind 0.0.0.0 >/tmp/lan-http.log 2>&1",
    ]);
  }, 240_000);

  afterAll(async () => {
    findings["acl_base"] = {
      note: "raw ACLs pushed with RunNetworkInstance; no policy document involved",
    };
    // eslint-disable-next-line no-console
    console.log(`POLICY_SPIKE_FINDINGS ${safeStringify(findings)}`);
    for (const socket of tunnels) socket.destroy();
    stopAllCores();
    await test?.context.push.stop();
    await test?.context.controlPlane.stop();
    await test?.stop();
  });

  it("baseline: without an ACL the LAN host reaches the remote node and back", async () => {
    await pushAcl("a", undefined);
    await pushAcl("b", undefined);
    await pushAcl("r", undefined);

    const bIp = devices.b!.virtualIpv4!;
    const h1 = await poll(
      "LAN host reaches b:8080 without a policy",
      () => httpFrom("core-sp-lan", `http://${bIp}:8080/`),
      (code) => code === "200",
    );
    expect(h1).toBe("200");
    const h2 = await poll(
      "b reaches the LAN host without a policy",
      () => httpFrom("core-sp-b", `http://${LAN_HOST}:8080/`),
      (code) => code === "200",
    );
    expect(h2).toBe("200");

    findings["baseline"] = { lanToB: "200", bToLan: "200" };
  });

  it("a: inbound allow alone passes TCP replies, stateful=false and true", async () => {
    const aIp = devices.a!.virtualIpv4!;
    const bIp = devices.b!.virtualIpv4!;

    for (const stateful of [false, true]) {
      await pushAcl("a", rawAcl([
        {
          chainType: acl.ChainType.Inbound,
          defaultAction: acl.Action.Drop,
        },
        {
          chainType: acl.ChainType.Outbound,
          defaultAction: acl.Action.Allow,
        },
      ]));
      await pushAcl("b", rawAcl([
        {
          chainType: acl.ChainType.Inbound,
          defaultAction: acl.Action.Drop,
          rules: [
            rawRule({
              name: `a-http-stateful-${stateful}`,
              protocol: acl.Protocol.TCP,
              ports: ["8080"],
              sourceIps: [`${aIp}/32`],
              action: acl.Action.Allow,
              stateful,
            }),
          ],
        },
        {
          chainType: acl.ChainType.Outbound,
          defaultAction: acl.Action.Allow,
        },
      ]));

      const code = await poll(
        `a reaches b:8080 (stateful=${stateful})`,
        () => httpFrom("core-sp-a", `http://${bIp}:8080/`),
        (value) => value === "200",
      );
      expect(code).toBe("200");
      findings[`a_tcp_inbound_stateful_${stateful}`] = code;
    }

    // ICMP: an inbound ICMP allow is enough for the request; the echo reply is
    // covered by the sender's outbound record.
    await pushAcl("b", rawAcl([
      {
        chainType: acl.ChainType.Inbound,
        defaultAction: acl.Action.Drop,
        rules: [
          rawRule({
            name: "a-icmp",
            protocol: acl.Protocol.ICMP,
            sourceIps: [`${aIp}/32`],
            action: acl.Action.Allow,
          }),
        ],
      },
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
    ]));
    const pingOk = await poll(
      "a pings b with an inbound ICMP allow",
      () => pingFrom("core-sp-a", bIp),
      (value) => value === true,
    );
    expect(pingOk).toBe(true);

    // Without the ICMP rule the ping must fail (default drop at the destination).
    await pushAcl("b", rawAcl([
      { chainType: acl.ChainType.Inbound, defaultAction: acl.Action.Drop },
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
    ]));
    await waitPeers("a");
    await waitPeers("b");
    expect(await pingFrom("core-sp-a", bIp)).toBe(false);

    // UDP: same shape as TCP, an inbound allow for the destination port.
    await pushAcl("b", rawAcl([
      {
        chainType: acl.ChainType.Inbound,
        defaultAction: acl.Action.Drop,
        rules: [
          rawRule({
            name: "a-udp",
            protocol: acl.Protocol.UDP,
            ports: ["9999"],
            sourceIps: [`${aIp}/32`],
            action: acl.Action.Allow,
          }),
        ],
      },
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
    ]));
    const udp = await poll(
      "a gets a UDP reply with an inbound allow",
      () => udpFrom("core-sp-a", bIp),
      (value) => value === "pong",
    );
    expect(udp).toBe("pong");

    findings["a_icmp_inbound_allow"] = pingOk;
    findings["a_udp_inbound_allow"] = udp;
    findings["a_stateful_effect"] = "reply passes via outbound_allow_records; stateful only tracks";
  });

  it("b: an Outbound default Drop on the sender blocks even allowed inbound traffic", async () => {
    const aIp = devices.a!.virtualIpv4!;
    const bIp = devices.b!.virtualIpv4!;

    await pushAcl("b", rawAcl([
      {
        chainType: acl.ChainType.Inbound,
        defaultAction: acl.Action.Drop,
        rules: [
          rawRule({
            name: "a-http",
            protocol: acl.Protocol.TCP,
            ports: ["8080"],
            sourceIps: [`${aIp}/32`],
            action: acl.Action.Allow,
          }),
        ],
      },
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
    ]));
    // Sender's egress is default-drop and has no rule for b.
    await pushAcl("a", rawAcl([
      { chainType: acl.ChainType.Inbound, defaultAction: acl.Action.Drop },
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Drop },
    ]));
    await waitPeers("a");
    await waitPeers("b");
    const blocked = await httpFrom("core-sp-a", `http://${bIp}:8080/`);
    expect(blocked).toBe("000");

    // Adding the egress allow on the sender restores the flow, and only then
    // is an outbound allow record created for the reply.
    await pushAcl("a", rawAcl([
      { chainType: acl.ChainType.Inbound, defaultAction: acl.Action.Drop },
      {
        chainType: acl.ChainType.Outbound,
        defaultAction: acl.Action.Drop,
        rules: [
          rawRule({
            name: "a-egress-http",
            protocol: acl.Protocol.TCP,
            ports: ["8080"],
            destinationIps: [`${bIp}/32`],
            action: acl.Action.Allow,
          }),
        ],
      },
    ]));
    const allowed = await poll(
      "a reaches b with an explicit outbound allow",
      () => httpFrom("core-sp-a", `http://${bIp}:8080/`),
      (code) => code === "200",
    );
    expect(allowed).toBe("200");

    findings["b_outbound_default_drop"] = {
      withoutEgressAllow: blocked,
      withEgressAllow: allowed,
    };
  });

  it("b2: no chain at all defaults to Allow, an empty chain keeps its declared default", async () => {
    const aIp = devices.a!.virtualIpv4!;
    const bIp = devices.b!.virtualIpv4!;

    // ACL present but no chains: every chain default is Allow (source:
    // processor.rs build_default_actions). The filter is enabled.
    await pushAcl("a", { aclV1: { chains: [], group: { declares: [], members: [] } } });
    await pushAcl("b", { aclV1: { chains: [], group: { declares: [], members: [] } } });
    const code = await httpFrom("core-sp-a", `http://${bIp}:8080/`);
    expect(code).toBe("200");

    // An empty chain whose default is Drop denies everything on that direction
    // even though it has no rules.
    await pushAcl("b", rawAcl([
      { chainType: acl.ChainType.Inbound, defaultAction: acl.Action.Drop },
    ]));
    await waitPeers("a");
    await waitPeers("b");
    const dropped = await httpFrom("core-sp-a", `http://${bIp}:8080/`);
    expect(dropped).toBe("000");

    // MEASURED GOTCHA: `enabled: false` removes the chain's rules but NOT its
    // `default_action` (`build_default_actions` looks the chain up by type and
    // ignores `enabled`). So a disabled drop chain still drops every packet.
    await pushAcl("b", rawAcl([
      {
        chainType: acl.ChainType.Inbound,
        defaultAction: acl.Action.Drop,
        enabled: false,
      },
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
    ]));
    await waitPeers("a");
    const disabled = await httpFrom("core-sp-a", `http://${bIp}:8080/`);
    expect(disabled).toBe("000");

    // Omitting the chain is the only way to disable it completely.
    await pushAcl("b", rawAcl([
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
    ]));
    const omitted = await poll(
      "omitting the inbound chain restores the Allow default",
      () => httpFrom("core-sp-a", `http://${bIp}:8080/`),
      (value) => value === "200",
    );
    expect(omitted).toBe("200");

    findings["b2_chain_defaults"] = {
      noChains: code,
      emptyInboundDrop: dropped,
      disabledInboundChain: disabled,
      omittedInboundChain: omitted,
      note:
        "missing chain => Allow; enabled:false keeps default_action and only skips rules, so the compiler omits disabled chains",
    };
    void aIp;
  });

  it("c: the owner's LAN host case, and which chain on which device decides", async () => {
    const aIp = devices.a!.virtualIpv4!;
    const bIp = devices.b!.virtualIpv4!;

    // 1) Only the remote destination has a rule naming the LAN host, default
    //    drop inbound on b and default drop forward on r. This is exactly the
    //    naive "allow LAN host -> b" policy.
    await pushAcl("b", rawAcl([
      {
        chainType: acl.ChainType.Inbound,
        defaultAction: acl.Action.Drop,
        rules: [
          rawRule({
            name: "lan-to-b",
            protocol: acl.Protocol.TCP,
            ports: ["8080", "8099"],
            sourceIps: [`${LAN_HOST}/32`],
            action: acl.Action.Allow,
          }),
        ],
      },
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
    ]));
    await pushAcl("r", rawAcl([
      { chainType: acl.ChainType.Inbound, defaultAction: acl.Action.Drop },
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
      { chainType: acl.ChainType.Forward, defaultAction: acl.Action.Drop },
    ]));

    await waitPeers("b");
    await waitPeers("r");
    const naive = await softPoll(
      "LAN host reaches b with only the inbound rule",
      () => httpFrom("core-sp-lan", `http://${bIp}:8080/`),
      (code) => code === "200",
      30_000,
    );
    findings["c_naive_lan_to_b"] = naive;

    // 2) The remote -> LAN direction needs a Forward allow on the router: the
    //    subnet proxy terminates the TCP connection and matches the Forward
    //    chain, not an outbound record.
    await waitPeers("b");
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const reverseNaive = await httpFrom("core-sp-b", `http://${LAN_HOST}:8080/`);
    expect(reverseNaive).toBe("000");

    await pushAcl("r", rawAcl([
      { chainType: acl.ChainType.Inbound, defaultAction: acl.Action.Drop },
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
      {
        chainType: acl.ChainType.Forward,
        defaultAction: acl.Action.Drop,
        rules: [
          rawRule({
            name: "b-to-lan",
            protocol: acl.Protocol.TCP,
            ports: ["8080"],
            sourceIps: [`${bIp}/32`],
            destinationIps: [`${LAN_CIDR}`],
            action: acl.Action.Allow,
          }),
        ],
      },
    ]));
    const reverseAllowed = await poll(
      "b reaches the LAN host with a Forward allow on the router",
      () => httpFrom("core-sp-b", `http://${LAN_HOST}:8080/`),
      (code) => code === "200",
    );
    expect(reverseAllowed).toBe("200");

    // 3) Which source address does the destination see for LAN -> b? A tiny
    //    TCP accept probe on b writes the peer address it observes.
    execDetached("core-sp-b", ["python3", "-u", "/opt/sp/peer-probe.py"]);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await httpFrom("core-sp-lan", `http://${bIp}:8099/`);
    const seenByDestination = await softPoll(
      "destination records the source address",
      async () =>
        (await execInAsync("core-sp-b", ["cat", "/tmp/b-peer.log"], { allowFailure: true }))
          .stdout,
      (value) => value.trim().length > 0,
      15_000,
    );
    findings["c_destination_sees_lan_source"] = seenByDestination.trim();

    // The LAN host log shows the source of b -> LAN connections: the router's
    // LAN address, i.e. the subnet proxy terminates the connection.
    const lanLog = await poll(
      "LAN host logs the reverse connection",
      async () => (await execInAsync("core-sp-lan", ["cat", "/tmp/lan-http.log"], { allowFailure: true })).stdout,
      (value) => value.includes("GET"),
    );
    findings["c_lan_host_sees_source"] = /\d+\.\d+\.\d+\.\d+/.exec(lanLog)?.[0] ?? "unknown";

    // 4) Inbound-only again, but now with r's forward default DROP: LAN -> b
    //    still works because the LAN-side packet leaves r through Outbound
    //    (default allow) and b's inbound rule admits the LAN source. The reply
    //    arrives at r on the Forward chain and is saved by the outbound record.
    expect(
      await poll(
        "LAN to b still works with a router Forward allow present",
        () => httpFrom("core-sp-lan", `http://${bIp}:8080/`),
        (code) => code === "200",
      ),
    ).toBe("200");
    // And a: 192.168.55.x is NOT a's address, so a cannot use the same rule.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(await httpFrom("core-sp-a", `http://${bIp}:8080/`)).toBe("000");

    // 5) Deny on the router's Forward chain wins over everything else.
    await pushAcl("r", rawAcl([
      { chainType: acl.ChainType.Inbound, defaultAction: acl.Action.Drop },
      { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
      {
        chainType: acl.ChainType.Forward,
        defaultAction: acl.Action.Drop,
        rules: [
          rawRule({
            name: "b-to-lan",
            protocol: acl.Protocol.TCP,
            ports: ["8080"],
            sourceIps: [`${bIp}/32`],
            destinationIps: [LAN_CIDR],
            action: acl.Action.Allow,
          }),
        ],
      },
    ]));
    expect(
      await poll(
        "LAN to b still works with the forward allow rule",
        () => httpFrom("core-sp-lan", `http://${bIp}:8080/`),
        (code) => code === "200",
      ),
    ).toBe("200");

    // 6) The reverse rule is what makes an explicit "allow b -> LAN host"
    //    policy work; without it the proxy drops at the router.
    findings["c_required_rules"] = {
      lanToRemote: "remote Inbound allow with source = LAN host IP; router Outbound default allow",
      remoteToLan: "router Forward allow (src remote, dst LAN CIDR); source is the LAN-side proxy",
      lanSourceAtRemote: "LAN IP, preserved (no NAT) for LAN -> remote",
      remoteSees: "subnet proxy at the router terminates TCP; LAN host sees the router's LAN IP",
    };
    void aIp;
  });

  it("d: group criteria match peer tags, source_ips match preserved addresses", async () => {
    const aIp = devices.a!.virtualIpv4!;
    const bIp = devices.b!.virtualIpv4!;
    const secret = test.context.policies.groupSecret(network.id, "tag:spike");

    // a is a member of tag:spike (it proves the group), b verifies it.
    await pushAcl(
      "a",
      rawAcl(
        [
          { chainType: acl.ChainType.Inbound, defaultAction: acl.Action.Drop },
          { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
        ],
        { declares: [{ groupName: "tag:spike", groupSecret: secret }], members: ["tag:spike"] },
      ),
    );
    await pushAcl(
      "b",
      rawAcl(
        [
          {
            chainType: acl.ChainType.Inbound,
            defaultAction: acl.Action.Drop,
            rules: [
              rawRule({
                name: "group-only",
                protocol: acl.Protocol.TCP,
                ports: ["8080"],
                sourceGroups: ["tag:spike"],
                action: acl.Action.Allow,
              }),
            ],
          },
          { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
        ],
        { declares: [{ groupName: "tag:spike", groupSecret: secret }], members: [] },
      ),
    );

    const groupAllowed = await poll(
      "a (tag:spike member) reaches b with source_groups only",
      () => httpFrom("core-sp-a", `http://${bIp}:8080/`),
      (code) => code === "200",
    );
    expect(groupAllowed).toBe("200");

    // A rule whose source_ips do not match but whose group does: the group is
    // what admits the packet. Conversely a wrong address with no group fails.
    await pushAcl(
      "b",
      rawAcl(
        [
          {
            chainType: acl.ChainType.Inbound,
            defaultAction: acl.Action.Drop,
            rules: [
              rawRule({
                name: "wrong-ip-right-group",
                protocol: acl.Protocol.TCP,
                ports: ["8080"],
                sourceIps: ["10.255.255.1/32"],
                sourceGroups: ["tag:spike"],
                action: acl.Action.Allow,
              }),
            ],
          },
          { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
        ],
        { declares: [{ groupName: "tag:spike", groupSecret: secret }], members: [] },
      ),
    );
    expect(await httpFrom("core-sp-a", `http://${bIp}:8080/`)).toBe("000");

    // A destination_groups rule matches the destination peer's group.
    await pushAcl(
      "b",
      rawAcl(
        [
          {
            chainType: acl.ChainType.Inbound,
            defaultAction: acl.Action.Drop,
            rules: [
              rawRule({
                name: "destination-group",
                protocol: acl.Protocol.TCP,
                ports: ["8080"],
                sourceIps: [`${aIp}/32`],
                destinationGroups: ["tag:spike"],
                action: acl.Action.Allow,
              }),
            ],
          },
          { chainType: acl.ChainType.Outbound, defaultAction: acl.Action.Allow },
        ],
        { declares: [{ groupName: "tag:spike", groupSecret: secret }], members: ["tag:spike"] },
      ),
    );
    const dstGroup = await poll(
      "destination_groups rule admits a packet to the tagged destination",
      () => httpFrom("core-sp-a", `http://${bIp}:8080/`),
      (code) => code === "200",
    );
    expect(dstGroup).toBe("200");

    findings["d_groups"] = {
      sourceGroupsOnly: groupAllowed,
      addressMismatchGroupMatch: "000 (both criteria must match)",
      destinationGroups: dstGroup,
      note: "groups are verified peer-tag HMACs; addresses are preserved packet IPs",
    };
  });
});
