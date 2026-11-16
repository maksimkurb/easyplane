import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { manage } from "@easyplane/proto";
import {
  CONFORMANCE_HOSTNAME,
  CONFORMANCE_INSTANCE_ID,
  PORTS,
  assertM0ClientBehaviour,
  conformanceNetworkConfig,
  ipv4ToU32,
  largeConformanceNetworkConfig,
  prepareDockerConformanceEnvironment,
  startCore,
  startTestServer,
  stopAllCores,
} from "./helpers/index.js";
import type { CoreHandle, TestServer } from "./helpers/index.js";

const TOKEN = "token-ws";
const URL = `ws://127.0.0.1:${PORTS.ws}/${TOKEN}`;

let harness: TestServer | undefined;
let core: CoreHandle | undefined;

beforeAll(() => {
  prepareDockerConformanceEnvironment();
});

afterAll(async () => {
  stopAllCores();
  await harness?.stop();
});

describe("M0 conformance: ws:// config-server", () => {
  it("accepts a real easytier-core, upgrades to the Noise tunnel, and drives instances", async () => {
    harness = await startTestServer({ wsPort: PORTS.ws, allowedTokens: [TOKEN] });
    core = startCore("core-ws", URL);

    const client = await harness.server.waitForClient({ timeoutMs: 40_000 });
    expect(client.transportKind).toBe("ws");
    // The client reconnects over the web-secure tunnel because GetFeature
    // advertised support_encryption=true (web_client.rs).
    expect(client.secure).toBe(true);
    expect(client.latestHeartbeat?.hostname).toBe("core-ws");
    expect(client.latestHeartbeat?.userToken).toBe(TOKEN);

    const evidence = await assertM0ClientBehaviour(client);
    expect(evidence.transport).toBe("ws");
    expect(evidence.secure).toBe(true);
    expect(evidence.heartbeatIntervalMs).toBeGreaterThan(500);
    expect(evidence.heartbeatIntervalMs).toBeLessThan(2500);
    expect(evidence.validateToml).toContain('network_name = "easyplane-conformance"');
    expect(evidence.runInstanceId).toBe(CONFORMANCE_INSTANCE_ID);
    expect(evidence.listContainsInstance).toBe(true);
    expect(evidence.running).toBe(true);
    expect(evidence.virtualIpv4).toBe(ipv4ToU32("10.144.144.1"));
    expect(evidence.networkLength).toBe(24);
    expect(evidence.reportedHostname).toBe(CONFORMANCE_HOSTNAME);
    expect(evidence.configNetworkName).toBe("easyplane-conformance");
    expect(evidence.configNetworkSecret).toBe("conformance-secret");
    expect(evidence.configSource).toBe(2); // ConfigSourceWeb
    expect(evidence.metaNetworkName).toBe("easyplane-conformance");
    expect(evidence.heartbeatReportsInstance).toBe(true);
  }, 180_000);

  it("pushes a config larger than one TCP MTU using RPC piece splitting", async () => {
    if (!harness) throw new Error("previous test did not start the harness");
    const client = harness.server.listClients()[0];
    if (!client) throw new Error("no active client");

    const config = largeConformanceNetworkConfig();
    const bodyLength = manage.RunNetworkInstanceRequest.encode({
      instId: { part1: 0, part2: 0, part3: 0, part4: 0 },
      config,
      overwrite: true,
      source: manage.ConfigSource.ConfigSourceWeb,
    }).finish().length;
    // The upstream TCP reader caps frames at 2000 bytes, so this config must be
    // split into multiple RpcPacket pieces by the server.
    expect(bodyLength).toBeGreaterThan(4000);

    await client.remote.runNetworkInstance({
      instId: CONFORMANCE_INSTANCE_ID,
      config,
      overwrite: true,
    });

    const deadline = Date.now() + 30_000;
    let pushed: manage.GetNetworkInstanceConfigResponse | undefined;
    while (Date.now() < deadline) {
      pushed = await client.remote.getNetworkInstanceConfig(CONFORMANCE_INSTANCE_ID);
      if (pushed.config?.relayNetworkWhitelist.length === 300) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    // Reassembly on the client proves every piece arrived.
    expect(pushed?.config?.relayNetworkWhitelist).toHaveLength(300);
    expect(pushed?.config?.relayNetworkWhitelist[0]).toBe("whitelist-000");
    expect(pushed?.config?.relayNetworkWhitelist[299]).toBe("whitelist-299");
  }, 180_000);

  it("survives a client restart (1 s retry) without leaking sessions and can re-push state", async () => {
    if (!harness || !core) throw new Error("previous test did not start the harness");
    const original = harness.server.listClients()[0];
    if (!original) throw new Error("no active client");
    const firstSessionInstId = original.latestHeartbeat?.instId;

    const killedAt = Date.now();
    core.stop();
    await original.waitForClose(30_000);
    expect(harness.server.listClients()).toHaveLength(0);

    core.start();
    const reconnected = await harness.server.waitForClient({ timeoutMs: 40_000 });
    await reconnected.waitForHeartbeats(3, 30_000);
    const reconnectMs = Date.now() - killedAt;

    expect(harness.server.listClients()).toHaveLength(1);
    expect(reconnected.isClosed).toBe(false);
    // A fresh tunnel/session was established by the client.
    expect(reconnected.latestHeartbeat?.instId).not.toBe(firstSessionInstId);
    expect(reconnectMs).toBeLessThan(30_000);

    // The server can restore desired state after the reconnect.
    const config = conformanceNetworkConfig();
    await reconnected.remote.runNetworkInstance({
      instId: CONFORMANCE_INSTANCE_ID,
      config,
      overwrite: true,
    });
    const deadline = Date.now() + 30_000;
    let running = false;
    while (Date.now() < deadline) {
      const collected = await reconnected.remote.collectNetworkInfo([CONFORMANCE_INSTANCE_ID]);
      running = collected.info?.map[CONFORMANCE_INSTANCE_ID]?.running ?? false;
      if (running) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(running).toBe(true);
  }, 180_000);
});
