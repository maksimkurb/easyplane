import { describe, expect, it } from "vitest";

import { acl } from "@easyplane/proto";
import {
  compilePolicy,
  evaluateChain,
  evaluateReachability,
  normalizePolicyDocument,
  PolicyValidationError,
  resolvePolicy,
  SubjectResolutionError,
  type CompileInput,
  type PolicyDevice,
  type PolicyDocument,
  type PolicyUser,
} from "@easyplane/server";

/**
 * Golden tests for the Tailscale-style policy -> EasyTier ACL compiler.
 *
 * Fixture: one small network with a web tier, a database, an operator laptop
 * and a subnet router. Secrets are produced by a deterministic stub so the
 * compiled group declarations are stable.
 */

const NETWORK = "11111111-1111-4111-8111-111111111111";

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

const document: PolicyDocument = normalizePolicyDocument({
  groups: { "group:ops": ["bob@example.com"] },
  tagOwners: { "tag:db": ["group:ops"] },
  hosts: { "lab-nas": "192.168.50.10" },
  acls: [
    {
      name: "ops-ssh-everything",
      action: "accept",
      src: ["group:ops"],
      dst: ["*:22"],
      proto: "tcp",
    },
    {
      name: "web-to-db",
      action: "accept",
      src: ["tag:web"],
      dst: ["tag:db:5432"],
      proto: "tcp",
      stateful: true,
      rateLimit: 200,
      burst: 100,
    },
    {
      name: "laptop-to-web",
      action: "accept",
      src: ["device:laptop"],
      dst: ["tag:web:80,443"],
      proto: "tcp",
    },
    {
      name: "web-to-nas",
      action: "accept",
      src: ["tag:web"],
      dst: ["cidr:192.168.50.0/24:445"],
      proto: "tcp",
    },
  ],
});

const input: CompileInput = {
  document,
  devices,
  users,
  knownTags: ["tag:web", "tag:db", "tag:router"],
  routes,
};

const secret = (tag: string) => `secret-for-${tag}`;

function compile() {
  return compilePolicy(input, secret);
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
    sourceIps: rule.sourceIps,
    destinationIps: rule.destinationIps,
    action: acl.Action[rule.action],
    sourceGroups: rule.sourceGroups,
    rateLimit: rule.rateLimit,
    burstLimit: rule.burstLimit,
    stateful: rule.stateful,
  }));
}

describe("policy compiler goldens", () => {
  it("compiles the database's inbound chain in document order", () => {
    expect(rules("dev-db1", acl.ChainType.Inbound)).toEqual([
      {
        name: "ops-ssh-everything-in",
        priority: 65535,
        protocol: "TCP",
        // 22 is not the database's port for this statement, so the ops group
        // still reaches db1:22 (the golden below proves ordering).
        ports: ["22"],
        sourceIps: ["10.10.0.3/32", "10.10.0.4/32", "10.10.0.6/32"],
        destinationIps: [],
        action: "Allow",
        sourceGroups: [],
        rateLimit: 0,
        burstLimit: 0,
        stateful: false,
      },
      {
        name: "web-to-db-in",
        priority: 65534,
        protocol: "TCP",
        ports: ["5432"],
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

  it("defaults the inbound chain to drop and the outbound chain to allow", () => {
    const compiled = compile().byDevice.get("dev-laptop")!;
    expect(chainOf(compiled.acl, acl.ChainType.Inbound)).toMatchObject({
      defaultAction: acl.Action.Drop,
      enabled: true,
    });
    expect(chainOf(compiled.acl, acl.ChainType.Outbound)).toMatchObject({
      defaultAction: acl.Action.Allow,
    });
    // No approved routes -> no forward chain at all.
    expect(chainOf(compiled.acl, acl.ChainType.Forward)).toBeUndefined();
  });

  it("compiles the subnet router's forward chain and defaults it to drop", () => {
    const compiled = compile().byDevice.get("dev-router")!;
    const forward = chainOf(compiled.acl, acl.ChainType.Forward)!;
    expect(forward.defaultAction).toBe(acl.Action.Drop);
    expect(forward.rules.map((rule) => rule.name)).toEqual(["web-to-nas-fwd"]);
    expect(forward.rules[0]).toMatchObject({
      destinationIps: ["192.168.50.0/24"],
      ports: ["445"],
      sourceIps: ["10.10.0.2/32", "10.10.0.3/32"],
    });
  });

  it("declares EasyTier groups with a derived secret and its own memberships", () => {
    const compiled = compile().byDevice.get("dev-web1")!;
    expect(compiled.acl.aclV1?.group).toEqual({
      declares: [{ groupName: "tag:web", groupSecret: "secret-for-tag:web" }],
      members: ["tag:web"],
    });
    const laptop = compile().byDevice.get("dev-laptop")!;
    expect(laptop.acl.aclV1?.group).toEqual({ declares: [], members: [] });
  });

  it("expands user groups through device ownership", () => {
    // group:ops is bob; bob owns web2, db1 and router.
    const db1 = rules("dev-db1", acl.ChainType.Inbound)[0]!;
    expect(db1.sourceIps).toEqual(["10.10.0.3/32", "10.10.0.4/32", "10.10.0.6/32"]);
    // laptop is alice's and is not in group:ops.
    const laptop = rules("dev-web1", acl.ChainType.Inbound)[0]!;
    expect(laptop.sourceIps).not.toContain("10.10.0.5/32");
  });

  it("is deterministic and secret-free apart from group declarations", () => {
    const first = JSON.stringify(compile().byDevice.get("dev-db1")!.acl);
    const second = JSON.stringify(compile().byDevice.get("dev-db1")!.acl);
    expect(first).toBe(second);
    expect(first).not.toContain("networkSecret");
    expect(first).toContain("secret-for-tag:db");
  });

  it("adds source group criteria only with options.strictTags", () => {
    const strict = normalizePolicyDocument({
      ...JSON.parse(JSON.stringify(document)),
      options: { strictTags: true },
    });
    const compiled = compilePolicy({ ...input, document: strict }, secret);
    const db1 = compiled.byDevice.get("dev-db1")!;
    const rule = chainOf(db1.acl, acl.ChainType.Inbound)!.rules.find(
      (entry) => entry.name === "web-to-db-in",
    )!;
    expect(rule.sourceGroups).toEqual(["tag:web"]);
    // The verifier declares the group secret it needs to check the proof.
    expect(db1.acl.aclV1?.group?.declares.map((entry) => entry.groupName)).toEqual([
      "tag:db",
      "tag:web",
    ]);
    expect(db1.acl.aclV1?.group?.members).toEqual(["tag:db"]);
  });

  it("compiles egress denies into the outbound chain and nothing else", () => {
    const denyDoc = normalizePolicyDocument({
      acls: [
        {
          name: "no-db-for-web",
          action: "deny",
          src: ["tag:web"],
          dst: ["tag:db:5432"],
          proto: "tcp",
        },
      ],
    });
    const compiled = compilePolicy({ ...input, document: denyDoc }, secret);
    expect(rules("dev-web1", acl.ChainType.Outbound, compiled)).toEqual([
      {
        name: "no-db-for-web-out",
        priority: 65535,
        protocol: "TCP",
        ports: ["5432"],
        sourceIps: [],
        destinationIps: ["10.10.0.4/32"],
        action: "Drop",
        sourceGroups: [],
        rateLimit: 0,
        burstLimit: 0,
        stateful: false,
      },
    ]);
    // The destination's default drop already denies it too.
    expect(rules("dev-db1", acl.ChainType.Inbound, compiled)).toEqual([]);
  });
});

describe("policy resolution", () => {
  it("rejects unknown tags when saving (strict) and warns when pushing", () => {
    const doc = normalizePolicyDocument({
      acls: [{ action: "accept", src: ["tag:ghost"], dst: ["*:*"] }],
    });
    expect(() =>
      resolvePolicy({ ...input, document: doc }, { strict: true }),
    ).toThrow(SubjectResolutionError);
    const lenient = resolvePolicy({ ...input, document: doc }, { strict: false });
    expect(lenient.warnings.join(" ")).toContain("tag:ghost");
  });

  it("validates port specifications and destination syntax", () => {
    expect(() =>
      normalizePolicyDocument({
        acls: [{ action: "accept", src: ["*"], dst: ["*:8080-80"] }],
      }),
    ).toThrow(PolicyValidationError);
    expect(() =>
      normalizePolicyDocument({
        acls: [{ action: "accept", src: ["*"], dst: ["tag:web:not-a-port"] }],
      }),
    ).toThrow(/invalid tag subject/);
  });

  it("requires a burst for rate-limited rules", () => {
    expect(() =>
      normalizePolicyDocument({
        acls: [
          { name: "rl", action: "accept", src: ["*"], dst: ["*:80"], rateLimit: 10 },
        ],
      }),
    ).toThrow(/non-zero burst/);
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
    expect(result.ingress.matchedRule).toBe("web-to-db-in");
  });

  it("denies an unlisted port by the destination default action", () => {
    const result = can("dev-web1", "dev-db1", 3306);
    expect(result.allowed).toBe(false);
    expect(result.ingress.byDefault).toBe(true);
    expect(result.ingress.action).toBe("drop");
  });

  it("lets group:ops reach every device on 22 only", () => {
    expect(can("dev-web2", "dev-web1", 22).allowed).toBe(true);
    expect(can("dev-web2", "dev-web1", 23).allowed).toBe(false);
    // laptop (alice) is not in group:ops.
    expect(can("dev-laptop", "dev-web1", 22).allowed).toBe(false);
  });

  it("honours explicit deny rules on the source", () => {
    const doc = normalizePolicyDocument({
      acls: [
        { name: "deny", action: "deny", src: ["tag:web"], dst: ["tag:db:5432"], proto: "tcp" },
        { name: "allow", action: "accept", src: ["tag:web"], dst: ["tag:db:5432"], proto: "tcp" },
      ],
    });
    const denyCompiled = compilePolicy({ ...input, document: doc }, secret);
    const result = evaluateReachability({
      srcAcl: denyCompiled.byDevice.get("dev-web1")!.acl,
      dstAcl: denyCompiled.byDevice.get("dev-db1")!.acl,
      srcIp: "10.10.0.2",
      dstIp: "10.10.0.4",
      protocol: "tcp",
      port: 5432,
    });
    expect(result.allowed).toBe(false);
    expect(result.egress.matchedRule).toBe("deny-out");
  });

  it("mirrors upstream: an Any-protocol rule with ports matches ICMP", () => {
    const doc = normalizePolicyDocument({
      acls: [
        { name: "any-22", action: "accept", src: ["tag:web"], dst: ["tag:db:22"] },
      ],
    });
    const anyCompiled = compilePolicy({ ...input, document: doc }, secret);
    const decision = evaluateChain(
      anyCompiled.byDevice.get("dev-db1")!.acl,
      "Inbound",
      { srcIp: "10.10.0.2", dstIp: "10.10.0.4", protocol: "icmp" },
    );
    // ICMP carries no port, so EasyTier skips the port criterion entirely.
    expect(decision.matchedRule).toBe("any-22-in");
    // A TCP-only rule does not match ICMP because of the protocol criterion.
    const tcpOnly = evaluateChain(aclOf("dev-db1"), "Inbound", {
      srcIp: "10.10.0.2",
      dstIp: "10.10.0.4",
      protocol: "icmp",
    });
    expect(tcpOnly.action).toBe("drop");
  });
});

describe("golden: full ACL for one device", () => {
  it("matches the committed shape for db1", () => {
    const compiled = compile().byDevice.get("dev-db1")!;
    expect(compiled.acl).toMatchObject({
      aclV1: {
        chains: [
          {
            name: "easyplane-inbound",
            chainType: acl.ChainType.Inbound,
            enabled: true,
            defaultAction: acl.Action.Drop,
          },
          {
            name: "easyplane-outbound",
            chainType: acl.ChainType.Outbound,
            enabled: true,
            defaultAction: acl.Action.Allow,
            rules: [],
          },
        ],
        group: {
          declares: [{ groupName: "tag:db", groupSecret: "secret-for-tag:db" }],
          members: ["tag:db"],
        },
      },
    });
  });
});

void NETWORK;
