import { describe, expect, it } from "vitest";

import {
  allocateDnsLabel,
  buildRouteReport,
  cidrContains,
  isValidDnsLabel,
  magicDnsName,
  normalizeCidr,
  normalizeDnsZone,
  toDnsLabel,
  validateSubnetRequest,
  type RouteRecord,
} from "@easyplane/server";

describe("MagicDNS zone and label rules", () => {
  it("normalises zones and rejects single-label or invalid ones", () => {
    expect(normalizeDnsZone(" ET.Net ")).toBe("et.net.");
    expect(normalizeDnsZone("corp.easyplane.test.")).toBe("corp.easyplane.test.");
    expect(() => normalizeDnsZone("localhost")).toThrow(/two labels/);
    expect(() => normalizeDnsZone("bad..zone")).toThrow(/invalid DNS zone label/);
  });

  it("turns client hostnames into valid DNS labels", () => {
    expect(toDnsLabel("Core WS #1")).toBe("core-ws-1");
    expect(toDnsLabel("___")).toBe("");
    expect(toDnsLabel("A".repeat(80)).length).toBeLessThanOrEqual(63);
    expect(isValidDnsLabel("core-ws-1")).toBe(true);
    expect(isValidDnsLabel("-bad")).toBe(false);
  });

  it("allocates unique names per network", () => {
    expect(allocateDnsLabel("core", ["web"])).toBe("core");
    expect(allocateDnsLabel("core", ["core"])).toBe("core-2");
    expect(allocateDnsLabel("core", ["core", "core-2", "core-3"])).toBe("core-4");
    // Case-insensitive, because DNS is.
    expect(allocateDnsLabel("Core", ["core"])).toBe("core-2");
    expect(allocateDnsLabel("", [])).toBe("device");
  });

  it("builds the fqdn used in the UI", () => {
    expect(magicDnsName("db1", "et.net")).toEqual({
      hostname: "db1",
      zone: "et.net.",
      fqdn: "db1.et.net.",
    });
  });
});

describe("route state", () => {
  const routes: RouteRecord[] = [
    { deviceId: "router", kind: "subnet", cidr: "192.168.50.0/24", state: "approved" },
    { deviceId: "router", kind: "subnet", cidr: "192.168.60.0/24", state: "pending" },
    { deviceId: "router", kind: "exit_node", cidr: "", state: "approved" },
  ];

  it("counts only approved rows as pushed routes", () => {
    const report = buildRouteReport({
      approvals: routes,
      deviceId: "router",
      instances: [
        {
          instanceId: "managed",
          networkName: "net",
          hostname: "router",
          proxyCidrs: ["192.168.50.0/24", "10.99.0.0/16"],
          exitNode: true,
          unmanaged: false,
          removable: true,
        },
      ],
    });
    expect(report.approvedCidrs).toEqual(["192.168.50.0/24"]);
    expect(report.reportedCidrs).toEqual(["10.99.0.0/16", "192.168.50.0/24"]);
    expect(report.unapprovedCidrs).toEqual(["10.99.0.0/16"]);
    expect(report.missingCidrs).toEqual([]);
    expect(report.reportedExitNode).toBe(true);
  });

  it("flags reports from an instance the control plane does not manage", () => {
    const report = buildRouteReport({
      approvals: routes,
      deviceId: "router",
      instances: [
        {
          instanceId: "local-file",
          networkName: "net",
          hostname: "router",
          proxyCidrs: ["172.16.0.0/12"],
          exitNode: false,
          unmanaged: true,
          removable: false,
        },
      ],
    });
    expect(report.unapprovedCidrs).toEqual(["172.16.0.0/12"]);
    expect(report.unmanagedInstances).toHaveLength(1);
    expect(report.missingCidrs).toEqual(["192.168.50.0/24"]);
  });

  it("accepts only non-overlapping subnet requests", () => {
    expect(validateSubnetRequest("192.168.70.0/24", routes)).toEqual({
      cidr: "192.168.70.0/24",
    });
    expect(() => validateSubnetRequest("192.168.50.128/25", routes)).toThrow(/overlaps/);
    expect(() => validateSubnetRequest("0.0.0.0/0", routes)).toThrow(/exit node/);
    expect(() => validateSubnetRequest("not-a-cidr", routes)).toThrow();
  });

  it("normalises CIDRs to their network address", () => {
    expect(normalizeCidr("10.1.2.3/24")).toBe("10.1.2.0/24");
    expect(normalizeCidr("0.0.0.0/0")).toBe("0.0.0.0/0");
    expect(normalizeCidr("192.168.1.5/32")).toBe("192.168.1.5/32");
    expect(cidrContains("10.0.0.0/8", "10.1.2.0/24")).toBe(true);
    expect(cidrContains("10.1.0.0/16", "10.0.0.0/8")).toBe(false);
  });
});
