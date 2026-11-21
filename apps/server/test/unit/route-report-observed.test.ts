import { describe, expect, it } from "vitest";

import {
  approvedNetworkSubnetCidrs,
  buildRouteReport,
  mergePeerObservations,
  type RouteRecord,
} from "@easyplane/server";

const H1 = "11111111-1111-4111-8111-111111111111";
const H3 = "33333333-3333-4333-8333-333333333333";

function route(overrides: Partial<RouteRecord>): RouteRecord {
  return {
    deviceId: H1,
    kind: "subnet",
    cidr: "192.168.50.0/24",
    state: "approved",
    source: "panel",
    ...overrides,
  };
}

/**
 * Production symptom: two hub routers, each with its own approved subnets.
 * EasyTier peers report the routes of the whole network, so h1 sees h3's
 * subnet and vice versa. Those are approved routes of *another* device, not
 * unapproved drift on the observing one.
 */
const TWO_ROUTERS: RouteRecord[] = [
  route({ deviceId: H1, cidr: "192.168.40.0/23" }),
  route({ deviceId: H1, cidr: "192.168.42.0/24" }),
  route({ deviceId: H3, cidr: "192.168.55.0/24" }),
];

describe("unapprovedObservedCidrs across the network", () => {
  it("does not flag another router's approved subnets", () => {
    const h1 = buildRouteReport({
      approvals: TWO_ROUTERS,
      deviceId: H1,
      instances: [],
      peerObservations: [
        {
          ipv4: "10.144.144.3",
          hostname: "owrt-h3",
          deviceId: H3,
          proxyCidrs: ["192.168.55.0/24"],
        },
      ],
    });
    expect(h1.observedCidrs).toEqual(["192.168.55.0/24"]);
    expect(h1.unapprovedObservedCidrs).toEqual([]);

    const h3 = buildRouteReport({
      approvals: TWO_ROUTERS,
      deviceId: H3,
      instances: [],
      peerObservations: [
        {
          ipv4: "10.144.144.2",
          hostname: "owrt-h1",
          deviceId: H1,
          proxyCidrs: ["192.168.40.0/23", "192.168.42.0/24"],
        },
      ],
    });
    expect(h3.observedCidrs).toEqual(["192.168.40.0/23", "192.168.42.0/24"]);
    expect(h3.unapprovedObservedCidrs).toEqual([]);
  });

  it("keeps the same view when peer observations are merged in later", () => {
    const h1 = buildRouteReport({
      approvals: TWO_ROUTERS,
      deviceId: H1,
      instances: [],
      peerObservations: [],
    });
    const merged = mergePeerObservations(
      h1,
      [
        {
          ipv4: "10.144.144.3",
          hostname: "owrt-h3",
          // A peer route entry may carry the whole network's proxy CIDRs.
          proxyCidrs: ["192.168.55.0/24", "192.168.40.0/23"],
          observerDeviceId: H3,
          observerHostname: "owrt-h3",
          at: new Date(0).toISOString(),
        },
      ],
      TWO_ROUTERS,
      H1,
    );
    expect(merged.unapprovedObservedCidrs).toEqual([]);
  });

  it("still flags unknown, pending and rejected peer routes", () => {
    const approvals: RouteRecord[] = [
      route({ deviceId: H1, cidr: "192.168.40.0/24" }),
      route({ deviceId: H3, cidr: "192.168.56.0/24", state: "pending" }),
      route({
        deviceId: H3,
        cidr: "192.168.57.0/24",
        state: "pending",
        source: "device_declared",
      }),
      route({
        deviceId: H3,
        cidr: "192.168.58.0/24",
        state: "rejected",
        source: "device_declared",
      }),
    ];
    const report = buildRouteReport({
      approvals,
      deviceId: H1,
      instances: [],
      peerObservations: [
        {
          ipv4: "10.144.144.3",
          hostname: "owrt-h3",
          proxyCidrs: [
            "192.168.40.0/24", // h1's approved route, echoed back
            "192.168.56.0/24",
            "192.168.57.0/24",
            "192.168.58.0/24",
            "203.0.113.0/24",
          ],
        },
      ],
    });
    expect(report.unapprovedObservedCidrs).toEqual([
      "192.168.56.0/24",
      "192.168.57.0/24",
      "192.168.58.0/24",
      "203.0.113.0/24",
    ]);

    const merged = mergePeerObservations(
      buildRouteReport({
        approvals,
        deviceId: H1,
        instances: [],
        peerObservations: [],
      }),
      [
        {
          ipv4: "10.144.144.3",
          hostname: "owrt-h3",
          proxyCidrs: ["192.168.56.0/24", "192.168.57.0/24", "192.168.58.0/24"],
          observerDeviceId: H3,
          observerHostname: "owrt-h3",
          at: new Date(0).toISOString(),
        },
      ],
      approvals,
      H1,
    );
    expect(merged.unapprovedObservedCidrs).toEqual([
      "192.168.56.0/24",
      "192.168.57.0/24",
      "192.168.58.0/24",
    ]);
  });

  it("normalises observed CIDRs before comparing them", () => {
    const approvals = [route({ deviceId: H1, cidr: "192.168.40.0/23" })];
    const report = buildRouteReport({
      approvals,
      deviceId: H3,
      instances: [],
      peerObservations: [
        {
          ipv4: "10.144.144.2",
          hostname: "owrt-h1",
          proxyCidrs: ["192.168.40.1/23"],
        },
      ],
    });
    expect(report.observedCidrs).toEqual(["192.168.40.0/23"]);
    expect(report.unapprovedObservedCidrs).toEqual([]);
  });

  it("keeps own-config drift scoped to the device", () => {
    // h1 must not route h3's approved subnet itself; only `observed` is
    // network-scoped, `unapprovedCidrs` stays per device.
    const report = buildRouteReport({
      approvals: TWO_ROUTERS,
      deviceId: H1,
      instances: [
        {
          instanceId: "managed",
          networkName: "net",
          hostname: "owrt-h1",
          proxyCidrs: ["192.168.40.0/23", "192.168.55.0/24"],
          exitNode: false,
          unmanaged: false,
          removable: true,
        },
      ],
      peerObservations: [],
    });
    expect(report.unapprovedCidrs).toEqual(["192.168.55.0/24"]);
    expect(report.unapprovedObservedCidrs).toEqual([]);
  });

  it("collects approved subnets of the whole network", () => {
    expect(
      approvedNetworkSubnetCidrs([
        ...TWO_ROUTERS,
        route({ deviceId: H3, cidr: "192.168.60.0/24", state: "pending" }),
        route({
          deviceId: H3,
          cidr: "192.168.61.0/24",
          state: "approved",
          kind: "exit_node",
        }),
      ]),
    ).toEqual(["192.168.40.0/23", "192.168.42.0/24", "192.168.55.0/24"]);
  });
});
