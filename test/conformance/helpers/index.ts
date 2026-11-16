import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { manage } from "@easyplane/proto";
import { protoToUuid } from "@easyplane/shared";
import {
  ControlPlaneServer,
  type ControlPlaneOptions,
  type ManagedClient,
  buildMinimalNetworkConfig,
  createSilentLogger,
} from "@easyplane/server";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const COMPOSE_FILE = join(REPO_ROOT, "docker-compose.test.yml");

/**
 * `JSON.stringify` for diagnostics built by the conformance helpers/poll loops.
 *
 * EasyTier protobuf payloads carry int64 fields as `BigInt` (route costs, peer
 * ids, timestamps), and `JSON.stringify` throws `Do not know how to serialize a
 * BigInt` on them -- turning a "condition not met" poll timeout into an
 * unrelated TypeError that hides the real failure. BigInts become strings,
 * Errors keep their message and cycles are marked instead of throwing.
 */
export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key, entry: unknown) => {
        if (typeof entry === "bigint") return entry.toString();
        if (entry instanceof Error) return `${entry.name}: ${entry.message}`;
        if (typeof entry === "object" && entry !== null) {
          if (seen.has(entry)) return "[circular]";
          seen.add(entry);
        }
        return entry;
      }) ?? String(value)
    );
  } catch (error) {
    return `<unserializable: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

/** Fixed test ports; each conformance file owns one to avoid cross-talk. */
export const PORTS = {
  ws: 22080,
  tcp: 22081,
  wss: 22082,
  secure: 22083,
  plain: 22084,
  badToken: 22085,
  m1: 22086,
  /** M2 three-node mesh (bridge network, host.docker.internal). */
  m2: 22087,
  /** M3 relay-only topology + SSE (same containers as M2, separate server). */
  m3: 22088,
  /** UDP session layer (SYN/SACK/DATA/FIN). */
  udp: 22089,
  /** M4 import/adoption. */
  m4: 22091,
  /** Hub/leaf topology: the hub must never dial itself. */
  hub: 22092,
  /** Rendezvous node conformance (public node, relay off/on, private mode). */
  rendezvous: 22093,
  /** Credential mode: anchors, members, revoke and the no-anchor window. */
  credentials: 22094,
  /** Declared-routes spike: one managed instance per device + config dir. */
  dr: 22096,
} as const;

/** Fixed addresses of the rendezvous conformance topology (docker-compose.test.yml). */
export const RENDEZVOUS_TOPOLOGY = {
  /** The node's address on each of its three data networks. */
  node: {
    direct: "172.29.0.10",
    a: "172.29.1.10",
    b: "172.29.2.10",
  },
  /**
   * Fixed underlay addresses of the leaf containers: the data network the leaf
   * shares with the node, and the private control network that carries only its
   * config-server tunnel. Tests use them to forbid leaf-to-leaf underlay
   * traffic (see `underlayBlockList`).
   */
  leaf: {
    "direct-a": { data: "172.29.0.11", control: "172.32.1.11" },
    "direct-b": { data: "172.29.0.12", control: "172.32.2.11" },
    "iso-a": { data: "172.29.1.11", control: "172.32.3.11" },
    "iso-b": { data: "172.29.2.11", control: "172.32.4.11" },
  },
  /** Relay address on the per-leaf control networks (config-server tunnels). */
  relay: {
    a: "172.32.1.10",
    b: "172.32.2.10",
    c: "172.32.3.10",
    d: "172.32.4.10",
  },
  /** Relay client ports inside each control network. */
  clientPort: { a: 23021, b: 23022, c: 23023, d: 23024 },
  /** Relay host-pool ports the vitest process dials. */
  hostPort: { a: 23031, b: 23032, c: 23033, d: 23034 },
  /** Explicitly named compose networks (docker-compose.test.yml). */
  network: {
    direct: "easyplane-conformance-rv-direct",
    a: "easyplane-conformance-rv-a",
    b: "easyplane-conformance-rv-b",
  },
  secret: "rv-conformance-secret",
  networkName: "rv-node-net",
} as const;

export function dockerCompose(
  args: string[],
  env: Record<string, string> = {},
): string {
  const result = spawnSync(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "--profile", "test", ...args],
    {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `docker compose ${args.join(" ")} failed (exit ${result.status})\n` +
        `stdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout ?? "";
}

const execFileAsync = promisify(execFile);

/**
 * Async docker compose. The synchronous variant above blocks the Node event
 * loop, which makes a co-hosted control plane miss config-server heartbeats.
 * Tests that talk to a live app must use this one.
 */
export async function dockerComposeAsync(
  args: string[],
  env: Record<string, string> = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", COMPOSE_FILE, "--profile", "test", ...args],
      {
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return stdout ?? "";
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    throw new Error(
      `docker compose ${args.join(" ")} failed (exit ${String(failure.code)}): ` +
        `${failure.message ?? ""}\nstdout:\n${failure.stdout ?? ""}\nstderr:\n${failure.stderr ?? ""}`,
    );
  }
}

export function requireDockerConformanceEnvironment(): void {
  if (existsSync(join(REPO_ROOT, "docker/easytier-core/easytier-core")) === false) {
    throw new Error(
      "missing docker/easytier-core/easytier-core; run scripts/build-test-client.sh " +
        "to build the real easytier-core from the pinned upstream commit",
    );
  }
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 30_000 });
  } catch {
    throw new Error("docker is not available; the conformance suite needs a real easytier-core container");
  }
  if (!existsSync("/dev/net/tun")) {
    throw new Error("missing /dev/net/tun; the conformance client needs a TUN device");
  }
}

/**
 * Tears the conformance compose project down (containers, networks, volumes).
 *
 * Conformance files run sequentially in one vitest process and every file uses
 * the same compose project, so a file that crashes mid-way (or an aborted CI
 * job) can leave containers, networks and their subnets behind for the next
 * file. Every file therefore starts from an *empty* project: leftover
 * containers cannot serve a stale config (e.g. a rendezvous node still created
 * with relay enabled) and leftover networks cannot satisfy an `up` with
 * different ipam settings. `-v` is what makes the teardown complete; without it
 * the project's volumes survive and `down` is not the inverse of `up`.
 */
export function resetConformanceProject(): void {
  try {
    dockerCompose(["down", "-v", "--remove-orphans", "--timeout", "5"]);
  } catch {
    // Nothing to remove, or docker is already unhappy; the tests below report
    // a real failure with their own message.
  }
}

/**
 * Checks the docker/TUN prerequisites and gives the file a clean compose
 * project. Every conformance file calls this once from `beforeAll`.
 */
export function prepareDockerConformanceEnvironment(): void {
  requireDockerConformanceEnvironment();
  resetConformanceProject();
}

export interface CoreHandle {
  /** Compose service name (core-ws, core-tcp, ...). */
  readonly service: string;
  readonly url: string;
  logs(): string;
  stop(): void;
  start(): void;
}

/**
 * Start one real easytier-core container from the `test` compose profile.
 * The container uses host networking, so it reaches the vitest-hosted server on
 * 127.0.0.1.
 */
export function startCore(service: string, url: string): CoreHandle {
  const envKey = composeUrlEnv(service);
  const handle: CoreHandle = {
    service,
    url,
    logs: () => dockerCompose(["logs", "--no-color", "--no-log-prefix", service]),
    stop: () => dockerCompose(["stop", service], { [envKey]: url }),
    start: () => dockerCompose(["start", service], { [envKey]: url }),
  };
  dockerCompose(["up", "-d", "--force-recreate", service], { [envKey]: url });
  return handle;
}

function composeUrlEnv(service: string): string {
  switch (service) {
    case "core-ws":
    case "core-ws-secure":
      return "EASYPLANE_CORE_WS_URL";
    case "core-wss":
      return "EASYPLANE_CORE_WSS_URL";
    case "core-tcp":
      return "EASYPLANE_CORE_TCP_URL";
    case "core-udp":
      return "EASYPLANE_CORE_UDP_URL";
    case "core-plain":
      return "EASYPLANE_CORE_PLAIN_URL";
    case "core-bad-token":
      return "EASYPLANE_CORE_BAD_TOKEN_URL";
    case "core-m2-a":
      return "EASYPLANE_M2_A_URL";
    case "core-m2-b":
      return "EASYPLANE_M2_B_URL";
    case "core-m2-c":
      return "EASYPLANE_M2_C_URL";
    case "core-m4":
      return "EASYPLANE_M4_URL";
    case "core-dr-a":
      return "EASYPLANE_DR_A_URL";
    case "core-dr-b":
      return "EASYPLANE_DR_B_URL";
    case "core-dr-c":
      return "EASYPLANE_DR_C_URL";
    case "core-rv-direct-a":
      return "EASYPLANE_RV_DIRECT_A_URL";
    case "core-rv-direct-b":
      return "EASYPLANE_RV_DIRECT_B_URL";
    case "core-rv-iso-a":
      return "EASYPLANE_RV_ISO_A_URL";
    case "core-rv-iso-b":
      return "EASYPLANE_RV_ISO_B_URL";
    default:
      throw new Error(`unknown compose service: ${service}`);
  }
}

/**
 * M2 topology: the relay container has a fixed address on the compose network.
 * The host dials its "host pool" ports (host -> container is allowed without
 * firewall changes), and the easytier clients dial the paired "client" ports.
 */
export const M2_RELAY_IP = "172.28.0.10";
/** Client-side ports of the relay, one tunnel per container. */
export const M2_TUNNEL_PORTS = { a: 23001, b: 23002, c: 23003 } as const;
const M2_HOST_PORTS = [23011, 23012, 23013] as const;

/** Starts the test-only TCP relay used by the M2 mesh. */
export function startM2Relay(): void {
  dockerCompose(["up", "-d", "--force-recreate", "m2-relay"]);
}

/**
 * Opens the host side of a relay tunnel. Each easytier-core config-server
 * connection (including the Noise re-connect) consumes one socket, so a small
 * pool is pre-opened per device.
 */
export async function openM2RelayPool(
  letter: "a" | "b" | "c",
  serverPort: number,
  count = 8,
): Promise<Socket[]> {
  const hostPort = M2_HOST_PORTS[["a", "b", "c"].indexOf(letter)]!;
  return openRelayPool(M2_RELAY_IP, hostPort, serverPort, count);
}

/**
 * Opens the host side of one relay tunnel at an explicit relay address. Used
 * by the rendezvous topology, where every leaf has its own control network and
 * therefore its own relay IP.
 */
export async function openRelayPool(
  relayIp: string,
  hostPort: number,
  serverPort: number,
  count = 8,
): Promise<Socket[]> {
  // The relay container may still be starting its Python entrypoint.
  const deadline = Date.now() + 20_000;
  const connectOnce = (): Promise<Socket> =>
    new Promise<Socket>((resolveSocket, reject) => {
      const candidate = connect({ host: relayIp, port: hostPort });
      const timer = setTimeout(() => {
        candidate.destroy();
        reject(new Error(`relay host port ${relayIp}:${hostPort} did not accept a connection`));
      }, 5_000);
      candidate.once("connect", () => {
        clearTimeout(timer);
        candidate.setNoDelay(true);
        resolveSocket(candidate);
      });
      candidate.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  const connectLocal = (): Promise<Socket> =>
    new Promise<Socket>((resolveSocket, reject) => {
      const candidate = connect({ host: "127.0.0.1", port: serverPort });
      candidate.once("connect", () => {
        candidate.setNoDelay(true);
        resolveSocket(candidate);
      });
      candidate.once("error", reject);
    });
  const sockets: Socket[] = [];
  for (let index = 0; index < count; index += 1) {
    let relaySocket: Socket | undefined;
    for (;;) {
      try {
        relaySocket = await connectOnce();
        break;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    // Last hop: the pool socket is piped to the local control plane, so from
    // easytier-core's point of view it is dialling the server directly.
    const local = await connectLocal();
    relaySocket.on("error", () => local.destroy());
    local.on("error", () => relaySocket.destroy());
    relaySocket.pipe(local);
    local.pipe(relaySocket);
    sockets.push(relaySocket, local);
  }
  return sockets;
}

/**
 * The `EASYPLANE_UNDERLAY_BLOCK` value that forbids this leaf from reaching the
 * *underlay* addresses (docker data and control addresses) of the given peer
 * leaves.
 *
 * Why the test has to do this itself: "the isolated pair cannot reach each
 * other directly" is the premise of the relay-off/on assertions, and it used to
 * be provided implicitly by the docker daemon's inter-bridge isolation rules
 * (`DOCKER-ISOLATION-STAGE-*`). That is ambient kernel/daemon state outside the
 * test: when those rules are missing or not effective on a runner, two
 * containers on different bridges route to each other and easytier establishes
 * a *direct* peer (`cost=1`), so relay-off traffic passes and the suite fails on
 * a runner-dependent detail instead of on the node's relay behaviour.
 *
 * The address list is applied by `test/conformance/rendezvous/leaf-entrypoint.sh`
 * inside the leaf's own network namespace *before* easytier starts, so no direct
 * peer connection can ever form. Nothing else is affected: the node's own
 * addresses stay reachable, and relayed data arrives from the node's address
 * (not from the peer), so relay ON still works.
 */
export function underlayBlockList(
  peers: ReadonlyArray<keyof typeof RENDEZVOUS_TOPOLOGY.leaf>,
): string {
  const addresses = new Set<string>();
  for (const peer of peers) {
    const entry = RENDEZVOUS_TOPOLOGY.leaf[peer];
    addresses.add(`${entry.data}/32`);
    addresses.add(`${entry.control}/32`);
  }
  return [...addresses].join(",");
}

/** True when `service` can reach the underlay `address` (ICMP). */
export async function underlayReachable(service: string, address: string): Promise<boolean> {
  const result = await execInAsync(service, ["ping", "-c", "1", "-W", "1", address], {
    allowFailure: true,
  });
  return result.status === 0;
}

/**
 * Reports whether the docker daemon's inter-bridge isolation is effective on
 * this host: a throwaway container on `fromNetwork` pings an address that lives
 * on another conformance bridge. `true` means the ambient premise the old
 * rendezvous test relied on is broken here (bridges route to each other), which
 * is exactly the condition the leaves now neutralise themselves.
 *
 * Diagnostic only: never asserted, and it cannot mask a test failure.
 */
export async function probeDockerBridgeIsolation(
  fromNetwork: string,
  toAddress: string,
): Promise<boolean> {
  try {
    await execFileAsync(
      "docker",
      [
        "run", "--rm",
        "--network", fromNetwork,
        "--entrypoint", "ping",
        "easyplane/easytier-core-test:2.6.4-81487c36",
        "-c", "1", "-W", "1", toAddress,
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Diagnostic bundle for the rendezvous data-path assertions: each leaf's own
 * addresses and routing table, which shows whether the `prohibit` isolation from
 * `EASYPLANE_UNDERLAY_BLOCK` is in place and whether an unexpected route to the
 * other leaf exists.
 */
export async function underlayDiagnostics(
  services: ReadonlyArray<{ label: string; service: string }>,
): Promise<string> {
  const parts: string[] = [];
  for (const { label, service } of services) {
    const addresses = await execInAsync(service, ["ip", "-brief", "addr"], {
      allowFailure: true,
    });
    const routes = await execInAsync(service, ["ip", "route", "show"], {
      allowFailure: true,
    });
    parts.push(
      `--- ${label} (${service}) addresses:\n${addresses.stdout.trim()}\n` +
        `--- ${label} (${service}) routes:\n${routes.stdout.trim()}`,
    );
  }
  return parts.join("\n");
}

/** Starts the test-only relay that carries the rendezvous config-server tunnels. */
export async function startRendezvousRelay(): Promise<void> {
  await dockerComposeAsync(["up", "-d", "--force-recreate", "rv-relay"]);
}

export interface RendezvousHandle {
  readonly service: string;
  logs(): Promise<string>;
  stop(): Promise<void>;
}

/**
 * Starts the real pinned easytier-core rendezvous node. `env` overrides the
 * compose interpolation of the node's RENDEZVOUS_* variables (relay on/off,
 * private mode, whitelist). The node is recreated, so a restart applies them.
 *
 * Async on purpose: these tests host the control plane in this process, and a
 * blocking docker call would make the panel miss config-server heartbeats.
 */
export async function startRendezvous(
  env: Record<string, string> = {},
): Promise<RendezvousHandle> {
  const values = {
    EASYPLANE_RV_SECRET: RENDEZVOUS_TOPOLOGY.secret,
    EASYPLANE_RV_NETWORK_NAME: RENDEZVOUS_TOPOLOGY.networkName,
    ...env,
  };
  await dockerComposeAsync(
    ["up", "-d", "--force-recreate", "rendezvous"],
    values,
  );
  return {
    service: "rendezvous",
    logs: () =>
      dockerComposeAsync(
        ["logs", "--no-color", "--no-log-prefix", "rendezvous"],
        values,
      ),
    stop: async () => {
      await dockerComposeAsync(["stop", "rendezvous"], values);
    },
  };
}

/** Stops the rendezvous node without removing its container. */
export async function stopRendezvous(
  env: Record<string, string> = {},
): Promise<void> {
  await dockerComposeAsync(["stop", "rendezvous"], {
    EASYPLANE_RV_SECRET: RENDEZVOUS_TOPOLOGY.secret,
    ...env,
  });
}

/** Starts one real pinned easytier-core leaf service from the test profile. */
export async function startRvCore(
  service: string,
  url: string,
  underlayBlock = "",
): Promise<CoreHandle> {
  const envKey = composeUrlEnv(service);
  const handle: CoreHandle = {
    service,
    url,
    logs: () => dockerCompose(["logs", "--no-color", "--no-log-prefix", service]),
    stop: () => dockerCompose(["stop", service], { [envKey]: url }),
    start: () => dockerCompose(["start", service], { [envKey]: url }),
  };
  await dockerComposeAsync(["up", "-d", "--force-recreate", service], {
    [envKey]: url,
    EASYPLANE_RV_UNDERLAY_BLOCK: underlayBlock,
  });
  return handle;
}

/** Stops one rendezvous conformance service. */
export function stopService(service: string): void {
  dockerCompose(["stop", service]);
}

/** Runs a command inside a running conformance container and returns stdout. */
export function execIn(
  service: string,
  command: string[],
  options: { timeoutMs?: number; allowFailure?: boolean } = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "--profile", "test", "exec", "-T", service, ...command],
    {
      env: process.env,
      encoding: "utf8",
      timeout: options.timeoutMs ?? 30_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `docker compose exec ${service} ${command.join(" ")} failed (exit ${result.status})\n` +
        `stdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
    );
  }
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Async `execIn` for tests with a live control plane (does not block heartbeats). */
export async function execInAsync(
  service: string,
  command: string[],
  options: { timeoutMs?: number; allowFailure?: boolean } = {},
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      [
        "compose",
        "-f",
        COMPOSE_FILE,
        "--profile",
        "test",
        "exec",
        "-T",
        service,
        ...command,
      ],
      {
        env: process.env,
        encoding: "utf8",
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return { status: 0, stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    if (options.allowFailure) {
      return {
        status: typeof failure.code === "number" ? failure.code : -1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
      };
    }
    throw new Error(
      `docker compose exec ${service} ${command.join(" ")} failed (exit ${String(failure.code)})\n` +
        `stdout:\n${failure.stdout ?? ""}\nstderr:\n${failure.stderr ?? ""}`,
    );
  }
}

/** Async `execDetached` for tests with a live control plane. */
export async function execDetachedAsync(
  service: string,
  command: string[],
): Promise<void> {
  await dockerComposeAsync([
    "exec",
    "-d",
    "-T",
    service,
    ...command,
  ]);
}

/** Starts a detached command inside a container (e.g. an HTTP server). */
export function execDetached(service: string, command: string[]): void {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      COMPOSE_FILE,
      "--profile",
      "test",
      "exec",
      "-d",
      "-T",
      service,
      ...command,
    ],
    { env: process.env, encoding: "utf8", timeout: 30_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `docker compose exec -d ${service} failed: ${result.stderr ?? result.stdout}`,
    );
  }
}

export function stopAllCores(): void {
  try {
    dockerCompose(["down", "-v", "--remove-orphans", "--timeout", "5"]);
  } catch {
    // Best-effort teardown; a failed test already reported its own error.
  }
}

export interface TestServer {
  server: ControlPlaneServer;
  stop: () => Promise<void>;
}

export async function startTestServer(options: ControlPlaneOptions): Promise<TestServer> {
  const server = new ControlPlaneServer({
    host: "127.0.0.1",
    logger: createSilentLogger(),
    ...options,
  });
  await server.start();
  return {
    server,
    stop: async () => {
      await server.stop();
    },
  };
}

export function generateSelfSignedCert(): { certFile: string; keyFile: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "easyplane-cert-"));
  const certFile = join(dir, "cert.pem");
  const keyFile = join(dir, "key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      certFile,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" },
  );
  return { certFile, keyFile, dir };
}

export function removeCert(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function ipv4ToU32(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`invalid ipv4: ${ip}`);
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

export const CONFORMANCE_INSTANCE_ID = "7f3e4b7e-9a51-4a49-9d3b-1f6f0b6a2f10";
export const CONFORMANCE_NETWORK_NAME = "easyplane-conformance";
export const CONFORMANCE_NETWORK_SECRET = "conformance-secret";
export const CONFORMANCE_HOSTNAME = "conformance-node";

export function conformanceNetworkConfig(): manage.NetworkConfig {
  const noTun = process.env.EASYPLANE_CONFORMANCE_NO_TUN === "1";
  return buildMinimalNetworkConfig({
    instanceId: CONFORMANCE_INSTANCE_ID,
    networkName: CONFORMANCE_NETWORK_NAME,
    networkSecret: CONFORMANCE_NETWORK_SECRET,
    hostname: CONFORMANCE_HOSTNAME,
    virtualIpv4: "10.144.144.1",
    networkLength: 24,
    networkingMethod: "standalone",
    noTun,
  });
}

/** A config whose RunNetworkInstance body exceeds one TCP MTU. */
export function largeConformanceNetworkConfig(): manage.NetworkConfig {
  const noTun = process.env.EASYPLANE_CONFORMANCE_NO_TUN === "1";
  const whitelist = Array.from({ length: 300 }, (_, index) => `whitelist-${String(index).padStart(3, "0")}`);
  return buildMinimalNetworkConfig({
    instanceId: CONFORMANCE_INSTANCE_ID,
    networkName: CONFORMANCE_NETWORK_NAME,
    networkSecret: CONFORMANCE_NETWORK_SECRET,
    hostname: CONFORMANCE_HOSTNAME,
    virtualIpv4: "10.144.144.1",
    networkLength: 24,
    networkingMethod: "standalone",
    noTun,
    enableRelayNetworkWhitelist: true,
    relayNetworkWhitelist: whitelist,
  });
}

export interface M0Evidence {
  transport: string;
  secure: boolean;
  heartbeats: number;
  heartbeatIntervalMs: number;
  validateToml: string;
  runInstanceId: string;
  listContainsInstance: boolean;
  running: boolean;
  virtualIpv4: number;
  networkLength: number;
  reportedHostname: string;
  clientVersion: string;
  configNetworkName: string;
  configNetworkSecret: string;
  configSource: manage.ConfigSource;
  metaNetworkName: string;
  heartbeatReportsInstance: boolean;
}

/**
 * Exercises brief M0 (c), (d), (e) against a connected real client:
 * Heartbeat/GetFeature, RunNetworkInstance, CollectNetworkInfo,
 * ListNetworkInstance, GetNetworkInstanceConfig, ListNetworkInstanceMeta.
 */
export async function assertM0ClientBehaviour(client: ManagedClient): Promise<M0Evidence> {
  // (c) Heartbeat + GetFeature. GetFeature already ran before the first
  // heartbeat: clients reconnect for the secure tunnel only when the server
  // advertised support_encryption=true.
  await client.waitForHeartbeats(3, 20_000);
  const heartbeat = client.latestHeartbeat;
  if (!heartbeat) throw new Error("client did not send a heartbeat");
  const beats = client.heartbeatHistory.slice(-3).map((beat) => beat.receivedAt);
  const heartbeatIntervalMs = ((beats[2]! - beats[0]!) / 2);

  const config = conformanceNetworkConfig();

  // (d) RunNetworkInstance with a minimal NetworkConfig.
  const validated = await client.remote.validateConfig(config);
  const run = await client.remote.runNetworkInstance({
    instId: CONFORMANCE_INSTANCE_ID,
    config,
    overwrite: true,
  });
  const runInstanceId = run.instId ? protoToUuid(run.instId) : "";

  // (e) CollectNetworkInfo polling until the instance reports running=true.
  let info: manage.NetworkInstanceRunningInfo | undefined;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const collected = await client.remote.collectNetworkInfo([CONFORMANCE_INSTANCE_ID]);
    info = collected.info?.map[CONFORMANCE_INSTANCE_ID];
    if (info?.running) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!info?.running) {
    throw new Error(
      `network instance did not reach running=true; last info: ${safeStringify(info)}; ` +
        `client error: ${info?.errorMsg ?? "none"}`,
    );
  }

  const list = await client.remote.listNetworkInstance();
  const configResponse = await client.remote.getNetworkInstanceConfig(CONFORMANCE_INSTANCE_ID);
  const metaResponse = await client.remote.listNetworkInstanceMeta([CONFORMANCE_INSTANCE_ID]);

  // The client reports running instances in subsequent heartbeats; wait for
  // one that includes the pushed instance.
  const heartbeatDeadline = Date.now() + 15_000;
  let heartbeatReportsInstance = false;
  while (Date.now() < heartbeatDeadline) {
    if (client.latestHeartbeat?.runningNetworkInstances.includes(CONFORMANCE_INSTANCE_ID)) {
      heartbeatReportsInstance = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const virtualIpv4 = info.myNodeInfo?.virtualIpv4;
  return {
    transport: client.transportKind,
    secure: client.secure,
    heartbeats: client.heartbeatCount,
    heartbeatIntervalMs,
    validateToml: validated.tomlConfig,
    runInstanceId,
    listContainsInstance: list.includes(CONFORMANCE_INSTANCE_ID),
    running: info.running,
    virtualIpv4: virtualIpv4?.address?.addr ?? -1,
    networkLength: virtualIpv4?.networkLength ?? 0,
    reportedHostname: info.myNodeInfo?.hostname ?? "",
    clientVersion: info.myNodeInfo?.version ?? heartbeat.easytierVersion,
    configNetworkName: configResponse.config?.networkName ?? "",
    configNetworkSecret: configResponse.config?.networkSecret ?? "",
    configSource: configResponse.source,
    metaNetworkName: metaResponse.metas[0]?.networkName ?? "",
    heartbeatReportsInstance,
  };
}
