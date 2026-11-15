import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CONFORMANCE_INSTANCE_ID,
  PORTS,
  assertM0ClientBehaviour,
  ipv4ToU32,
  requireDockerConformanceEnvironment,
  startCore,
  startTestServer,
  stopAllCores,
} from "./helpers/index.js";
import type { CoreHandle, TestServer } from "./helpers/index.js";

const TOKEN = "token-udp";
// As for tcp, the path is cleared for non-websocket schemes; the token is
// carried in HeartbeatRequest.user_token.
const URL = `udp://127.0.0.1:${PORTS.udp}/${TOKEN}`;

let harness: TestServer | undefined;
let core: CoreHandle | undefined;

beforeAll(() => {
  requireDockerConformanceEnvironment();
});

afterAll(async () => {
  stopAllCores();
  await harness?.stop();
});

describe("M4 conformance: udp:// config-server", () => {
  it("accepts a real easytier-core over the UDP session layer and drives instances", async () => {
    harness = await startTestServer({
      tcpPort: null,
      wsPort: null,
      udpPort: PORTS.udp,
      allowedTokens: [TOKEN],
    });
    core = startCore("core-udp", URL);

    const client = await harness.server.waitForClient({ timeoutMs: 60_000 });
    expect(client.transportKind).toBe("udp");
    expect(client.secure).toBe(true);
    expect(client.latestHeartbeat?.userToken).toBe(TOKEN);
    expect(client.latestHeartbeat?.hostname).toBe("core-udp");

    const evidence = await assertM0ClientBehaviour(client);
    expect(evidence.transport).toBe("udp");
    expect(evidence.runInstanceId).toBe(CONFORMANCE_INSTANCE_ID);
    expect(evidence.listContainsInstance).toBe(true);
    expect(evidence.running).toBe(true);
    expect(evidence.virtualIpv4).toBe(ipv4ToU32("10.144.144.1"));
    expect(evidence.configSource).toBe(2);
    expect(evidence.heartbeatReportsInstance).toBe(true);
  }, 240_000);
});
