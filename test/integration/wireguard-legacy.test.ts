import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ManagedClient } from "@easyplane/server";
import { instance, manage } from "@easyplane/proto";

import {
  authed,
  createTestApp,
  loginWithMockIdp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

const LEGACY_MACHINE = "eeeeeeee-1111-4111-8111-111111111111";
const MODERN_MACHINE = "eeeeeeee-2222-4222-8222-222222222222";
const NEVER_ECHO_MACHINE = "eeeeeeee-3333-4333-8333-333333333333";

interface FakeRun {
  instId: string;
  config: manage.NetworkConfig;
}

/**
 * Config-server fake. `echoPortal` decides whether the reported
 * `GetNetworkInstanceConfig` matches what was pushed — the pinned real client
 * does echo it, a 2.6.4 client cannot (the field does not exist there) and a
 * broken/normalising client silently drops it, which is exactly the prod drift.
 */
function fakeClient(
  name: string,
  options: { echoPortal?: boolean; reportConfig?: boolean; rejectPortal?: boolean } = {},
) {
  const state = {
    closed: false,
    runs: [] as FakeRun[],
    portal: undefined as instance.VpnPortalInfo | undefined,
    echoPortal: options.echoPortal ?? true,
    reportConfig: options.reportConfig ?? true,
    rejectPortal: options.rejectPortal ?? false,
  };
  const remote = {
    runNetworkInstance: async (request: { instId: string; config: manage.NetworkConfig }) => {
      state.runs.push({ instId: request.instId, config: request.config });
      return { instId: request.instId };
    },
    collectNetworkInfo: async (instIds: string[]) => {
      const map: Record<string, manage.NetworkInstanceRunningInfo> = {};
      for (const instanceId of instIds) {
        const current = state.runs.at(-1)?.config;
        const rejected =
          state.rejectPortal && current?.vpnPortalConfig !== undefined;
        map[instanceId] = {
          running: !rejected,
          ...(rejected
            ? {
                errorMsg:
                  "failed to create instance: VPN portal client keen-h2 has an unusable virtual IP 10.144.144.8",
              }
            : {}),
        } as manage.NetworkInstanceRunningInfo;
      }
      return { info: { map } };
    },
    listNetworkInstance: async () =>
      state.reportConfig ? state.runs.map((run) => run.instId) : [],
    getNetworkInstanceConfig: async () => {
      const last = state.runs.at(-1);
      if (!last) {
        return { config: undefined, source: manage.ConfigSource.ConfigSourceWeb };
      }
      const pushed = last.config;
      const config: manage.NetworkConfig = {
        ...pushed,
        // The pinned client normalises this; mimic it so the comparison path
        // is realistic.
        networkingMethod: manage.NetworkingMethod.Manual,
        ...(state.echoPortal ? {} : { vpnPortalConfig: undefined }),
      };
      return { config, source: manage.ConfigSource.ConfigSourceWeb };
    },
    listNetworkInstanceMeta: async () => ({ metas: [] }),
    deleteNetworkInstance: async () => ({ remainInstIds: [] }),
    getVpnPortalInfo: async () => ({ vpnPortalInfo: state.portal }),
  };
  const client = {
    id: `${name}-session`,
    get isClosed() {
      return state.closed;
    },
    remote,
    close: () => {
      state.closed = true;
    },
    heartbeatCount: 1,
    transportKind: "ws",
    secure: true,
    remoteAddress: "127.0.0.1",
    latestHeartbeat: undefined,
  } as unknown as ManagedClient;
  return {
    client,
    get lastRun() {
      return state.runs.at(-1);
    },
    get pushCount() {
      return state.runs.length;
    },
    get runs() {
      return state.runs;
    },
    setPortal(info: instance.VpnPortalInfo | undefined) {
      state.portal = info;
    },
  };
}

async function waitFor<T>(
  fn: () => Promise<T | undefined> | T | undefined,
  predicate: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (last !== undefined && predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition not met; last value: ${JSON.stringify(last)}`);
}

async function waitQuiet(count: () => number, stableMs = 400): Promise<void> {
  let last = count();
  let since = Date.now();
  while (Date.now() - since < stableMs) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const now = count();
    if (now !== last) {
      last = now;
      since = Date.now();
    }
  }
}

interface DeviceDto {
  id: string;
  isHub: boolean;
  wgListenPort: number | null;
  wgPortalMode: "per-client" | "legacy" | "unknown";
  wgPortalState: "disabled" | "starting" | "running" | "unsupported" | "error";
  wgPortalError: string | null;
  wgLegacyClientCidr: string | null;
  sync: string;
  driftReason: string | null;
  driftAttempts: number;
  driftRetryAt: string | null;
  lastPushError: string | null;
}

describe("WireGuard portal generations", () => {
  let test: TestApp;
  let admin: LoginResult;
  let member: LoginResult;
  let legacyNetworkId = "";
  let legacyHubId = "";
  let modernHubId = "";
  const legacyHub = fakeClient("legacy-hub", { echoPortal: false });
  const modernHub = fakeClient("modern-hub", { echoPortal: true });
  const neverEchoHub = fakeClient("never-echo-hub", { echoPortal: false });

  function adminHeaders(extra: Record<string, string> = {}) {
    return authed(admin, { "x-csrf-token": admin.csrfToken, ...extra });
  }

  async function enrol(input: {
    networkId: string;
    token: string;
    machineId: string;
    hostname: string;
    version: string;
    client: ManagedClient;
  }): Promise<string> {
    await test.context.devices.handleHeartbeat({
      token: input.token,
      machineId: input.machineId,
      hostname: input.hostname,
      easytierVersion: input.version,
      osType: "linux",
      osVersion: "6.8",
      osDistribution: "openwrt",
      sourceIp: "127.0.0.1",
      client: input.client,
    });
    const list = await test.app.inject({
      method: "GET",
      url: "/api/devices",
      headers: authed(admin),
    });
    const device = (list.json() as Array<{ id: string; machineId: string }>).find(
      (entry) => entry.machineId === input.machineId,
    );
    if (!device) throw new Error(`${input.hostname} was not enrolled`);
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/approve`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    return device.id;
  }

  async function getDevice(id: string): Promise<DeviceDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${id}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto;
  }

  async function createNetwork(name: string, ipv4Cidr: string) {
    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: adminHeaders(),
      payload: { name, ipv4Cidr },
    });
    expect(network.statusCode).toBe(201);
    const id = (network.json() as { id: string }).id;
    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${id}/invites`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(invite.statusCode).toBe(201);
    return { id, token: (invite.json() as { token: string }).token };
  }

  beforeAll(async () => {
    test = await createTestApp();
    admin = await loginWithMockIdp(test, "admin");
    member = await loginWithMockIdp(test, "member");

    const legacy = await createNetwork("WG legacy", "10.144.147.0/24");
    legacyNetworkId = legacy.id;
    legacyHubId = await enrol({
      networkId: legacy.id,
      token: legacy.token,
      machineId: LEGACY_MACHINE,
      hostname: "wg-legacy-hub",
      // The exact version from prod h-1 (OpenWrt, stable 2.6.4).
      version: "2.6.4-8428a89d",
      client: legacyHub.client,
    });

    const modern = await createNetwork("WG modern", "10.144.148.0/24");
    modernHubId = await enrol({
      networkId: modern.id,
      token: modern.token,
      machineId: MODERN_MACHINE,
      hostname: "wg-modern-hub",
      version: "2.7.1-abc1234",
      client: modernHub.client,
    });

    for (const id of [legacyHubId, modernHubId]) {
      const hubUpdate = await test.app.inject({
        method: "PUT",
        url: `/api/devices/${id}/hub`,
        headers: adminHeaders(),
        payload: { isHub: true },
      });
      expect(hubUpdate.statusCode).toBe(200);
    }
  });

  afterAll(async () => {
    await test.stop();
  });

  it("detects the legacy generation from the reported version", async () => {
    const device = await getDevice(legacyHubId);
    expect(device.wgPortalMode).toBe("legacy");
    // Enabled later; before that the state is simply disabled.
    expect(device.wgPortalState).toBe("disabled");
    expect((await getDevice(modernHubId)).wgPortalMode).toBe("per-client");
  });

  it("refuses per-client management with a precise error on a 2.6.4 hub", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/networks/${legacyNetworkId}/wireguard-clients`,
      headers: adminHeaders(),
      payload: { name: "phone" },
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe(
      "wireguard_portal_needs_newer_easytier",
    );
    expect((response.json() as { error: string }).error).toContain("2.7.0");
  });

  it("stores the legacy portal pool and never pushes a per-client portal", async () => {
    const overlap = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${legacyHubId}/wireguard-portal`,
      headers: adminHeaders(),
      payload: { enabled: true, port: 11013, clientCidr: "10.144.147.0/24" },
    });
    expect(overlap.statusCode).toBe(400);

    const enabled = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${legacyHubId}/wireguard-portal`,
      headers: adminHeaders(),
      payload: { enabled: true, port: 11013, clientCidr: "10.14.49.0/24" },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({
      enabled: true,
      port: 11013,
      mode: "legacy",
      legacyClientCidr: "10.14.49.0/24",
    });
    const device = await getDevice(legacyHubId);
    expect(device.wgLegacyClientCidr).toBe("10.14.49.0/24");

    // Nothing about the portal may reach a 2.6.4 device: the field does not
    // exist in its NetworkConfig and would drift forever (prod h-1).
    await test.context.push.ensure(legacyHubId);
    const pushed = await waitFor(() => legacyHub.lastRun, () => true);
    expect(pushed.config.vpnPortalConfig).toBeUndefined();
    const pushCount = legacyHub.pushCount;
    for (let i = 0; i < 4; i += 1) await test.context.push.ensure(legacyHubId);
    expect(legacyHub.pushCount).toBe(pushCount);
    const after = await getDevice(legacyHubId);
    expect(after.driftReason).toBeNull();
    expect(after.driftAttempts).toBe(0);
    expect(after.lastPushError).toBeNull();
    expect(after.sync).toBe("in-sync");
  });

  it("reports a not-started legacy portal and serves the shared config once it starts", async () => {
    legacyHub.setPortal({
      vpnType: "wireguard",
      clientConfig: "ERROR: Wireguard VPN Portal Not Started",
      connectedClients: [],
      clients: [],
      listener: undefined,
    });
    await test.context.wireguard.collectStatuses(
      await test.context.devices.requireDevice(test.context.organisation.id, legacyHubId),
      legacyHub.client,
    );
    const notRunning = await waitFor(
      () => getDevice(legacyHubId),
      (device) => device.wgPortalState === "error",
    );
    expect(notRunning.wgPortalError).toContain("Not Started");

    const refused = await test.app.inject({
      method: "GET",
      url: `/api/devices/${legacyHubId}/wireguard-portal/config`,
      headers: authed(admin),
    });
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { code: string }).code).toBe(
      "wireguard_portal_not_running",
    );
    // The hint tells the operator exactly what to run on the device.
    expect((refused.json() as { error: string }).error).toContain(
      "--vpn-portal wg://0.0.0.0:11013/10.14.49.0/24",
    );

    const config = "[Interface]\nPrivateKey = topsecret\nAddress = 10.14.49.2/24\n";
    legacyHub.setPortal({
      vpnType: "wireguard",
      clientConfig: config,
      connectedClients: ["10.14.49.2"],
      clients: [],
      listener: undefined,
    });
    await test.context.wireguard.collectStatuses(
      await test.context.devices.requireDevice(test.context.organisation.id, legacyHubId),
      legacyHub.client,
    );
    await waitFor(
      () => getDevice(legacyHubId),
      (device) => device.wgPortalState === "running",
    );

    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${legacyHubId}/wireguard-portal/config`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      config,
      mode: "legacy",
      clientCidr: "10.14.49.0/24",
      connectedClients: ["10.14.49.2"],
    });

    const download = await test.app.inject({
      method: "GET",
      url: `/api/devices/${legacyHubId}/wireguard-portal/config/download`,
      headers: authed(admin),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("text/plain");
    expect(download.body).toContain("[Interface]");

    const forbidden = await test.app.inject({
      method: "GET",
      url: `/api/devices/${legacyHubId}/wireguard-portal/config`,
      headers: authed(member),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("surfaces a build compiled without the wireguard feature as unsupported", async () => {
    legacyHub.setPortal({
      vpnType: "null",
      clientConfig: "",
      connectedClients: [],
      clients: [],
      listener: undefined,
    });
    await test.context.wireguard.collectStatuses(
      await test.context.devices.requireDevice(test.context.organisation.id, legacyHubId),
      legacyHub.client,
    );
    const device = await waitFor(
      () => getDevice(legacyHubId),
      (entry) => entry.wgPortalState === "unsupported",
    );
    expect(device.wgPortalError).toMatch(/wireguard/i);

    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${legacyHubId}/wireguard-portal/config`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe(
      "wireguard_portal_unsupported",
    );
  });

  it("backs off instead of repushing a per-client hub that never echoes the portal", async () => {
    const network = await createNetwork("WG drift", "10.144.149.0/24");
    const hubId = await enrol({
      networkId: network.id,
      token: network.token,
      machineId: NEVER_ECHO_MACHINE,
      hostname: "wg-drift-hub",
      version: "2.7.0-nightly",
      client: neverEchoHub.client,
    });
    await test.app.inject({
      method: "PUT",
      url: `/api/devices/${hubId}/hub`,
      headers: adminHeaders(),
      payload: { isHub: true },
    });

    const enabled = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${hubId}/wireguard-portal`,
      headers: adminHeaders(),
      payload: { enabled: true, port: 11013 },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({ mode: "per-client" });

    const created = await test.app.inject({
      method: "POST",
      url: `/api/networks/${network.id}/wireguard-clients`,
      headers: adminHeaders(),
      payload: { name: "phone" },
    });
    expect(created.statusCode).toBe(201);

    // First ensure: no applied revision yet → push. Second: the client reports
    // the config without the portal → drift attempt 1 + one more push.
    await test.context.push.ensure(hubId);
    const first = await waitFor(
      () => neverEchoHub.lastRun,
      (run) => (run.config.vpnPortalConfig?.clients.length ?? 0) === 1,
    );
    expect(first.config.vpnPortalConfig?.clients[0]?.name).toBe("phone");
    await test.context.push.ensure(hubId);
    await waitFor(
      () => getDevice(hubId),
      (device) => device.driftAttempts > 0,
    );
    const drifting = await getDevice(hubId);
    expect(drifting.driftReason).toContain("vpnPortalConfig");
    expect(drifting.driftRetryAt).not.toBeNull();
    // The instance runs, but the config does not match: not "in-sync".
    expect(drifting.sync).toBe("stale");
    expect(drifting.lastPushError).toBeNull();

    // Inside the backoff window further reconcile passes must not push.
    const pushCount = neverEchoHub.pushCount;
    for (let i = 0; i < 5; i += 1) await test.context.push.ensure(hubId);
    expect(neverEchoHub.pushCount).toBe(pushCount);
    expect((await getDevice(hubId)).driftAttempts).toBe(drifting.driftAttempts);

    // The manual retry endpoint ("Повторить сейчас") ignores the backoff.
    const retry = await test.app.inject({
      method: "POST",
      url: `/api/devices/${hubId}/push`,
      headers: adminHeaders(),
    });
    expect(retry.statusCode).toBe(200);
    expect(neverEchoHub.pushCount).toBeGreaterThan(pushCount);

    // Once a probe proves the build has no WireGuard support, the portal field
    // is dropped from the desired config instead of drifting forever.
    neverEchoHub.setPortal({
      vpnType: "null",
      clientConfig: "",
      connectedClients: [],
      clients: [],
      listener: undefined,
    });
    await test.context.wireguard.collectStatuses(
      await test.context.devices.requireDevice(test.context.organisation.id, hubId),
      neverEchoHub.client,
    );
    await waitFor(
      () => getDevice(hubId),
      (device) => device.wgPortalState === "unsupported",
    );
    const beforeConverge = neverEchoHub.pushCount;
    await test.context.push.ensure(hubId);
    expect(neverEchoHub.pushCount).toBe(beforeConverge);
    const converged = await getDevice(hubId);
    expect(converged.driftReason).toBeNull();
    expect(converged.driftAttempts).toBe(0);
  });

  it("keeps the hub online when the device rejects the portal config, then backs off", async () => {
    const rejecting = fakeClient("rejecting-hub", {
      echoPortal: true,
      rejectPortal: true,
    });
    const network = await createNetwork("WG reject", "10.144.150.0/24");
    const hubId = await enrol({
      networkId: network.id,
      token: network.token,
      machineId: "eeeeeeee-4444-4444-8444-444444444444",
      hostname: "keen-h2",
      version: "2.7.1-0d9c52b",
      client: rejecting.client,
    });
    await test.app.inject({
      method: "PUT",
      url: `/api/devices/${hubId}/hub`,
      headers: adminHeaders(),
      payload: { isHub: true },
    });
    expect(
      (
        await test.app.inject({
          method: "PUT",
          url: `/api/devices/${hubId}/wireguard-portal`,
          headers: adminHeaders(),
          payload: { enabled: true, port: 11013 },
        })
      ).statusCode,
    ).toBe(200);
    const created = await test.app.inject({
      method: "POST",
      url: `/api/networks/${network.id}/wireguard-clients`,
      headers: adminHeaders(),
      payload: { name: "keen-h2-client" },
    });
    expect(created.statusCode).toBe(201);

    // The first push is rejected and would leave the instance down; the panel
    // retries once without the portal so the network keeps running.
    await test.context.push.ensure(hubId);
    await waitFor(
      () => getDevice(hubId),
      (device) => device.wgPortalState === "error",
    );
    const after = await getDevice(hubId);
    expect(rejecting.pushCount).toBeGreaterThanOrEqual(2);
    expect(rejecting.lastRun?.config.vpnPortalConfig).toBeUndefined();
    // The device's own message is surfaced verbatim, not a generic one.
    expect(after.wgPortalError).toContain("unusable virtual IP");
    expect(after.wgPortalError).toContain("keen-h2");
    // The instance is running again, so this is not a push error.
    expect(after.lastPushError).toBeNull();
    expect(after.sync).not.toBe("error");

    // The rejected portal config is not retried on every reconcile tick: the
    // fallback config runs, so further passes must not add another
    // portal-bearing push. Wait out any pushes still queued by the API calls
    // above before taking the baseline.
    await waitQuiet(() => rejecting.pushCount);
    const portalPushes = rejecting.runs.filter(
      (run) => run.config.vpnPortalConfig !== undefined,
    ).length;
    for (let i = 0; i < 4; i += 1) await test.context.push.ensure(hubId);
    expect(
      rejecting.runs.filter((run) => run.config.vpnPortalConfig !== undefined).length,
    ).toBe(portalPushes);
    expect(rejecting.lastRun?.config.vpnPortalConfig).toBeUndefined();

    // "Retry now" re-attempts the portal (the fake still rejects it, so it
    // falls back again) — bounded, no infinite loop.
    const beforeRetry = rejecting.pushCount;
    const retry = await test.app.inject({
      method: "POST",
      url: `/api/devices/${hubId}/push`,
      headers: adminHeaders(),
    });
    expect(retry.statusCode).toBe(200);
    // A retry that lands while a queued push is in flight joins it and runs as
    // the follow-up pass a moment later, so wait for the push instead of
    // asserting the counter synchronously.
    await waitFor(
      () => rejecting.pushCount,
      (count) => count > beforeRetry,
    );
    await waitQuiet(() => rejecting.pushCount);
    expect(rejecting.lastRun?.config.vpnPortalConfig).toBeUndefined();
  });
});
