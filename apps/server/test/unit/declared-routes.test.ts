import { describe, expect, it } from "vitest";

import {
  DECLARED_ADVERTISED_WINDOW_MS,
  buildNetworkConfig,
  buildRouteReport,
  configMatchesDesired,
  declarableCidr,
  declaredExitNode,
  declaredSubnetCidrs,
  isConfigReadOnly,
  isDeclaredRouteAdvertised,
  mergePeerObservations,
  normalizeDesiredConfig,
  type RouteRecord,
} from "@easyplane/server";

const DEVICE = "22222222-2222-4222-8222-222222222222";
const OVERLAY = "10.144.144.0/24";

function route(overrides: Partial<RouteRecord> = {}): RouteRecord {
  return {
    deviceId: DEVICE,
    kind: "subnet",
    cidr: "192.168.50.0/24",
    state: "pending",
    source: "panel",
    ...overrides,
  };
}

describe("device-declared routes", () => {
  it("separates declared pending/approved rows from panel rows and rejections", () => {
    const rows: RouteRecord[] = [
      route({ cidr: "10.10.1.0/24", source: "device_declared", state: "pending" }),
      route({ cidr: "10.10.2.0/24", source: "device_declared", state: "approved" }),
      route({ cidr: "10.10.3.0/24", source: "device_declared", state: "rejected" }),
      route({ cidr: "10.10.4.0/24", source: "panel", state: "approved" }),
      route({ cidr: "10.10.5.0/24", source: "device_declared", state: "pending", deviceId: "other" }),
    ];
    expect(declaredSubnetCidrs(rows, DEVICE)).toEqual([
      "10.10.1.0/24",
      "10.10.2.0/24",
    ]);
    expect(
      declaredExitNode(
        [
          route({ kind: "exit_node", cidr: "", source: "device_declared", state: "pending" }),
        ],
        DEVICE,
      ),
    ).toBe(true);
    expect(
      declaredExitNode(
        [
          route({ kind: "exit_node", cidr: "", source: "device_declared", state: "rejected" }),
        ],
        DEVICE,
      ),
    ).toBe(false);
  });

  it("only accepts CIDRs that are safe to distribute", () => {
    expect(declarableCidr("192.168.50.0/24", OVERLAY)).toBe("192.168.50.0/24");
    expect(declarableCidr(" 192.168.50.9/24 ", OVERLAY)).toBe("192.168.50.0/24");
    // 0.0.0.0/0 is an exit node, not a subnet route.
    expect(declarableCidr("0.0.0.0/0", OVERLAY)).toBeNull();
    // Swallowing the overlay or sitting inside it would break the network.
    expect(declarableCidr("10.0.0.0/8", OVERLAY)).toBeNull();
    expect(declarableCidr("10.144.144.128/25", OVERLAY)).toBeNull();
    expect(declarableCidr("not-a-cidr", OVERLAY)).toBeNull();
  });

  it("treats a declared CIDR as expected, not as unapproved drift", () => {
    const report = buildRouteReport({
      approvals: [
        route({ cidr: "10.10.1.0/24", source: "device_declared", state: "pending" }),
        route({ cidr: "10.10.9.0/24", source: "device_declared", state: "rejected" }),
      ],
      deviceId: DEVICE,
      instances: [
        {
          instanceId: "managed",
          networkName: "net",
          hostname: "node",
          proxyCidrs: ["10.10.1.0/24", "10.10.9.0/24"],
          exitNode: true,
          unmanaged: false,
          removable: true,
        },
      ],
      peerObservations: [
        { ipv4: "10.144.144.2", hostname: "node", proxyCidrs: ["10.10.1.0/24"] },
      ],
    });
    expect(report.declaredCidrs).toEqual(["10.10.1.0/24"]);
    expect(report.configuredCidrs).toEqual(["10.10.1.0/24", "10.10.9.0/24"]);
    // The rejected declaration is genuinely unapproved; the pending one is not.
    expect(report.unapprovedCidrs).toEqual(["10.10.9.0/24"]);
    expect(report.unapprovedObservedCidrs).toEqual([]);
    expect(report.reportedExitNode).toBe(true);

    const merged = mergePeerObservations(
      report,
      [
        {
          ipv4: "10.144.144.2",
          hostname: "node",
          proxyCidrs: ["10.10.1.0/24", "10.10.9.0/24"],
          observerDeviceId: "observer",
          observerHostname: "observer",
          at: new Date().toISOString(),
        },
      ],
      [
        route({ cidr: "10.10.1.0/24", source: "device_declared", state: "pending" }),
        route({ cidr: "10.10.9.0/24", source: "device_declared", state: "rejected" }),
      ],
      DEVICE,
    );
    expect(merged.unapprovedObservedCidrs).toEqual(["10.10.9.0/24"]);
  });

  it("expires the advertised flag after the window", () => {
    const now = Date.now();
    expect(isDeclaredRouteAdvertised(new Date(now - 1_000), now)).toBe(true);
    expect(
      isDeclaredRouteAdvertised(new Date(now - DECLARED_ADVERTISED_WINDOW_MS - 1), now),
    ).toBe(false);
    expect(isDeclaredRouteAdvertised(null, now)).toBe(false);
  });

  it("always pushes an explicit manual-route list", () => {
    const build = (manualRoutes: string[]) =>
      buildNetworkConfig({
        networkId: "11111111-1111-4111-8111-111111111111",
        deviceId: DEVICE,
        instanceId: "33333333-3333-4333-8333-333333333333",
        hostname: "node",
        networkName: "net",
        networkSecret: "secret",
        assignedIpv4: "10.144.144.2",
        ipv4Cidr: OVERLAY,
        stored: normalizeDesiredConfig({}),
        manualRoutes,
      });
    const empty = build([]);
    expect(empty.enableManualRoutes).toBe(true);
    expect(empty.routes).toEqual([]);
    const approved = build(["192.168.50.0/24"]);
    expect(approved.enableManualRoutes).toBe(true);
    expect(approved.routes).toEqual(["192.168.50.0/24"]);
    // The pinned client cannot echo "manual routes, empty list" (api.rs omits
    // the flag when the list is empty), so that combination is still a match...
    expect(configMatchesDesired({ ...empty, enableManualRoutes: undefined }, empty)).toBe(true);
    // ...but a client that installs routes while we approved none is drift.
    expect(configMatchesDesired({ ...empty, routes: ["192.168.50.0/24"] }, empty)).toBe(false);
    // A non-empty list is compared through the flag.
    expect(
      configMatchesDesired({ ...approved, enableManualRoutes: false }, approved),
    ).toBe(false);
  });

  it("reads the read-only config-permission bit", () => {
    expect(isConfigReadOnly({})).toBe(false);
    expect(isConfigReadOnly({ managedConfigPermission: 0 })).toBe(false);
    expect(isConfigReadOnly({ managedConfigPermission: 1 })).toBe(true);
    expect(isConfigReadOnly({ managedConfigPermission: 3 })).toBe(true);
  });
});
