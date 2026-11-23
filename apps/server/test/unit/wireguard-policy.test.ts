import { describe, expect, it } from "vitest";

import { acl } from "@easyplane/proto";
import {
  compilePolicy,
  normalizePolicyDocument,
  resolvePolicy,
  type PolicyDevice,
  type PolicyUser,
} from "@easyplane/server";

/**
 * A WireGuard portal client is a policy subject like a device: it owns an
 * address from the same pool and carries tags. The compiler must include its
 * address in rules that name its tag, and the hub's ACL must declare the
 * portal client's groups (upstream rejects an undeclared group).
 */
const users: PolicyUser[] = [];

const devices: PolicyDevice[] = [
  {
    id: "dev-hub",
    hostname: "hub",
    virtualIpv4: "10.10.0.2",
    ownerUserId: null,
    tags: ["tag:server"],
    kind: "device",
  },
  {
    id: "dev-db",
    hostname: "db",
    virtualIpv4: "10.10.0.3",
    ownerUserId: null,
    tags: ["tag:db"],
    kind: "device",
  },
  {
    id: "wg-phone",
    hostname: "phone",
    virtualIpv4: "10.10.0.20",
    ownerUserId: null,
    tags: ["tag:mobile"],
    kind: "wireguard",
  },
];

const document = normalizePolicyDocument({
  version: 2,
  mode: "rules",
  rules: [
    {
      name: "phone-to-db",
      action: "allow",
      from: ["tag:mobile"],
      to: ["tag:db"],
      protocol: "tcp",
      ports: ["5432"],
    },
    {
      name: "db-to-phone",
      action: "allow",
      from: ["tag:db"],
      to: ["tag:mobile"],
      protocol: "tcp",
      ports: ["22"],
    },
  ],
});

function compile(extraDeclaredGroups?: Map<string, string[]>) {
  const input = {
    document,
    devices,
    users,
    knownTags: ["tag:server", "tag:db", "tag:mobile"],
    routes: [],
    ...(extraDeclaredGroups ? { extraDeclaredGroups } : {}),
  };
  return compilePolicy(input, (group) => `secret:${group}`);
}

describe("WireGuard clients in the compiled ACL", () => {
  it("resolves a portal client as a tag subject with its address", () => {
    const resolved = resolvePolicy(
      {
        document,
        devices,
        users,
        knownTags: ["tag:server", "tag:db", "tag:mobile"],
        routes: [],
      },
      { strict: true },
    );
    const phone = resolved.statements[0]!;
    expect(phone.srcDevices.map((device) => device.id)).toEqual(["wg-phone"]);
    expect(
      resolved.statements[1]!.dst.map((entry) =>
        entry.kind === "device" ? entry.device.id : entry.cidr,
      ),
    ).toContain("wg-phone");
  });

  it("compiles the client address into the destination's inbound rule", () => {
    const compiled = compile();
    const db = compiled.byDevice.get("dev-db")!;
    const inbound = db.acl.aclV1?.chains.find(
      (chain) => chain.chainType === acl.ChainType.Inbound,
    );
    const rule = inbound?.rules.find((entry) => entry.name === "phone-to-db-in");
    expect(rule?.sourceIps).toEqual(["10.10.0.20/32"]);
    expect(rule?.ports).toEqual(["5432"]);
  });

  it("gives the portal client an egress rule for its own traffic", () => {
    const compiled = compile();
    const phone = compiled.byDevice.get("wg-phone")!;
    // It is served by the hub and never receives a pushed ACL, but compiling
    // one keeps the reachability preview honest.
    expect(phone.acl.aclV1?.chains.length).toBeGreaterThan(0);
  });

  it("declares the groups a hub's portal clients use", () => {
    const extras = new Map([["dev-hub", ["tag:mobile"]]]);
    const compiled = compile(extras);
    const hub = compiled.byDevice.get("dev-hub")!;
    const declared = (hub.acl.aclV1?.group?.declares ?? []).map(
      (entry) => entry.groupName,
    );
    expect(declared).toContain("tag:mobile");
    expect(declared).toContain("tag:server");
    expect(compiled.declaredGroups.get("dev-hub")).toContain("tag:mobile");
  });
});
