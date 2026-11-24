import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { manage } from "@easyplane/proto";
import { instanceIdFor } from "@easyplane/server";
import type { ManagedClient } from "@easyplane/server";

import {
  M2_RELAY_IP,
  M2_TUNNEL_PORTS,
  PORTS,
  REPO_ROOT,
  dockerComposeAsync,
  execInAsync,
  openM2RelayPool,
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
 * Device-declared routes on a REAL pinned client (2.6.4-81487c36).
 *
 * One managed instance per device, run with `--config-server` and
 * `--config-dir`. The operator stops the client, edits the persisted
 * `<instance-id>.toml` ([[proxy_network]] / enable_exit_node), and starts it
 * again. Proven here:
 *
 *  - the pushed config is persisted and reloaded, and its own config reports
 *    the declaration (GetNetworkInstanceConfig);
 *  - the panel turns it into pending `device_declared` proposals (idempotently)
 *    and *adopts* it on every push instead of erasing the edit;
 *  - only an approved declared route is distributed: receivers get an explicit
 *    `enable_manual_routes` list, so an unapproved advertisement is never
 *    installed and is unreachable;
 *  - a rejected declaration is reverted (config-dir) and not re-proposed;
 *  - a read-only external file is a state, not a push-error loop;
 *  - a reshaped/foreign instance id breaks attribution (documented limit);
 *  - exit-node approval is consent only: no `exit_nodes` ever reaches a client,
 *    and egress needs an OS route *and* the client-side exit node list.
 *
 * The topology (three containers on the M2 bridge, tunnels through the test
 * relay) matches the other conformance suites. See docs/SPIKE-DECLARED-ROUTES.md
 * for the measurements this test encodes.
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
  exitNode: "none" | "proposed" | "approved";
  configManagedLocally: boolean;
}

interface NetworkDto {
  id: string;
  networkName: string;
}

interface RouteDto {
  id: string;
  deviceId: string;
  kind: "subnet" | "exit_node";
  cidr: string;
  state: "pending" | "approved" | "rejected";
  source: "panel" | "device_declared";
  advertised: boolean;
}

const MACHINES = {
  a: "a1a1a1a1-1111-4111-8111-111111111111",
  b: "b1b1b1b1-2222-4222-8222-222222222222",
  c: "c1c1c1c1-3333-4333-8333-333333333333",
} as const;

const SERVICES = { a: "core-dr-a", b: "core-dr-b", c: "core-dr-c" } as const;
const CONTAINERS = {
  a: "easyplane-core-dr-a",
  b: "easyplane-core-dr-b",
  c: "easyplane-core-dr-c",
} as const;
const READ_ONLY_CONTAINER = "easyplane-core-dr-a-ro";
const LISTENERS = { a: 11021, b: 11022, c: 11023 } as const;
const CFG_DIRS = {
  a: join(REPO_ROOT, "test/conformance/device-routes/cfg/a"),
  b: join(REPO_ROOT, "test/conformance/device-routes/cfg/b"),
  c: join(REPO_ROOT, "test/conformance/device-routes/cfg/c"),
} as const;
const SUBNET_APPROVED = "10.99.1.0/24";
const SUBNET_REJECTED = "10.99.2.0/24";
const SUBNET_STRANGER = "10.99.3.0/24";
const EXIT_ONLY_TARGET = "203.0.113.7";
const RESPONSE_CIDR = "10.88.0.200";

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
  throw new Error(`${label}: condition not met within ${timeoutMs}ms; last=${safeStringify(last)}`);
}

function dockerCopyFrom(container: string, path: string, destination: string): void {
  execFileSync("docker", ["cp", `${container}:${path}`, destination], { encoding: "utf8" });
}

function dockerCopyTo(container: string, source: string, path: string): void {
  execFileSync("docker", ["cp", source, `${container}:${path}`], { encoding: "utf8" });
}

function forceRemove(name: string): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      execFileSync("docker", ["rm", "-f", name], { encoding: "utf8", stdio: "ignore" });
      return;
    } catch {
      execFileSync("sleep", ["1"]);
    }
  }
}

describe("declared routes: one config-dir instance, real easytier-core", () => {
  let test: TestApp;
  let admin: LoginResult;
  let network: NetworkDto;
  let inviteToken = "";
  const cores: Partial<Record<"a" | "b" | "c", CoreHandle>> = {};
  const devices: Partial<Record<"a" | "b" | "c", DeviceDto>> = {};
  const tunnels: import("node:net").Socket[] = [];
  let scratchDir = "";

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

  function instanceId(letter: "a" | "b" | "c"): string {
    return instanceIdFor(network.id, devices[letter]!.id);
  }

  async function ownConfig(letter: "a" | "b" | "c") {
    return clientFor(letter).remote.getNetworkInstanceConfig(instanceId(letter));
  }

  /** Tolerates the short "instance config control not found" window. */
  async function safeConfig(letter: "a" | "b" | "c") {
    try {
      return (await ownConfig(letter)).config ?? null;
    } catch {
      return null;
    }
  }

  async function routeTable(letter: "a" | "b" | "c"): Promise<string> {
    const result = await execInAsync(SERVICES[letter], ["ip", "route", "show"]);
    return result.stdout;
  }

  async function httpStatus(
    letter: "a" | "b" | "c",
    url: string,
    timeoutSeconds = 3,
  ): Promise<string> {
    const result = await execInAsync(
      SERVICES[letter],
      ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", String(timeoutSeconds), url],
      { allowFailure: true },
    );
    return result.stdout.trim() || `exit:${result.status}`;
  }

  async function networkRoutes(): Promise<RouteDto[]> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/networks/${network.id}/routes`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { routes: RouteDto[] }).routes;
  }

  function readPersisted(letter: "a" | "b" | "c"): string {
    const local = join(scratchDir, `persisted-${letter}.toml`);
    dockerCopyFrom(CONTAINERS[letter], `/cfg/${instanceId(letter)}.toml`, local);
    return readFileSync(local, "utf8");
  }

  function writePersisted(name: string, contents: string): string {
    const local = join(scratchDir, name);
    try {
      execFileSync("chmod", ["0644", local], { stdio: "ignore" });
    } catch {
      // Created below.
    }
    writeFileSync(local, contents);
    return local;
  }

  beforeAll(async () => {
    prepareDockerConformanceEnvironment();
    forceRemove(READ_ONLY_CONTAINER);
    for (const dir of Object.values(CFG_DIRS)) {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
    // Host-side scratch for `docker cp`: a fresh directory per run, because a
    // fixed path does not exist on a CI runner and a stale file from an earlier
    // run would be read back as if it were the client's persisted config.
    scratchDir = mkdtempSync(join(tmpdir(), "easyplane-declared-routes-"));
    test = await createTestApp({
      oidc: false,
      env: {
        EASYPLANE_HOST: "0.0.0.0",
        EASYPLANE_WS_PORT: String(PORTS.dr),
        EASYPLANE_TCP_PORT: "0",
        EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: "15000",
        EASYPLANE_RECONCILE_INTERVAL_MS: "1000",
        EASYPLANE_ROUTE_REPORT_INTERVAL_MS: "1000",
        // The harness pre-opens relay sockets before a container restart; the
        // liveness reaper would close them after 20 s and every reconnect would
        // pair with a dead socket. The real client heartbeats, so this only
        // disables a hardening timer for the test.
        EASYPLANE_CLIENT_HEARTBEAT_TIMEOUT_MS: "0",
      },
    });
    await test.context.controlPlane.start();
    // The reconciler is what detects a declaration within a second. It must not
    // erase it: `declareRoutes` runs before the drift comparison.
    test.context.push.start(1000);
    admin = await bootstrapAdmin(test);
  });

  afterAll(async () => {
    for (const socket of tunnels) socket.destroy();
    forceRemove(READ_ONLY_CONTAINER);
    stopAllCores();
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
    await test?.context.push.stop();
    await test?.context.controlPlane.stop();
    await test?.stop();
  });

  it("persists the pushed instance and always constrains route installation", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Declared routes", ipv4Cidr: "10.88.0.0/24" },
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
      // Every client reconnect (including the Noise upgrade and the container
      // restarts below) consumes one relay pair. A restarts four times.
      tunnels.push(
        ...(await openM2RelayPool(letter, PORTS.dr, letter === "a" ? 12 : 8)),
      );
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
    const pending = await poll("three pending devices", getDevices, (list) => list.length >= 3);
    for (const letter of ["a", "b", "c"] as const) {
      const device = pending.find((entry) => entry.hostname === `core-dr-${letter}`);
      if (!device) throw new Error(`device core-dr-${letter} not enrolled`);
      const approved = await test.app.inject({
        method: "POST",
        url: `/api/devices/${device.id}/approve`,
        headers: headers(),
        payload: {},
      });
      expect(approved.statusCode).toBe(200);
      devices[letter] = approved.json() as DeviceDto;
    }

    // A is the hub; B accepts routes, C does not. Both must be constrained.
    const hub = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/endpoints`,
      headers: headers(),
      payload: { endpoints: [`tcp://core-dr-a:${LISTENERS.a}`] },
    });
    expect(hub.statusCode).toBe(200);
    const flagged = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/hub`,
      headers: headers(),
      payload: { isHub: true },
    });
    expect(flagged.statusCode).toBe(200);

    const configs = {
      a: { listenerUrls: [`tcp://0.0.0.0:${LISTENERS.a}`] },
      b: { acceptRoutes: true, listenerUrls: [`tcp://0.0.0.0:${LISTENERS.b}`] },
      c: { acceptRoutes: false, listenerUrls: [`tcp://0.0.0.0:${LISTENERS.c}`] },
    } as const;
    for (const letter of ["a", "b", "c"] as const) {
      const response = await test.app.inject({
        method: "POST",
        url: `/api/devices/${devices[letter]!.id}/revisions`,
        headers: headers(),
        payload: { config: configs[letter], note: "declared routes mesh" },
      });
      expect(response.statusCode).toBe(201);
    }
    for (const letter of ["a", "b", "c"] as const) {
      const applied = await poll(
        `${letter} applied revision 2`,
        () => getDevice(letter),
        (device) => device.appliedRevision !== null && device.appliedRevision === device.desiredRevision && device.lastPushError === null,
        120_000,
      );
      devices[letter] = applied;
    }

    const fileA = readPersisted("a");
    expect(fileA).toContain(`instance_id = "${instanceId("a")}"`);
    expect(fileA).toContain(`network_name = "${network.networkName}"`);

    for (const letter of ["a", "b", "c"] as const) {
      const config = (await ownConfig(letter)).config!;
      // The pinned client cannot echo "manual routes + empty list": api.rs only
      // reports the flag when `routes` is non-empty. The empty list itself is
      // the observable state, and the route table below proves it is enforced.
      expect(config.routes).toEqual([]);
      expect(config.proxyCidrs).toEqual([]);
      expect(config.exitNodes).toEqual([]);
    }
    // C does not accept routes and has none approved: nothing is installed.
    expect(await routeTable("c")).not.toContain(SUBNET_APPROVED);
  });

  it("turns the edited persisted config into idempotent pending proposals and adopts it", async () => {
    await dockerComposeAsync(["stop", "core-dr-a"]);
    tunnels.push(...(await openM2RelayPool("a", PORTS.dr, 6)));
    const original = readPersisted("a");
    const edited = `${original.replace("[flags]", "[flags]\nenable_exit_node = true")}\n[[proxy_network]]\ncidr = "${SUBNET_APPROVED}"\n\n[[proxy_network]]\ncidr = "${SUBNET_REJECTED}"\n`;
    dockerCopyTo(CONTAINERS.a, writePersisted("edited-a.toml", edited), `/cfg/${instanceId("a")}.toml`);
    await dockerComposeAsync(["start", "core-dr-a"]);

    const client = await poll(
      "core-dr-a reconnects with the edited file",
      async () =>
        test.context.controlPlane.listClients().find(
          (entry) => entry.latestHeartbeat?.machineId === MACHINES.a,
        ),
      (value) => value !== undefined,
      120_000,
    );
    await poll(
      "own config reports both declared CIDRs and the exit flag",
      async () => {
        try {
          const config = await client!.remote.getNetworkInstanceConfig(instanceId("a"));
          return {
            cidrs: config.config?.proxyCidrs ?? [],
            exit: Boolean(config.config?.enableExitNode),
          };
        } catch {
          return { cidrs: [], exit: false };
        }
      },
      (value) => value.cidrs.includes(SUBNET_APPROVED) && value.cidrs.includes(SUBNET_REJECTED) && value.exit,
      90_000,
    );

    const detected = await poll(
      "three pending device_declared proposals",
      networkRoutes,
      (rows) =>
        rows.filter((route) => route.source === "device_declared").length === 3 &&
        rows.every((route) => route.state === "pending"),
      90_000,
    );
    expect(detected.map((route) => route.kind).sort()).toEqual([
      "exit_node",
      "subnet",
      "subnet",
    ]);
    expect(detected.every((route) => route.advertised)).toBe(true);

    // Repeated reports do not create duplicates.
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect((await networkRoutes()).filter((route) => route.source === "device_declared")).toHaveLength(3);

    // A normal push adopts the declaration instead of erasing the operator edit.
    const push = await test.context.push.pushNow(devices.a!.id);
    expect(push.status === "pushed" || push.status === "already-in-sync").toBe(true);
    const afterPush = (await ownConfig("a")).config!;
    expect(afterPush.proxyCidrs).toEqual([SUBNET_APPROVED, SUBNET_REJECTED]);
    expect(afterPush.enableExitNode).toBe(true);
    expect(afterPush.routes).toEqual([]);
    const fileAfterPush = readPersisted("a");
    expect(fileAfterPush).toContain(SUBNET_APPROVED);
    expect(fileAfterPush).toContain(SUBNET_REJECTED);
    expect(fileAfterPush).toContain("enable_exit_node = true");
  });

  it("distributes only approved declarations and keeps exit-node egress client-side", async () => {
    const rows = await networkRoutes();
    const requireRoute = (label: string, match: (route: RouteDto) => boolean): RouteDto => {
      const route = rows.find(match);
      if (!route) {
        throw new Error(`${label} route is missing; routes=${safeStringify(rows)}`);
      }
      return route;
    };
    const approvedSubnet = requireRoute("approved subnet", (route) => route.cidr === SUBNET_APPROVED);
    const rejectedSubnet = requireRoute("rejected subnet", (route) => route.cidr === SUBNET_REJECTED);
    const exitNode = requireRoute("exit node", (route) => route.kind === "exit_node");
    for (const [route, state] of [
      [approvedSubnet, "approved"],
      [rejectedSubnet, "rejected"],
      [exitNode, "approved"],
    ] as const) {
      const response = await test.app.inject({
        method: "POST",
        url: `/api/routes/${route.id}/decision`,
        headers: headers(),
        payload: { state },
      });
      expect(response.statusCode).toBe(200);
    }

    // Receivers get exactly the approved list; the rejected one is not pushed.
    const configB = await poll(
      "core-dr-b receives only the approved route",
      () => safeConfig("b"),
      (config) =>
        config !== null &&
        JSON.stringify(config.routes) === JSON.stringify([SUBNET_APPROVED]) &&
        config.enableManualRoutes === true,
      90_000,
    );
    expect(configB).not.toBeNull();
    expect(configB!.exitNodes).toEqual([]);
    expect(await routeTable("b")).toContain(SUBNET_APPROVED);
    expect(await httpStatus("b", "http://10.99.1.10:8080/", 5)).toBe("200");

    // The advertiser keeps the approved one and the rejected one is reverted;
    // the file is rewritten by the panel.
    const configA = await poll(
      "core-dr-a keeps only the approved declared route",
      () => safeConfig("a"),
      (config) =>
        config !== null &&
        JSON.stringify(config.proxyCidrs) === JSON.stringify([SUBNET_APPROVED]) &&
        Boolean(config.enableExitNode),
      90_000,
    );
    expect(configA).not.toBeNull();
    expect(configA!.exitNodes).toEqual([]);
    const fileA = readPersisted("a");
    expect(fileA).toContain(SUBNET_APPROVED);
    expect(fileA).not.toContain(SUBNET_REJECTED);

    // A non-accepting receiver installs nothing and never uses the exit node.
    const configC = await poll(
      "core-dr-c is reachable and constrained",
      () => safeConfig("c"),
      (config) => config !== null,
      60_000,
    );
    expect(configC!.routes).toEqual([]);
    expect(configC!.exitNodes).toEqual([]);
    expect(await routeTable("c")).not.toContain(SUBNET_APPROVED);
    expect((await getDevice("a")).exitNode).toBe("approved");
    expect((await getDevice("c")).exitNode).toBe("none");

    expect(await httpStatus("c", `http://${EXIT_ONLY_TARGET}:8081/`, 3)).not.toBe("200");

    // OpenWrt-style split default: a host route keeps the control channel on
    // eth0, 0.0.0.0/1 + 128.0.0.0/1 send everything else into the TUN.
    // Every peer's public (underlay) address also needs a host route, or the
    // split default captures the peer traffic itself.
    // Steering is not enough: without exit_nodes the client never picks an
    // exit node, and the panel never pushes one.
    await execInAsync(SERVICES.c, ["ip", "route", "add", "0.0.0.0/1", "dev", "tun0"]);
    await execInAsync(SERVICES.c, ["ip", "route", "add", "128.0.0.0/1", "dev", "tun0"]);
    expect(await httpStatus("c", `http://${EXIT_ONLY_TARGET}:8081/`, 3)).not.toBe("200");

    // Client-side capability (what an Android/OpenWrt client with an exit-node
    // setting does; the panel deliberately does not push this). The panel's
    // reconciler would revert this within a second, so pause it.
    await test.context.push.stop();
    try {
    await clientFor("c").remote.runNetworkInstance({
      instId: instanceId("c"),
      config: {
        ...configC!,
        exitNodes: [devices.a!.virtualIpv4!],
        routes: [],
        enableManualRoutes: true,
      },
      overwrite: true,
      source: manage.ConfigSource.ConfigSourceWeb,
      timeoutMs: 20_000,
    });
    // Recreating the instance replaces its TUN, which drops routes that point
    // at the old device; re-add the split default now.
    await execInAsync(SERVICES.c, ["ip", "route", "add", "0.0.0.0/1", "dev", "tun0"]);
    await execInAsync(SERVICES.c, ["ip", "route", "add", "128.0.0.0/1", "dev", "tun0"]);
    await poll(
      "an exit node carries the flow once the client names it",
      () => httpStatus("c", `http://${EXIT_ONLY_TARGET}:8081/`, 5),
      (status) => status === "200",
      60_000,
    );
    } finally {
      // Restore the OS routing and the panel's own config.
      for (const route of ["0.0.0.0/1", "128.0.0.0/1"]) {
        await execInAsync(SERVICES.c, ["ip", "route", "del", route], { allowFailure: true });
      }
      test.context.push.start(1000);
      await test.context.push.pushNow(devices.c!.id);
    }
    const restored = await poll(
      "the panel restores core-dr-c without exit_nodes",
      () => safeConfig("c"),
      (config) => config !== null && JSON.stringify(config.exitNodes) === "[]",
      60_000,
    );
    expect(restored!.exitNodes).toEqual([]);
  });

  it("treats a read-only external config as locally managed, not as an error loop", async () => {
    await dockerComposeAsync(["stop", "core-dr-a"]);
    const persisted = readPersisted("a");
    const roFile = writePersisted("readonly-a.toml", persisted);
    execFileSync("chmod", ["0444", roFile]);
    forceRemove(READ_ONLY_CONTAINER);
    tunnels.push(...(await openRelayPool(M2_RELAY_IP, 23014, PORTS.dr, 12)));
    execFileSync(
      "docker",
      [
        "run", "-d", "--init", "--name", READ_ONLY_CONTAINER,
        "--cap-add", "NET_ADMIN",
        "--device", "/dev/net/tun:/dev/net/tun",
        "--network", "easyplane-conformance-m2",
        "--network-alias", "core-dr-a",
        "--hostname", "core-dr-a",
        "-v", `${roFile}:/etc/easytier/device.toml:ro`,
        "easyplane/easytier-core-test:2.6.4-81487c36",
        "--config-server", `ws://m2-relay:23004/${encodeURIComponent(inviteToken)}`,
        "--machine-id", MACHINES.a,
        "--hostname", "core-dr-a",
        "-c", "/etc/easytier/device.toml",
      ],
      { encoding: "utf8" },
    );
    const client = await poll(
      "read-only client reconnects",
      async () =>
        test.context.controlPlane.listClients().find(
          (entry) => entry.latestHeartbeat?.machineId === MACHINES.a,
        ),
      (value) => value !== undefined,
      120_000,
    );
    const meta = await client!.remote.listNetworkInstanceMeta([instanceId("a")]);
    expect(meta.metas[0]?.configPermission).toBe(3);

    const managed = await poll(
      "the panel flags the device as locally managed",
      () => getDevice("a"),
      (device) => device.configManagedLocally,
      60_000,
    );
    expect(managed.exitNode).toBe("approved");

    const before = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=500",
      headers: authed(admin),
    });
    const failuresBefore = (before.body.match(/device\.config\.push_failed/g) ?? []).length;
    const push = await test.context.push.pushNow(devices.a!.id);
    expect(push.status).toBe("skipped");
    expect(push.reason).toContain("read-only");
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const after = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=500",
      headers: authed(admin),
    });
    const failuresAfter = (after.body.match(/device\.config\.push_failed/g) ?? []).length;
    expect(failuresAfter).toBe(failuresBefore);
    expect((await getDevice("a")).lastPushError).toBeNull();
    // Peers still see the advertisement (the only remaining signal).
    expect((await routeTable("b"))).toContain(SUBNET_APPROVED);
    forceRemove(READ_ONLY_CONTAINER);
  });

  it("documents the renamed-file and foreign-instance-id limits", async () => {
    // Same instance id, different file name: the file is inside the config dir
    // but not `<instance-id>.toml`, so it is NO_DELETE (but still editable) and
    // a push overwrites it in place.
    await dockerComposeAsync(["stop", "core-dr-a"]);
    tunnels.push(...(await openM2RelayPool("a", PORTS.dr, 6)));
    const persisted = readPersisted("a");
    rmSync(join(CFG_DIRS.a, `${instanceId("a")}.toml`), { force: true });
    writeFileSync(join(CFG_DIRS.a, "renamed.toml"), persisted, { mode: 0o644 });
    await dockerComposeAsync(["start", "core-dr-a"]);
    const renamedClient = await poll(
      "renamed-file client reconnects",
      async () =>
        test.context.controlPlane.listClients().find(
          (entry) => entry.latestHeartbeat?.machineId === MACHINES.a,
        ),
      (value) => value !== undefined,
      120_000,
    );
    await poll(
      "the renamed instance id is still the managed one",
      () => renamedClient!.remote.listNetworkInstance(),
      (ids) => ids.includes(instanceId("a")),
      60_000,
    );
    await test.context.push.pushNow(devices.a!.id);
    const renamed = readFileSync(join(CFG_DIRS.a, "renamed.toml"), "utf8");
    expect(renamed).toContain(SUBNET_APPROVED);
    expect(renamed).toContain("instance_id");

    // A foreign instance id: the panel's deterministic id is absent, so its
    // reconciler creates a second instance instead of adopting the file.
    await dockerComposeAsync(["stop", "core-dr-a"]);
    tunnels.push(...(await openM2RelayPool("a", PORTS.dr, 6)));
    const foreignId = "99999999-9999-4999-8999-999999999999";
    const foreign = persisted
      .replace(/instance_id = "[^"]+"/, `instance_id = "${foreignId}"`)
      .replace(/ipv4 = "[^"]+"/, `ipv4 = "${RESPONSE_CIDR}/24"`)
      .replace(/listeners = \[[^\]]*\]/, 'listeners = ["tcp://0.0.0.0:11031"]')
      .replace(SUBNET_APPROVED, SUBNET_STRANGER)
      .replace(/\[\[proxy_network\]\]\ncidr = "[^"]+"\n/, `[[proxy_network]]\ncidr = "${SUBNET_STRANGER}"\n`);
    const foreignWithPeer = foreign.includes("[[peer]]")
      ? foreign
      : `${foreign}\n[[peer]]\nuri = "tcp://127.0.0.1:${LISTENERS.a}"\n`;
    writeFileSync(join(CFG_DIRS.a, "renamed.toml"), foreignWithPeer, { mode: 0o644 });
    await dockerComposeAsync(["start", "core-dr-a"]);

    const foreignClient = await poll(
      "foreign-id client reconnects",
      async () =>
        test.context.controlPlane.listClients().find(
          (entry) => entry.latestHeartbeat?.machineId === MACHINES.a,
        ),
      (value) => value !== undefined,
      120_000,
    );
    await poll(
      "the panel creates its own instance next to the foreign one",
      () => foreignClient!.remote.listNetworkInstance(),
      (ids) => ids.includes(foreignId) && ids.includes(instanceId("a")),
      90_000,
    );
    // No proposal is created from a foreign instance (own-config detection is
    // scoped to the managed instance), and receivers never install it.
    // Give the two instances a common meeting point: a raw network peer URL
    // for the foreign listener. This is test setup, not panel behaviour.
    const peerAdded = await test.app.inject({
      method: "POST",
      url: `/api/networks/${network.id}/peers`,
      headers: headers(),
      payload: { url: `tcp://core-dr-a:11031` },
    });
    expect(peerAdded.statusCode).toBe(201);
    const rows = await networkRoutes();
    expect(rows.some((route) => route.cidr === SUBNET_STRANGER)).toBe(false);
    expect(await routeTable("b")).not.toContain(SUBNET_STRANGER);
    const peerSeen = await poll(
      "peers see the foreign instance as an unknown advertisement",
      async () => {
        const response = await test.app.inject({
          method: "GET",
          url: `/api/networks/${network.id}/routes`,
          headers: authed(admin),
        });
        const body = response.json() as {
          reports: Array<{
            report: {
              unknownPeers: Array<{ ipv4: string; proxyCidrs: string[] }>;
            } | null;
          }>;
        };
        return body.reports
          .flatMap((entry) => entry.report?.unknownPeers ?? [])
          .find((peer) => peer.proxyCidrs.includes(SUBNET_STRANGER)) ?? null;
      },
      (value) => value !== null,
      90_000,
    );
    expect(peerSeen!.proxyCidrs).toContain(SUBNET_STRANGER);
  });
});
