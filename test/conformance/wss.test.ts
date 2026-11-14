import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PORTS,
  assertM0ClientBehaviour,
  generateSelfSignedCert,
  removeCert,
  requireDockerConformanceEnvironment,
  startCore,
  startTestServer,
  stopAllCores,
} from "./helpers/index.js";
import type { CoreHandle, TestServer } from "./helpers/index.js";

const TOKEN = "token-wss";
const URL = `wss://127.0.0.1:${PORTS.wss}/${TOKEN}`;

let harness: TestServer | undefined;
let core: CoreHandle | undefined;
let certDir: string | undefined;

beforeAll(() => {
  requireDockerConformanceEnvironment();
});

afterAll(async () => {
  stopAllCores();
  await harness?.stop();
  if (certDir) removeCert(certDir);
});

describe("M0 conformance: wss:// config-server", () => {
  it("terminates TLS and then the same tunnel/RPC stack", async () => {
    const cert = generateSelfSignedCert();
    certDir = cert.dir;
    harness = await startTestServer({
      wss: { port: PORTS.wss, certFile: cert.certFile, keyFile: cert.keyFile },
      allowedTokens: [TOKEN],
    });
    core = startCore("core-wss", URL);

    const client = await harness.server.waitForClient({ timeoutMs: 40_000 });
    expect(client.transportKind).toBe("wss");
    expect(client.secure).toBe(true);

    const evidence = await assertM0ClientBehaviour(client);
    expect(evidence.transport).toBe("wss");
    expect(evidence.running).toBe(true);
    expect(evidence.configNetworkName).toBe("easyplane-conformance");
  }, 180_000);
});
