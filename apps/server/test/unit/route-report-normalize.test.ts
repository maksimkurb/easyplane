import { describe, expect, it } from "vitest";

import { routeReportSchema } from "../../src/app/schemas.js";
import { normalizeRouteReport } from "../../src/domain/routes.js";

describe("normalizeRouteReport", () => {
  it("returns null for a missing report", () => {
    expect(normalizeRouteReport(undefined)).toBeNull();
    expect(normalizeRouteReport(null)).toBeNull();
    expect(normalizeRouteReport("nope")).toBeNull();
  });

  it("fills fields that reports from older builds do not have", () => {
    const legacy = {
      approvedCidrs: ["10.0.0.0/24"],
      unapprovedCidrs: [],
      missingCidrs: [],
      reportedExitNode: false,
      unmanagedInstances: [{ instanceId: "a", proxyCidrs: ["192.168.1.0/24"] }],
    };
    const report = normalizeRouteReport(legacy);
    expect(report).toMatchObject({
      approvedCidrs: ["10.0.0.0/24"],
      declaredCidrs: [],
      configuredCidrs: [],
      observedCidrs: [],
      unapprovedObservedCidrs: [],
      unknownPeers: [],
    });
    expect(routeReportSchema.safeParse(report).success).toBe(true);
  });

  it("drops malformed array items instead of failing", () => {
    const report = normalizeRouteReport({
      approvedCidrs: ["10.0.0.0/24", 42, null],
      unknownPeers: [null, { ipv4: "10.1.0.2", proxyCidrs: "x", deviceId: 7 }],
    });
    expect(report?.approvedCidrs).toEqual(["10.0.0.0/24"]);
    expect(report?.unknownPeers).toEqual([
      { ipv4: "10.1.0.2", hostname: "", proxyCidrs: [] },
    ]);
    expect(routeReportSchema.safeParse(report).success).toBe(true);
  });
});
