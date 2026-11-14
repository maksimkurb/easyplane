import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PORTS,
  requireDockerConformanceEnvironment,
  startCore,
  startTestServer,
  stopAllCores,
} from "./helpers/index.js";
import type { CoreHandle, TestServer } from "./helpers/index.js";

// The container is configured with "wrong-token".
const URL = `ws://127.0.0.1:${PORTS.badToken}/wrong-token`;

let harness: TestServer | undefined;
let core: CoreHandle | undefined;

beforeAll(() => {
  requireDockerConformanceEnvironment();
});

afterAll(async () => {
  stopAllCores();
  await harness?.stop();
});

describe("M0 conformance: token rejection", () => {
  it("answers an unknown token with an RPC error so the client retries, and records no device", async () => {
    harness = await startTestServer({
      wsPort: PORTS.badToken,
      allowedTokens: ["expected-token"],
    });
    core = startCore("core-bad-token", URL);

    // The client connects (and may do the secure upgrade) but every heartbeat
    // is rejected, so it never becomes a usable session.
    const connected = await harness.server.waitForClient({
      timeoutMs: 40_000,
      requireHeartbeat: false,
    });
    expect(connected.heartbeatCount).toBe(0);

    // The heartbeat error makes the client drop and reconnect; the server must
    // not accumulate accepted devices.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const accepted = harness.server
      .listClients()
      .filter((candidate) => candidate.heartbeatCount > 0);
    expect(accepted).toHaveLength(0);
  }, 120_000);
});
