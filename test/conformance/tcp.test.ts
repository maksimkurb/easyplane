import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CONFORMANCE_INSTANCE_ID,
  PORTS,
  assertM0ClientBehaviour,
  ipv4ToU32,
  prepareDockerConformanceEnvironment,
  startCore,
  startTestServer,
  stopAllCores,
} from "./helpers/index.js";
import type { CoreHandle, TestServer } from "./helpers/index.js";

const TOKEN = "token-tcp";
// easytier clears the URL path for non-websocket schemes; the token travels in
// the heartbeat instead (web_client.rs ConfigServerEndpoint::parse).
const URL = `tcp://127.0.0.1:${PORTS.tcp}/${TOKEN}`;

let harness: TestServer | undefined;
let core: CoreHandle | undefined;

beforeAll(() => {
  prepareDockerConformanceEnvironment();
});

afterAll(async () => {
  stopAllCores();
  await harness?.stop();
});

describe("M0 conformance: tcp:// config-server", () => {
  it("accepts a real easytier-core over TCP framing and drives instances", async () => {
    harness = await startTestServer({ tcpPort: PORTS.tcp, allowedTokens: [TOKEN] });
    core = startCore("core-tcp", URL);

    const client = await harness.server.waitForClient({ timeoutMs: 40_000 });
    expect(client.transportKind).toBe("tcp");
    expect(client.secure).toBe(true);
    expect(client.latestHeartbeat?.userToken).toBe(TOKEN);

    const evidence = await assertM0ClientBehaviour(client);
    expect(evidence.transport).toBe("tcp");
    expect(evidence.runInstanceId).toBe(CONFORMANCE_INSTANCE_ID);
    expect(evidence.listContainsInstance).toBe(true);
    expect(evidence.running).toBe(true);
    expect(evidence.virtualIpv4).toBe(ipv4ToU32("10.144.144.1"));
    expect(evidence.configSource).toBe(2);
    expect(evidence.heartbeatReportsInstance).toBe(true);
  }, 180_000);
});
