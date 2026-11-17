import { describe, expect, it } from "vitest";

import { acl } from "@easyplane/proto";
import {
  compilePolicy,
  evaluateChain,
  evaluateReachability,
  normalizePolicyDocument,
  parsePolicyText,
  PolicyValidationError,
  resolvePolicy,
  SubjectResolutionError,
  type CompileInput,
  type PolicyDevice,
  type PolicyDocument,
  type PolicyUser,
  type PolicyUserGroupInput,
} from "@easyplane/server";

/**
 * Golden tests for the policy model v2 and the EasyTier ACL compiler.
 *
 * The translation rules asserted here are the ones measured on real clients in
 * test/conformance/policy-spike.test.ts and described in docs/POLICY.md §3.
 */

const users: PolicyUser[] = [
  { id: "user-alice", email: "alice@example.com", groups: ["engineering"] },
  { id: "user-bob", email: "bob@example.com", groups: ["ops"] },
];

const devices: PolicyDevice[] = [
  {
    id: "dev-web1",
    hostname: "web1",
    virtualIpv4: "10.10.0.2",
    ownerUserId: "user-alice",
    tags: ["tag:web"],
  },
  {
    id: "dev-web2",
    hostname: "web2",
    virtualIpv4: "10.10.0.3",
    ownerUserId: "user-bob",
    tags: ["tag:web"],
  },
  {
    id: "dev-db1",
    hostname: "db1",
    virtualIpv4: "10.10.0.4",
    ownerUserId: "user-bob",
    tags: ["tag:db"],
  },
  {
    id: "dev-laptop",
    hostname: "laptop",
    virtualIpv4: "10.10.0.5",
    ownerUserId: "user-alice",
    tags: [],
  },
  {
    id: "dev-router",
    hostname: "router",
    virtualIpv4: "10.10.0.6",
    ownerUserId: "user-bob",
    tags: ["tag:router"],
  },
];

const routes = [
  {
    deviceId: "dev-router",
    kind: "subnet" as const,
    cidr: "192.168.50.0/24",
    state: "approved" as const,
  },
];

const subnets = [
  {
    name: "home-lan",
    cidr: "192.168.50.0/24",
    viaDeviceId: "dev-router",
    approved: true,
  },
];

const userGroups: PolicyUserGroupInput[] = [
  { name: "ops", source: "manual", members: ["bob@example.com"] },
  { name: "engineering", source: "oidc", members: ["alice@example.com"] },
];

const VERSION = 2 as const;

const baseDocument = normalizePolicyDocument({
  version: VERSION,
  mode: "rules",
  subnets: { "home-lan": { cidr: "192.168.50.0/24", via: "router" } },
  userGroups: {
    ops: { source: "manual", members: ["bob@example.com"] },
    engineering: { source: "oidc", members: ["alice@example.com"] },
  },
  tagOwners: { "tag:db": ["group:ops"] },
  hosts: { "lab-nas": "192.168.50.10" },
  rules: [
    {
      name: "ops-ssh",
      action: "allow",
      from: ["group:ops"],
      to: ["*"],
      protocol: "tcp",
      ports: ["22"],
    },
    {
      name: "web-db",
      action: "allow",
      from: ["tag:web"],
      to: ["tag:db"],
      protocol: "tcp",
      ports: ["5432"],
      stateful: true,
      rateLimit: 200,
      burst: 100,
    },
    {
      name: "laptop-web",
      action: "allow",
      from: ["device:laptop"],
      to: ["tag:web"],
      protocol: "tcp",
      ports: ["80", "443"],
    },
    {
      name: "web-nas",
      action: "allow",
      from: ["tag:web"],
      to: ["subnet:home-lan"],
      protocol: "tcp",
      ports: ["445"],
    },
    {
      name: "lan-web",
      action: "allow",
      from: ["subnet:home-lan"],
      to: ["tag:web"],
      protocol: "tcp",
      ports: ["8080"],
    },
  ],
});

function inputFor(document: PolicyDocument): CompileInput {
  return {
    document,
    devices,
    users,
    knownTags: ["tag:web", "tag:db", "tag:router"],
    routes,
    subnets,
    userGroups,
  };
}

const input = inputFor(baseDocument);
const secret = (group: string) => `secret-for-${group}`;

function compile(document = baseDocument) {
  return compilePolicy(inputFor(document), secret);
}

function chainOf(value: acl.Acl, type: acl.ChainType): acl.Chain | undefined {
  return value.aclV1?.chains.find((chain) => chain.chainType === type);
}

function rules(
  deviceId: string,
  type: acl.ChainType,
  compiledResult = compile(),
) {
  const compiled = compiledResult.byDevice.get(deviceId);
  if (!compiled) throw new Error(`no ACL for ${deviceId}`);
  const chain = chainOf(compiled.acl, type);
  return (chain?.rules ?? []).map((rule) => ({
    name: rule.name,
    priority: rule.priority,
    protocol: acl.Protocol[rule.protocol],
    ports: rule.ports,
    sourcePorts: rule.sourcePorts,
    sourceIps: rule.sourceIps,
    destinationIps: rule.destinationIps,
    action: acl.Action[rule.action],
    sourceGroups: rule.sourceGroups,
    rateLimit: rule.rateLimit,
    burstLimit: rule.burstLimit,
    stateful: rule.stateful,
  }));
}

describe("policy model v2", () => {
  it("loads and upgrades a v1 document without losing statements", () => {
    const document = normalizePolicyDocument({
      groups: { "group:ops": ["bob@example.com"] },
      tagOwners: { "tag:db": ["group:ops"] },
      hosts: { "lab-nas": "192.168.50.10" },
      acls: [
        {
          name: "web-db",
          action: "accept",
          src: ["tag:web"],
          dst: ["tag:db:5432"],
          proto: "tcp",
        },
        { name: "no-telnet", action: "deny", src: ["*"], dst: ["*:23"] },
      ],
    });
    expect(document.version).toBe(2);
    expect(document.mode).toBe("rules");
    expect(document.rules).toHaveLength(2);
    expect(document.rules[0]).toMatchObject({
      action: "allow",
      from: ["tag:web"],
      to: ["tag:db"],
      ports: ["5432"],
      protocol: "tcp",
      stateful: true,
    });
    expect(document.rules[1]).toMatchObject({ action: "deny", ports: ["23"] });
    expect(document.userGroups).toEqual({
      ops: { source: "manual", members: ["bob@example.com"] },
    });
    // The v1 chains become explicit v2 defaults.
    expect(document.chains.inbound.default).toBe("block");
    expect(document.chains.outbound.default).toBe("allow");
    expect(document.chains.forward.default).toBe("block");
  });

  it("parses v2 HuJSON and rejects unknown fields", () => {
    const document = parsePolicyText(`{
      // comments and trailing commas are fine
      "version": 2,
      "rules": [
        { "action": "allow", "from": ["*"], "to": ["*"], "ports": ["443"], },
      ],
    }`);
    expect(document.rules[0]?.ports).toEqual(["443"]);
    expect(() =>
      normalizePolicyDocument({ version: 2, notAField: true }),
    ).toThrow(PolicyValidationError);
  });

  it("validates ports, ranges, CIDRs, burst and duplicate names", () => {
    const rule = (patch: Record<string, unknown>) =>
      normalizePolicyDocument({
        version: 2,
        rules: [{ action: "allow", from: ["*"], to: ["*"], ...patch }],
      });
    expect(() => rule({ ports: ["0"] })).toThrow(/1-65535/);
    expect(() => rule({ ports: ["8080-80"] })).toThrow(/low < high/);
    expect(() => rule({ ports: ["8080-8080"] })).toThrow(/low < high/);
    expect(() => rule({ sourcePorts: ["70000"] })).toThrow(/1-65535/);
    expect(() => rule({ rateLimit: 10 })).toThrow(/non-zero burst/);
    expect(() => rule({ protocol: "icmp", ports: ["22"] })).toThrow(/cannot match a port/);
    expect(() =>
      normalizePolicyDocument({
        version: 2,
        hosts: { nas: "not-an-ip" },
        rules: [{ action: "allow", from: ["host:nas"], to: ["*"] }],
      }),
    ).toThrow(/not an IP/);
    expect(() =>
      normalizePolicyDocument({
        version: 2,
        rules: [
          { name: "same", action: "allow", from: ["*"], to: ["*"] },
          { name: "same", action: "allow", from: ["*"], to: ["*"] },
        ],
      }),
    ).toThrow(/duplicate rule name/);
    // Duplicate empty names are fine.
    expect(() =>
      normalizePolicyDocument({
        version: 2,
        rules: [
          { action: "allow", from: ["*"], to: ["*"] },
          { action: "allow", from: ["*"], to: ["*"] },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts IPv6 addresses and CIDRs in hosts and custom subjects", () => {
    const document = normalizePolicyDocument({
      version: 2,
      hosts: { v6host: "2001:db8::1", v6net: "2001:db8::/32" },
      rules: [{ action: "allow", from: ["cidr:2001:db8::/48"], to: ["*"] }],
    });
    expect(document.hosts.v6host).toBe("2001:db8::1");
  });

  it("keeps tags and user groups as separate concepts", () => {
    const resolved = resolvePolicy(input, { strict: true });
    // group:ops = bob's devices; tag:web = two devices; neither is the other.
    const ops = resolved.statements[0]!;
    expect(ops.srcDevices.map((device) => device.hostname).sort()).toEqual([
      "db1",
      "router",
      "web2",
    ]);
    expect(ops.srcGroups).toEqual(["group:ops"]);
    expect(ops.srcTags).toEqual([]);
    const web = resolved.statements[1]!;
    expect(web.srcTags).toEqual(["tag:web"]);
    expect(web.srcGroups).toEqual([]);
    expect(resolved.groupsByDevice.get("dev-db1")).toEqual(["group:ops", "tag:db"]);
    expect(resolved.groupsByDevice.get("dev-laptop")).toEqual(["group:engineering"]);
  });
});

describe("compiler v2 goldens", () => {
  it("tag -> tag: an inbound allow with enumerated sources and ports", () => {
    expect(rules("dev-db1", acl.ChainType.Inbound)).toEqual([
      {
        name: "ops-ssh-in",
        priority: 65535,
        protocol: "TCP",
        ports: ["22"],
        sourcePorts: [],
        sourceIps: ["10.10.0.3/32", "10.10.0.4/32", "10.10.0.6/32"],
        destinationIps: [],
        action: "Allow",
        sourceGroups: [],
        rateLimit: 0,
        burstLimit: 0,
        stateful: true,
      },
      {
        name: "web-db-in",
        priority: 65534,
        protocol: "TCP",
        ports: ["5432"],
        sourcePorts: [],
        sourceIps: ["10.10.0.2/32", "10.10.0.3/32"],
        destinationIps: [],
        action: "Allow",
        sourceGroups: [],
        rateLimit: 200,
        burstLimit: 100,
        stateful: true,
      },
    ]);
  });

  it("user group -> anywhere expands through device ownership", () => {
    // group:ops is bob; bob owns web2, db1 and router.
    const ssh = rules("dev-db1", acl.ChainType.Inbound)[0]!;
    expect(ssh.sourceIps).toEqual(["10.10.0.3/32", "10.10.0.4/32", "10.10.0.6/32"]);
    // laptop (alice) is not in group:ops.
    expect(
      rules("dev-web1", acl.ChainType.Inbound)[0]!.sourceIps,
    ).not.toContain("10.10.0.5/32");
  });

  it("declares namespaced EasyTier groups and its own memberships", () => {
    const db1 = compile().byDevice.get("dev-db1")!;
    expect(db1.acl.aclV1?.group?.members).toEqual(["group:ops", "tag:db"]);
    expect(db1.acl.aclV1?.group?.declares).toEqual([
      { groupName: "group:ops", groupSecret: "secret-for-group:ops" },
      { groupName: "tag:db", groupSecret: "secret-for-tag:db" },
    ]);
    const laptop = compile().byDevice.get("dev-laptop")!;
    expect(laptop.acl.aclV1?.group).toEqual({
      declares: [{ groupName: "group:engineering", groupSecret: "secret-for-group:engineering" }],
      members: ["group:engineering"],
    });
  });

  it("adds group criteria only with strict options, namespaced by kind", () => {
    const strict = normalizePolicyDocument({
      ...JSON.parse(JSON.stringify(baseDocument)),
      options: { strictTags: true, strictGroups: true },
    });
    const compiled = compilePolicy(inputFor(strict), secret);
    const db1 = compiled.byDevice.get("dev-db1")!;
    const inbound = chainOf(db1.acl, acl.ChainType.Inbound)!;
    expect(inbound.rules.find((rule) => rule.name === "web-db-in")?.sourceGroups).toEqual([
      "tag:web",
    ]);
    expect(inbound.rules.find((rule) => rule.name === "ops-ssh-in")?.sourceGroups).toEqual([
      "group:ops",
    ]);
    // The verifier declares the secrets it needs to check the proofs.
    expect(db1.acl.aclV1?.group?.declares.map((entry) => entry.groupName)).toEqual([
      "group:ops",
      "tag:db",
      "tag:web",
    ]);
  });

  it("device -> subnet compiles a Forward allow on the router", () => {
    const forward = chainOf(
      compile().byDevice.get("dev-router")!.acl,
      acl.ChainType.Forward,
    )!;
    expect(forward.defaultAction).toBe(acl.Action.Drop);
    const webNas = forward.rules.find((rule) => rule.name === "web-nas-subnet-fwd")!;
    expect(webNas).toMatchObject({
      destinationIps: ["192.168.50.0/24"],
      ports: ["445"],
      sourceIps: ["10.10.0.2/32", "10.10.0.3/32"],
    });
  });

  it("subnet -> device emits the receive rule and the reply forward rule", () => {
    const web1 = compile().byDevice.get("dev-web1")!;
    const inbound = chainOf(web1.acl, acl.ChainType.Inbound)!;
    const lanWeb = inbound.rules.find((rule) => rule.name === "lan-web-in")!;
    expect(lanWeb.sourceIps).toEqual(["192.168.50.0/24"]);
    expect(lanWeb.ports).toEqual(["8080"]);

    const routerForward = chainOf(
      compile().byDevice.get("dev-router")!.acl,
      acl.ChainType.Forward,
    )!;
    const reply = routerForward.rules.find(
      (rule) => rule.name === "lan-web-reply-fwd",
    )!;
    // Forward is default-block: the reply of a LAN-initiated connection needs
    // an explicit, low-priority rule or a 30 s idle gap breaks it.
    expect(reply).toMatchObject({
      sourceIps: ["10.10.0.2/32", "10.10.0.3/32"],
      destinationIps: ["192.168.50.0/24"],
      sourcePorts: ["8080"],
      action: acl.Action.Allow,
    });
    expect(reply.priority).toBeLessThan(1_000);
  });

  it("emits egress and reply rules when the outbound chain is default-block", () => {
    const document = normalizePolicyDocument({
      ...JSON.parse(JSON.stringify(baseDocument)),
      chains: {
        inbound: { default: "block", enabled: true },
        outbound: { default: "block", enabled: true },
        forward: { default: "block", enabled: true },
      },
    });
    const compiled = compile(document);
    const web1Out = rules("dev-web1", acl.ChainType.Outbound, compiled);
    expect(web1Out.map((rule) => rule.name)).toContain("web-db-out");
    expect(web1Out.find((rule) => rule.name === "web-db-out")).toMatchObject({
      destinationIps: ["10.10.0.4/32"],
      ports: ["5432"],
      action: "Allow",
    });
    const db1Out = rules("dev-db1", acl.ChainType.Outbound, compiled);
    expect(db1Out.find((rule) => rule.name === "web-db-reply-out")).toMatchObject({
      destinationIps: ["10.10.0.2/32", "10.10.0.3/32"],
      sourcePorts: ["5432"],
      action: "Allow",
    });
    expect(db1Out.find((rule) => rule.name === "web-db-reply-out")!.priority).toBeLessThan(
      1_000,
    );
  });

  it("compiles deny rules on the source egress and the destination inbound", () => {
    const document = normalizePolicyDocument({
      version: 2,
      rules: [
        {
          name: "no-db-for-web",
          action: "deny",
          from: ["tag:web"],
          to: ["tag:db"],
          protocol: "tcp",
          ports: ["5432"],
        },
      ],
    });
    const compiled = compile(document);
    const out = rules("dev-web1", acl.ChainType.Outbound, compiled);
    expect(out).toEqual([
      expect.objectContaining({
        name: "no-db-for-web-deny-out",
        destinationIps: ["10.10.0.4/32"],
        ports: ["5432"],
        action: "Drop",
        // Explicit denies outrank any reverse convenience rule.
        priority: 65535,
      }),
    ]);
    const inbound = rules("dev-db1", acl.ChainType.Inbound, compiled);
    expect(inbound).toEqual([
      expect.objectContaining({
        name: "no-db-for-web-in",
        sourceIps: ["10.10.0.2/32", "10.10.0.3/32"],
        action: "Drop",
      }),
    ]);
    const result = evaluateReachability({
      srcAcl: compiled.byDevice.get("dev-web1")!.acl,
      dstAcl: compiled.byDevice.get("dev-db1")!.acl,
      srcIp: "10.10.0.2",
      dstIp: "10.10.0.4",
      protocol: "tcp",
      port: 5432,
    });
    expect(result.allowed).toBe(false);
    expect(result.egress.matchedRule).toBe("no-db-for-web-deny-out");
  });

  it("compiles an unreachable subnet destination into a Forward deny on the router", () => {
    const document = normalizePolicyDocument({
      version: 2,
      subnets: { "home-lan": { cidr: "192.168.50.0/24", via: "router" } },
      rules: [
        {
          name: "no-nas-smb",
          action: "deny",
          from: ["device:laptop"],
          to: ["subnet:home-lan"],
          protocol: "tcp",
          ports: ["445"],
        },
      ],
    });
    const forward = rules("dev-router", acl.ChainType.Forward, compile(document));
    expect(forward).toEqual([
      expect.objectContaining({
        name: "no-nas-smb-subnet-fwd",
        destinationIps: ["192.168.50.0/24"],
        ports: ["445"],
        action: "Drop",
      }),
    ]);
  });

  it("skips disabled rules entirely", () => {
    const document = normalizePolicyDocument({
      version: 2,
      rules: [
        {
          name: "off",
          enabled: false,
          action: "allow",
          from: ["*"],
          to: ["*"],
        },
      ],
    });
    const compiled = compile(document);
    expect(rules("dev-web1", acl.ChainType.Inbound, compiled)).toEqual([]);
    expect(rules("dev-web1", acl.ChainType.Outbound, compiled)).toEqual([]);
  });

  it("maps ICMPv6 without ports", () => {
    const document = normalizePolicyDocument({
      version: 2,
      rules: [
        {
          name: "ping6",
          action: "allow",
          from: ["device:laptop"],
          to: ["device:db1"],
          protocol: "icmpv6",
        },
      ],
    });
    const inbound = rules("dev-db1", acl.ChainType.Inbound, compile(document));
    expect(inbound[0]).toMatchObject({
      name: "ping6-in",
      protocol: "ICMPv6",
      ports: [],
      sourceIps: ["10.10.0.5/32"],
    });
    const decision = evaluateChain(
      compile(document).byDevice.get("dev-db1")!.acl,
      "Inbound",
      { srcIp: "10.10.0.5", dstIp: "10.10.0.4", protocol: "icmpv6" },
    );
    expect(decision.action).toBe("allow");
  });

  it("carries port ranges, source ports and rate limits", () => {
    const document = normalizePolicyDocument({
      version: 2,
      rules: [
        {
          name: "range",
          action: "allow",
          from: ["device:laptop"],
          to: ["device:db1"],
          protocol: "tcp",
          ports: ["8000-8100", "443"],
          sourcePorts: ["1024-65535"],
          rateLimit: 50,
          burst: 100,
        },
      ],
    });
    const inbound = rules("dev-db1", acl.ChainType.Inbound, compile(document));
    expect(inbound[0]).toMatchObject({
      ports: ["8000-8100", "443"],
      sourcePorts: ["1024-65535"],
      rateLimit: 50,
      burstLimit: 100,
    });
  });

  it("honours per-chain defaults, names and disabled chains", () => {
    const document = normalizePolicyDocument({
      version: 2,
      chains: {
        inbound: { default: "allow", enabled: true, name: "in" },
        outbound: { default: "block", enabled: false, name: "out" },
        forward: { default: "allow", enabled: false, name: "fwd" },
      },
      rules: [
        { name: "all-web", action: "allow", from: ["*"], to: ["tag:web"] },
      ],
    });
    const compiled = compile(document);
    const web1 = compiled.byDevice.get("dev-web1")!;
    expect(chainOf(web1.acl, acl.ChainType.Inbound)).toMatchObject({
      name: "in",
      defaultAction: acl.Action.Allow,
      enabled: true,
    });
    // A disabled chain is omitted, never `enabled: false` (upstream keeps the
    // default action of a disabled chain).
    expect(chainOf(web1.acl, acl.ChainType.Outbound)).toBeUndefined();
    expect(chainOf(web1.acl, acl.ChainType.Forward)).toBeUndefined();
    const router = compiled.byDevice.get("dev-router")!;
    expect(chainOf(router.acl, acl.ChainType.Forward)).toBeUndefined();
  });

  it("produces no ACL at all in open mode", () => {
    const document = normalizePolicyDocument({
      ...JSON.parse(JSON.stringify(baseDocument)),
      mode: "open",
    });
    expect(compile(document).byDevice.size).toBe(0);
  });
});

describe("owner's LAN host scenario (model v2)", () => {
  const document = normalizePolicyDocument({
    version: 2,
    subnets: { "owner-lan": { cidr: "192.168.55.0/24", via: "router" } },
    chains: {
      inbound: { default: "block", enabled: true },
      outbound: { default: "block", enabled: true },
      forward: { default: "block", enabled: true },
    },
    rules: [
      {
        name: "lan-to-vps",
        action: "allow",
        from: ["subnet:owner-lan"],
        to: ["device:db1"],
        protocol: "tcp",
        ports: ["443"],
      },
      {
        name: "vps-to-lan",
        action: "allow",
        from: ["device:db1"],
        to: ["subnet:owner-lan"],
        protocol: "tcp",
        ports: ["8080"],
      },
    ],
  });
  const compiled = compile(document);

  it("names the LAN CIDR at the remote destination and the router egress", () => {
    const db1In = chainOf(compiled.byDevice.get("dev-db1")!.acl, acl.ChainType.Inbound)!;
    expect(db1In.rules.find((rule) => rule.name === "lan-to-vps-in")).toMatchObject({
      sourceIps: ["192.168.55.0/24"],
      ports: ["443"],
    });
    const routerOut = chainOf(
      compiled.byDevice.get("dev-router")!.acl,
      acl.ChainType.Outbound,
    )!;
    expect(routerOut.rules.find((rule) => rule.name === "lan-to-vps-lan-out")).toMatchObject({
      sourceIps: ["192.168.55.0/24", "10.10.0.6/32"],
      destinationIps: ["10.10.0.4/32"],
      ports: ["443"],
    });
    expect(routerOut.rules.find((rule) => rule.name === "vps-to-lan-reply-lan-out")).toMatchObject({
      sourceIps: ["192.168.55.0/24", "10.10.0.6/32"],
      destinationIps: ["10.10.0.4/32"],
    });
    // The userspace subnet proxy sends the return traffic from the router's
    // own overlay IP with an ephemeral port, so the peer pair must be allowed
    // without a port criterion.
    expect(routerOut.rules.find((rule) => rule.name === "vps-to-lan-proxy-out")).toMatchObject({
      sourceIps: ["10.10.0.6/32"],
      destinationIps: ["10.10.0.4/32"],
      ports: [],
      sourcePorts: [],
    });
  });

  it("admits both directions with the compiled chains", () => {
    const remote = compiled.byDevice.get("dev-db1")!.acl;
    const router = compiled.byDevice.get("dev-router")!.acl;
    // LAN host -> db1: through the router Outbound, then db1 Inbound.
    const outbound = evaluateChain(router, "Outbound", {
      srcIp: "192.168.55.16",
      dstIp: "10.10.0.4",
      protocol: "tcp",
      dstPort: 443,
    });
    const inbound = evaluateChain(remote, "Inbound", {
      srcIp: "192.168.55.16",
      dstIp: "10.10.0.4",
      protocol: "tcp",
      dstPort: 443,
    });
    expect(outbound.action).toBe("allow");
    expect(inbound.action).toBe("allow");
    // db1 -> LAN host: the router Forward chain decides (the userspace proxy).
    const forward = evaluateChain(router, "Forward", {
      srcIp: "10.10.0.4",
      dstIp: "192.168.55.16",
      protocol: "tcp",
      srcPort: 40_000,
      dstPort: 8080,
    });
    expect(forward.action).toBe("allow");
    expect(forward.matchedRule).toBe("vps-to-lan-subnet-fwd");
  });
});

describe("policy resolution", () => {
  it("rejects unknown tags when saving (strict) and warns when pushing", () => {
    const doc = normalizePolicyDocument({
      version: 2,
      rules: [{ action: "allow", from: ["tag:ghost"], to: ["*"] }],
    });
    expect(() =>
      resolvePolicy({ ...input, document: doc }, { strict: true }),
    ).toThrow(SubjectResolutionError);
    const lenient = resolvePolicy({ ...input, document: doc }, { strict: false });
    expect(lenient.warnings.join(" ")).toContain("tag:ghost");
  });

  it("rejects unknown user groups and subnets strictly", () => {
    for (const from of ["group:ghost", "subnet:ghost"]) {
      const doc = normalizePolicyDocument({
        version: 2,
        subnets: { "home-lan": { cidr: "192.168.50.0/24" }, ghost: { cidr: "10.99.0.0/24" } },
        rules: [{ action: "allow", from: [from], to: ["*"] }],
      });
      expect(() =>
        resolvePolicy({ ...input, document: doc }, { strict: true }),
      ).toThrow(SubjectResolutionError);
    }
  });
});

describe("reachability evaluator", () => {
  const compiled = compile();
  const aclOf = (id: string) => compiled.byDevice.get(id)!.acl;

  function can(src: string, dst: string, port: number, protocol: "tcp" | "udp" | "icmp" = "tcp") {
    return evaluateReachability({
      srcAcl: aclOf(src),
      dstAcl: aclOf(dst),
      srcIp: devices.find((device) => device.id === src)!.virtualIpv4,
      dstIp: devices.find((device) => device.id === dst)!.virtualIpv4,
      protocol,
      port,
    });
  }

  it("allows tag:web -> tag:db:5432 and names the rule", () => {
    const result = can("dev-web1", "dev-db1", 5432);
    expect(result.allowed).toBe(true);
    expect(result.ingress.matchedRule).toBe("web-db-in");
  });

  it("denies an unlisted port by the destination default action", () => {
    const result = can("dev-web1", "dev-db1", 3306);
    expect(result.allowed).toBe(false);
    expect(result.ingress.byDefault).toBe(true);
    expect(result.ingress.action).toBe("drop");
  });

  it("mirrors upstream: an Any-protocol rule with ports matches ICMP", () => {
    const doc = normalizePolicyDocument({
      version: 2,
      rules: [{ name: "any-22", action: "allow", from: ["tag:web"], to: ["tag:db"], ports: ["22"] }],
    });
    const anyCompiled = compile(doc);
    const decision = evaluateChain(anyCompiled.byDevice.get("dev-db1")!.acl, "Inbound", {
      srcIp: "10.10.0.2",
      dstIp: "10.10.0.4",
      protocol: "icmp",
    });
    expect(decision.matchedRule).toBe("any-22-in");
    expect(decision.action).toBe("allow");
  });
});
