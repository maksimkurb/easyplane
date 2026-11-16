import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PORTS,
  prepareDockerConformanceEnvironment,
  safeStringify,
  startCore,
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

interface DeviceDto {
  id: string;
  state: string;
  appliedRevision: number | null;
  lastPushError: string | null;
}

async function poll<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await fn();
    if (predicate(last)) return last;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label}: condition not met within ${timeoutMs}ms; last=${safeStringify(last)}`,
  );
}

/**
 * M4 conformance: adopt the config a real easytier-core is *actually running*
 * via GetNetworkInstanceConfig, preview it through the API and commit it as a
 * new network with the source secret preserved.
 */
describe("M4 conformance: adopt a running config from a real client", () => {
  let test: TestApp;
  let admin: LoginResult;
  let core: CoreHandle;
  let deviceId = "";
  let sourceNetworkId = "";
  let sourceSecret = "";

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return authed(admin, { "x-csrf-token": admin.csrfToken, ...extra });
  }

  beforeAll(async () => {
    prepareDockerConformanceEnvironment();
    test = await createTestApp({
      oidc: false,
      env: {
        EASYPLANE_WS_PORT: String(PORTS.m4),
        EASYPLANE_TCP_PORT: "0",
        EASYPLANE_UDP_PORT: "",
        EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: "4000",
        EASYPLANE_RECONCILE_INTERVAL_MS: "1000",
        EASYPLANE_UNKNOWN_TOKEN_LIMIT_PER_MINUTE: "30",
      },
    });
    await test.context.controlPlane.start();
    test.context.push.start(1000);
    admin = await bootstrapAdmin(test);
  });

  afterAll(async () => {
    stopAllCores();
    await test?.context.push.stop();
    await test?.context.controlPlane.stop();
    await test?.stop();
  });

  it("reads the running instance, previews it without the secret and commits it", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Adoption source", ipv4Cidr: "10.88.0.0/24" },
    });
    expect(created.statusCode).toBe(201);
    const network = created.json() as { id: string; networkName: string };
    sourceNetworkId = network.id;

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${sourceNetworkId}/invites`,
      headers: headers(),
      payload: { label: "adopt", maxUses: 5 },
    });
    expect(invite.statusCode).toBe(201);
    const token = (invite.json() as { token: string }).token;
    sourceSecret = (
      (
        await test.app.inject({
          method: "POST",
          url: `/api/networks/${sourceNetworkId}/secret/reveal`,
          headers: headers(),
        })
      ).json() as { secret: string }
    ).secret;

    core = startCore("core-m4", `ws://127.0.0.1:${PORTS.m4}/${token}`);

    const device = await poll<DeviceDto>(
      "device enrolment",
      async () => {
        const response = await test.app.inject({
          method: "GET",
          url: "/api/devices",
          headers: authed(admin),
        });
        return (response.json() as DeviceDto[])[0] as DeviceDto;
      },
      (value) => value !== undefined,
    );
    deviceId = device.id;

    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${deviceId}/approve`,
      headers: headers(),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);

    await poll(
      "config push",
      async () => {
        const response = await test.app.inject({
          method: "GET",
          url: `/api/devices/${deviceId}`,
          headers: authed(admin),
        });
        return response.json() as DeviceDto;
      },
      (value) => value.appliedRevision !== null && value.lastPushError === null,
    );

    // The client now runs the EasyPlane-managed instance. Adoption must read it
    // through the real GetNetworkInstanceConfig RPC.
    const instances = await test.app.inject({
      method: "GET",
      url: `/api/devices/${deviceId}/import/instances`,
      headers: authed(admin),
    });
    expect(instances.statusCode).toBe(200);
    const instanceList = instances.json() as Array<{
      instanceId: string;
      managed: boolean;
    }>;
    expect(instanceList.length).toBeGreaterThanOrEqual(1);

    const preview = await test.app.inject({
      method: "POST",
      url: "/api/networks/import/preview",
      headers: headers(),
      payload: {
        source: {
          type: "device",
          deviceId,
          instanceId: instanceList[0]!.instanceId,
        },
      },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as {
      draftId: string;
      network: { name: string; networkName: string; ipv4Cidr: string };
      secret: { present: boolean };
      summary: { magicDns: boolean; peerUrls: string[] };
      warnings: string[];
      unsupported: string[];
    };
    expect(body.network.networkName).toBe(network.networkName);
    expect(body.network.ipv4Cidr).toBe("10.88.0.0/24");
    expect(body.secret.present).toBe(true);
    // Neither the secret nor any device config body may be echoed to the
    // browser.
    expect(preview.body).not.toContain(sourceSecret);
    expect(body.warnings.join(" ")).toContain("adopted from a running instance");

    // Migration shape: the old control plane's network is deleted (its
    // network_name is unique per deployment) while the parsed draft keeps the
    // secret, then the draft is committed as the replacement network.
    const deleted = await test.app.inject({
      method: "DELETE",
      url: `/api/networks/${sourceNetworkId}`,
      headers: headers(),
    });
    expect(deleted.statusCode).toBe(200);

    const commit = await test.app.inject({
      method: "POST",
      url: `/api/networks/import/${body.draftId}/commit`,
      headers: headers(),
      payload: { name: "Adopted from core-m4" },
    });
    expect(commit.statusCode).toBe(201);
    const imported = commit.json() as { id: string; networkName: string };
    expect(imported.networkName).toBe(network.networkName);

    const revealed = await test.app.inject({
      method: "POST",
      url: `/api/networks/${imported.id}/secret/reveal`,
      headers: headers(),
    });
    expect(revealed.statusCode).toBe(200);
    expect((revealed.json() as { secret: string }).secret).toBe(sourceSecret);
  }, 240_000);
});
