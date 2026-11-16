import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PORTS,
  assertM0ClientBehaviour,
  prepareDockerConformanceEnvironment,
  startCore,
  startTestServer,
  stopAllCores,
} from "./helpers/index.js";
import type { CoreHandle, TestServer } from "./helpers/index.js";

const TOKEN = "token-secure";
const URL = `ws://127.0.0.1:${PORTS.secure}/${TOKEN}`;

let harness: TestServer | undefined;
let core: CoreHandle | undefined;

beforeAll(() => {
  prepareDockerConformanceEnvironment();
});

afterAll(async () => {
  stopAllCores();
  await harness?.stop();
});

describe("M0 conformance: --secure-mode client", () => {
  it("completes the Noise handshake and refuses nothing less", async () => {
    harness = await startTestServer({ wsPort: PORTS.secure, allowedTokens: [TOKEN] });
    // --secure-mode makes the client require config-server encryption; it
    // reconnects (and never sends heartbeats) if the server does not support it.
    core = startCore("core-ws-secure", URL);

    const client = await harness.server.waitForClient({ timeoutMs: 40_000 });
    expect(client.transportKind).toBe("ws");
    expect(client.secure).toBe(true);
    expect(client.latestHeartbeat?.hostname).toBe("core-ws-secure");

    const evidence = await assertM0ClientBehaviour(client);
    expect(evidence.secure).toBe(true);
    expect(evidence.running).toBe(true);
    expect(evidence.listContainsInstance).toBe(true);
  }, 180_000);
});
