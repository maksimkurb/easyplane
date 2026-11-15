import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  // The relay container may still be starting its Python entrypoint.
  const deadline = Date.now() + 20_000;
  const connectOnce = (): Promise<Socket> =>
    new Promise<Socket>((resolveSocket, reject) => {
      const candidate = connect({ host: M2_RELAY_IP, port: hostPort });
      const timer = setTimeout(() => {
        candidate.destroy();
        reject(new Error(`relay host port ${hostPort} did not accept a connection`));
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
    dockerCompose(["down", "--remove-orphans", "--timeout", "5"]);
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
      `network instance did not reach running=true; last info: ${JSON.stringify(info)}; ` +
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
