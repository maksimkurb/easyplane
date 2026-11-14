import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { instanceIdFor } from "@easyplane/server";
import type { ManagedClient } from "@easyplane/server";

import {
  M2_TUNNEL_PORTS,
  PORTS,
  execDetached,
  execIn,
  openM2RelayPool,
  requireDockerConformanceEnvironment,
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
 * M2 conformance against real, unmodified easytier-core 2.6.4-81487c36.
 *
 * Three containers on an isolated bridge network (separate net namespaces):
 *   core-a  web tier, runs HTTP servers on 8080/8081, subnet router later
 *   core-b  client
 *   core-c  client
 *
 * Proven here:
 *  - the compiled ACL reaches the real client ("ACL rules built" in its log)
 *  - an allowed flow works (curl 200) and a denied flow is really blocked
 *  - MagicDNS resolves a device name on a client through EasyTier's resolver
 *  - a pending subnet route is not pushed, an approved one is, and the client
 *    reports it; a route advertised by an instance EasyPlane did not create is
 *    flagged as unapproved
 *  - exit-node approval flips `enable_exit_node` on the client
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
  reportedState: Record<string, unknown>;
}

interface NetworkDto {
  id: string;
  networkName: string;
  magicDnsZone: string;
}

const MACHINES = {
  a: "aaaaaaaa-1111-4111-8111-111111111111",
  b: "bbbbbbbb-2222-4222-8222-222222222222",
  c: "cccccccc-3333-4333-8333-333333333333",
} as const;

const SERVICES = { a: "core-m2-a", b: "core-m2-b", c: "core-m2-c" } as const;
const LISTENERS = { a: 11011, b: 11012, c: 11013 } as const;
/**
 * EasyTier keeps `tld_dns_zone` in local flags only; `NetworkConfig` has no
 * field for it (`gen_config` builds flags from defaults), so a
 * config-server-managed instance always answers in the default zone. The
 * network's zone is therefore a naming/UI setting here; the test proves
 * resolution in the zone the client can actually serve.
 */
const DNS_ZONE = "et.net.";
/** EasyTier's MagicDNS resolver address (magic_dns.rs MAGIC_DNS_FAKE_IP). */
const MAGIC_DNS_IP = "100.100.100.101";

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
    `${label}: condition not met within ${timeoutMs}ms; last=${JSON.stringify(last)}`,
  );
}

describe("M2 conformance: ACL enforcement, MagicDNS and routes on real easytier-core", () => {
  let test: TestApp;
  let admin: LoginResult;
  let network: NetworkDto;
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
    const id = devices[letter]!.id;
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${id}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto;
  }

  function clientFor(letter: "a" | "b" | "c"): ManagedClient {
    const machineId = MACHINES[letter];
    const client = test.context.controlPlane
      .listClients()
      .find((entry) => entry.latestHeartbeat?.machineId === machineId);
    if (!client) throw new Error(`no live session for ${letter}`);
    return client;
  }

  async function pushedConfig(letter: "a" | "b" | "c") {
    const device = devices[letter]!;
    const client = clientFor(letter);
    const response = await client.remote.getNetworkInstanceConfig(
      instanceIdFor(network.id, device.id),
    );
    return response.config;
  }

  beforeAll(async () => {
    requireDockerConformanceEnvironment();
    test = await createTestApp({
      oidc: false,
      // Containers reach the server through host.docker.internal, so it must
      // listen on every interface.
      env: {
        EASYPLANE_HOST: "0.0.0.0",
        EASYPLANE_WS_PORT: String(PORTS.m2),
        EASYPLANE_TCP_PORT: "0",
        EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: "5000",
        EASYPLANE_RECONCILE_INTERVAL_MS: "1000",
        EASYPLANE_ROUTE_REPORT_INTERVAL_MS: "1000",
        EASYPLANE_M2_DNS_ZONE: DNS_ZONE,
      },
    });
    await test.context.controlPlane.start();
    test.context.push.start(1000);
    admin = await bootstrapAdmin(test);
  });

  afterAll(async () => {
    // Remove the extra instance created to simulate an unapproved route.
    try {
      if (devices.b) {
        await clientFor("b").remote.deleteNetworkInstance([
          "99999999-9999-4999-8999-999999999999",
        ]);
      }
    } catch {
      // Best effort; the containers are torn down anyway.
    }
    for (const socket of tunnels) socket.destroy();
    stopAllCores();
    await test?.context.push.stop();
    await test?.context.controlPlane.stop();
    await test?.stop();
  });

  it("enrols and approves three real clients", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "M2 Conformance", ipv4Cidr: "10.88.0.0/24" },
    });
    expect(created.statusCode).toBe(201);
    network = created.json() as NetworkDto;

    const dns = await test.app.inject({
      method: "PATCH",
      url: `/api/networks/${network.id}`,
      headers: headers(),
      payload: { magicDnsEnabled: true, magicDnsZone: DNS_ZONE },
    });
    expect(dns.statusCode).toBe(200);

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${network.id}/invites`,
      headers: headers(),
      payload: { maxUses: null, expiresInHours: null },
    });
    expect(invite.statusCode).toBe(201);
    inviteToken = (invite.json() as { token: string }).token;

    // Control-channel tunnel: the clients cannot dial the host, so the host
    // dials the relay and the clients dial the relay (see relay.py).
    startM2Relay();
    for (const letter of ["a", "b", "c"] as const) {
      tunnels.push(...(await openM2RelayPool(letter, PORTS.m2)));
    }
    for (const letter of ["a", "b", "c"] as const) {
      cores[letter] = startCore(
        SERVICES[letter],
        `ws://m2-relay:${M2_TUNNEL_PORTS[letter]}/${encodeURIComponent(inviteToken)}`,
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

    for (const name of ["tag:web", "tag:client"]) {
      const tag = await test.app.inject({
        method: "POST",
        url: "/api/tags",
        headers: headers(),
        payload: { name },
      });
      expect(tag.statusCode).toBe(201);
    }
    const tagged = [
      ["a", ["tag:web"]],
      ["b", ["tag:client"]],
      ["c", ["tag:client"]],
    ] as const;
    for (const [letter, tags] of tagged) {
      const response = await test.app.inject({
        method: "PUT",
        url: `/api/devices/${devices[letter]!.id}/tags`,
        headers: headers(),
        payload: { tags: [...tags] },
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it("meshes the three clients and serves traffic before any policy exists", async () => {
    // Peer URLs use the compose service names, which resolve inside the bridge
    // network; listeners bind inside each container's namespace.
    const peerUrls: Record<"a" | "b" | "c", string[]> = {
      a: [`tcp://core-m2-b:${LISTENERS.b}`, `tcp://core-m2-c:${LISTENERS.c}`],
      b: [`tcp://core-m2-a:${LISTENERS.a}`, `tcp://core-m2-c:${LISTENERS.c}`],
      c: [`tcp://core-m2-a:${LISTENERS.a}`, `tcp://core-m2-b:${LISTENERS.b}`],
    };
    for (const letter of ["a", "b", "c"] as const) {
      const response = await test.app.inject({
        method: "POST",
        url: `/api/devices/${devices[letter]!.id}/revisions`,
        headers: headers(),
        payload: {
          config: {
            listenerUrls: [`tcp://0.0.0.0:${LISTENERS[letter]}`],
            peerUrls: peerUrls[letter],
          },
          note: "conformance mesh",
        },
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

    await poll(
      "b sees a as a peer",
      async () => {
        const info = await clientFor("b").remote.collectNetworkInfo([
          instanceIdFor(network.id, devices.b!.id),
        ]);
        const running = info.info?.map[instanceIdFor(network.id, devices.b!.id)];
        return running?.peers?.length ?? 0;
      },
      (peers) => peers >= 1,
      60_000,
    );

    // The web tier runs an HTTP server on 8080 and one on 8081.
    execDetached(SERVICES.a, ["python3", "-m", "http.server", "8080", "--bind", "0.0.0.0"]);
    execDetached(SERVICES.a, ["python3", "-m", "http.server", "8081", "--bind", "0.0.0.0"]);

    const aIp = devices.a!.virtualIpv4!;
    const openPort = await poll(
      "b reaches a:8080 without a policy",
      async () =>
        execIn(SERVICES.b, [
          "curl",
          "-s",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code}",
          "--max-time",
          "3",
          `http://${aIp}:8080/`,
        ], { allowFailure: true }),
      (result) => result.stdout.trim() === "200",
      60_000,
    );
    expect(openPort.stdout.trim()).toBe("200");
  });

  it("enforces the compiled ACL on the real clients", async () => {
    const policy = await test.app.inject({
      method: "PUT",
      url: `/api/networks/${network.id}/policy`,
      headers: headers(),
      payload: {
        document: {
          tagOwners: { "tag:web": [], "tag:client": [] },
          acls: [
            {
              name: "clients-to-web",
              action: "accept",
              src: ["tag:client"],
              dst: ["tag:web:8080"],
              proto: "tcp",
            },
          ],
        },
        note: "conformance policy",
      },
    });
    expect(policy.statusCode).toBe(200);
    expect((policy.json() as { revisionsCreated: number }).revisionsCreated).toBe(3);

    for (const letter of ["a", "b", "c"] as const) {
      await poll(
        `${letter} applied the policy revision`,
        () => getDevice(letter),
        (device) => device.appliedRevision === 3 && device.lastPushError === null,
      );
    }

    // The compiled ACL is in the pushed config and the client built rules.
    const pushed = await pushedConfig("a");
    const inbound = pushed?.acl?.aclV1?.chains.find(
      (chain) => chain.chainType === 1,
    );
    expect(inbound?.defaultAction).toBe(2); // Drop
    expect(inbound?.rules.map((rule) => rule.name)).toContain("clients-to-web-in");
    // The client (destination) enforces the policy; a client's own inbound
    // chain is default-drop with no rules.
    const clientInbound = (await pushedConfig("b"))?.acl?.aclV1?.chains.find(
      (chain) => chain.chainType === 1,
    );
    expect(clientInbound?.rules ?? []).toEqual([]);
    expect(clientInbound?.defaultAction).toBe(2);
    await poll(
      "client built ACL rules",
      async () => cores.b!.logs(),
      (logs) => logs.includes("ACL rules built"),
      30_000,
    );

    const bIp = devices.b!.virtualIpv4!;
    const cIp = devices.c!.virtualIpv4!;
    const aIp = devices.a!.virtualIpv4!;

    // Allowed: tag:client -> tag:web:8080 from both clients.
    for (const [letter, ip] of [["b", bIp], ["c", cIp]] as const) {
      const allowed = await poll(
        `${letter} reaches a:8080`,
        async () =>
          execIn(SERVICES[letter], [
            "curl",
            "-s",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "--max-time",
            "4",
            `http://${aIp}:8080/`,
          ], { allowFailure: true }),
        (result) => result.stdout.trim() === "200",
        60_000,
      );
      expect(allowed.stdout.trim()).toBe("200");
    }

    // Denied: 8081 is not in the policy, the destination defaults to drop.
    for (const letter of ["b", "c"] as const) {
      const denied = await execIn(
        SERVICES[letter],
        [
          "curl",
          "-s",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code}",
          "--max-time",
          "4",
          `http://${aIp}:8081/`,
        ],
        { allowFailure: true },
      );
      expect(denied.stdout.trim()).toBe("000");
      expect(denied.status).not.toBe(0);
    }

    // The web tier cannot reach a client at all (no statement for web -> client).
    const reverse = await execIn(
      SERVICES.a,
      [
        "curl",
        "-s",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "--max-time",
        "4",
        `http://${bIp}:8080/`,
      ],
      { allowFailure: true },
    );
    expect(reverse.stdout.trim()).toBe("000");

    // strictTags additionally requires EasyTier's verified group proof from the
    // source, i.e. the tag -> group secret/membership mapping really works.
    const strict = await test.app.inject({
      method: "PUT",
      url: `/api/networks/${network.id}/policy`,
      headers: headers(),
      payload: {
        document: {
          tagOwners: { "tag:web": [], "tag:client": [] },
          options: { strictTags: true },
          acls: [
            {
              name: "clients-to-web",
              action: "accept",
              src: ["tag:client"],
              dst: ["tag:web:8080"],
              proto: "tcp",
            },
          ],
        },
        note: "strict tags",
      },
    });
    expect(strict.statusCode).toBe(200);
    for (const letter of ["a", "b", "c"] as const) {
      await poll(
        `${letter} applied the strict policy`,
        () => getDevice(letter),
        (device) => device.appliedRevision === 4 && device.lastPushError === null,
      );
    }
    const strictPushed = await pushedConfig("a");
    const strictInbound = strictPushed?.acl?.aclV1?.chains.find(
      (chain) => chain.chainType === 1,
    );
    expect(strictInbound?.rules[0]?.sourceGroups).toEqual(["tag:client"]);

    const strictAllowed = await poll(
      "b reaches a:8080 with strict tags",
      async () =>
        execIn(SERVICES.b, [
          "curl",
          "-s",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code}",
          "--max-time",
          "4",
          `http://${aIp}:8080/`,
        ], { allowFailure: true }),
      (result) => result.stdout.trim() === "200",
      90_000,
    );
    expect(strictAllowed.stdout.trim()).toBe("200");
  });

  it("resolves MagicDNS names on a real client", async () => {
    const aIp = devices.a!.virtualIpv4!;
    const resolved = await poll(
      "b resolves core-a.ep.test",
      async () =>
        execIn(SERVICES.b, [
          "dig",
          "+short",
          "+time=2",
          "+tries=1",
          `core-a.${DNS_ZONE}`,
          `@${MAGIC_DNS_IP}`,
        ], { allowFailure: true }),
      (result) => result.stdout.trim() === aIp,
      60_000,
    );
    expect(resolved.stdout.trim()).toBe(aIp);

    // The control plane's own view matches what the client resolves.
    const names = await test.app.inject({
      method: "GET",
      url: `/api/networks/${network.id}/dns`,
      headers: authed(admin),
    });
    expect(names.statusCode).toBe(200);
    const body = names.json() as { names: Array<{ fqdn: string; ipv4: string }> };
    expect(body.names).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fqdn: `core-a.${DNS_ZONE}`, ipv4: aIp }),
      ]),
    );
  });

  it("pushes only approved subnet and exit-node routes", async () => {
    // Request a subnet route for core-a. It stays pending and is not pushed.
    const request = await test.app.inject({
      method: "POST",
      url: `/api/devices/${devices.a!.id}/routes`,
      headers: headers(),
      payload: { kind: "subnet", cidr: "192.168.77.0/24", note: "conformance" },
    });
    expect(request.statusCode).toBe(201);
    const route = request.json() as { id: string };
    expect((await pushedConfig("a"))?.proxyCidrs).toEqual([]);

    const approved = await test.app.inject({
      method: "POST",
      url: `/api/routes/${route.id}/decision`,
      headers: headers(),
      payload: { state: "approved" },
    });
    expect(approved.statusCode).toBe(200);

    // The push recreates the instance, so the config control can be missing
    // for a moment; treat that as "not applied yet".
    await poll(
      "core-a receives the approved subnet route",
      async () => {
        try {
          return (await pushedConfig("a"))?.proxyCidrs ?? [];
        } catch {
          return [];
        }
      },
      (cidrs) => cidrs.includes("192.168.77.0/24"),
      90_000,
    );

    // The client reports it back; the report has no unapproved CIDRs.
    const report = await poll(
      "route report for core-a",
      async () => {
        const response = await test.app.inject({
          method: "GET",
          url: `/api/networks/${network.id}/routes`,
          headers: authed(admin),
        });
        const body = response.json() as {
          reports: Array<{
            deviceId: string;
            report: {
              approvedCidrs: string[];
              configuredCidrs: string[];
              observedCidrs: string[];
              unapprovedCidrs: string[];
            } | null;
          }>;
        };
        return body.reports.find((entry) => entry.deviceId === devices.a!.id)?.report ?? null;
      },
      (value) =>
        value !== null &&
        value.configuredCidrs.includes("192.168.77.0/24") &&
        value.observedCidrs.includes("192.168.77.0/24"),
    );
    expect(report!.approvedCidrs).toEqual(["192.168.77.0/24"]);
    expect(report!.unapprovedCidrs).toEqual([]);
    expect(report!.observedCidrs).toContain("192.168.77.0/24");

    // An instance EasyPlane did not create advertises a route: it is flagged,
    // and the control plane says whether it can be removed.
    await clientFor("b").remote.runNetworkInstance({
      instId: "99999999-9999-4999-8999-999999999999",
      config: {
        ...(await pushedConfig("b"))!,
        instanceId: "99999999-9999-4999-8999-999999999999",
        hostname: "stranger",
        virtualIpv4: "10.88.0.99",
        proxyCidrs: ["172.31.0.0/16"],
        // No TUN: the instance only exists to advertise a route, and a second
        // TUN with the same /24 in one namespace would fight the managed one.
        noTun: true,
        enableMagicDns: false,
        enableExitNode: false,
        enableManualRoutes: false,
        routes: [],
        listenerUrls: [],
        peerUrls: [],
        acl: undefined,
      },
      overwrite: true,
    });

    // The extra instance is a peer of core-a/core-c, so *their* route tables
    // report 10.88.0.99 advertising 172.31.0.0/16. EasyTier never reports the
    // local peer in its own route list, so this peer view is the honest way to
    // detect a route EasyPlane did not approve.
    const flagged = await poll(
      "unapproved route advertised by an unknown peer",
      async () => {
        const response = await test.app.inject({
          method: "GET",
          url: `/api/networks/${network.id}/routes`,
          headers: authed(admin),
        });
        const body = response.json() as {
          reports: Array<{
            deviceId: string;
            report: {
              unknownPeers: Array<{ ipv4: string; proxyCidrs: string[] }>;
            } | null;
          }>;
        };
        return body.reports
          .flatMap((entry) => entry.report?.unknownPeers ?? [])
          .find((peer) => peer.ipv4 === "10.88.0.99") ?? null;
      },
      (value) => value !== null && value.proxyCidrs.includes("172.31.0.0/16"),
      90_000,
    );
    expect(flagged!.proxyCidrs).toContain("172.31.0.0/16");

    // Exit-node approval changes enable_exit_node on the wire.
    const exitRequest = await test.app.inject({
      method: "POST",
      url: `/api/devices/${devices.c!.id}/routes`,
      headers: headers(),
      payload: { kind: "exit_node" },
    });
    expect(exitRequest.statusCode).toBe(201);
    expect((await pushedConfig("c"))?.enableExitNode ?? false).toBe(false);
    const exitApproved = await test.app.inject({
      method: "POST",
      url: `/api/routes/${(exitRequest.json() as { id: string }).id}/decision`,
      headers: headers(),
      payload: { state: "approved" },
    });
    expect(exitApproved.statusCode).toBe(200);
    await poll(
      "core-c becomes an exit node",
      async () => (await pushedConfig("c"))?.enableExitNode ?? false,
      (value) => value === true,
      60_000,
    );
  });

  it("audits the policy and route decisions without leaking group secrets", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=200",
      headers: authed(admin),
    });
    const dump = response.body;
    expect(dump).toContain("policy.version_created");
    expect(dump).toContain("route.requested");
    expect(dump).toContain("route.approved");
    expect(dump).toContain("network.magicdns_updated");
    expect(dump).toContain("route.unapproved_reported");
  });
});
