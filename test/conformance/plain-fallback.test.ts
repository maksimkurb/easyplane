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

const TOKEN = "token-plain";
const URL = `ws://127.0.0.1:${PORTS.plain}/${TOKEN}`;

let harness: TestServer | undefined;
let core: CoreHandle | undefined;

beforeAll(() => {
  prepareDockerConformanceEnvironment();
});

afterAll(async () => {
  stopAllCores();
  await harness?.stop();
});

describe("M0 conformance: legacy plain tunnel (support_encryption=false)", () => {
  it("keeps the unencrypted framing/RPC path working", async () => {
    // Debug/legacy knob: advertise no web-secure support, so a client without
    // --secure-mode stays on the plain tunnel (matching older servers).
    harness = await startTestServer({
      wsPort: PORTS.plain,
      allowedTokens: [TOKEN],
      supportEncryption: false,
    });
    core = startCore("core-plain", URL);

    const client = await harness.server.waitForClient({ timeoutMs: 40_000 });
    expect(client.transportKind).toBe("ws");
    expect(client.secure).toBe(false);

    const evidence = await assertM0ClientBehaviour(client);
    expect(evidence.secure).toBe(false);
    expect(evidence.running).toBe(true);
    expect(evidence.configSource).toBe(2);
  }, 180_000);
});
