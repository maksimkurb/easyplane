import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

import { acl, manage } from "@easyplane/proto";
import { describe, expect, it } from "vitest";

import {
  NETWORK_CONFIG_FIELD_NUMBERS,
  aclFromPbjson,
  aclToPbjson,
  decodeShareLink,
  describeNetworkConfig,
  emptyNetworkConfig,
  networkConfigToShareLink,
  networkConfigToToml,
  toPbjson,
  tomlToNetworkConfig,
} from "@easyplane/server";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

/** The full example from easytier-core/src/config/toml.rs tests. */
const UPSTREAM_TOML = `
instance_name = "default"
instance_id = "87ede5a2-9c3d-492d-9bbe-989b9d07e742"
ipv4 = "10.144.144.10"
listeners = [ "tcp://0.0.0.0:11010", "udp://0.0.0.0:11010" ]
routes = [ "192.168.0.0/16" ]
rpc_portal = "0.0.0.0:15888"

[network_identity]
network_name = "default"
network_secret = "s3cr3t-network-secret"

[[peer]]
uri = "tcp://public.kkrainbow.top:11010"

[[peer]]
uri = "udp://192.168.94.33:11010"

[[proxy_network]]
cidr = "10.147.223.0/24"
allow = ["tcp", "udp", "icmp"]

[[proxy_network]]
cidr = "10.1.1.0/24"
mapped_cidr = "192.168.1.0/24"
allow = ["tcp", "icmp"]

[[port_forward]]
bind_addr = "0.0.0.0:11011"
dst_addr = "192.168.94.33:11011"
proto = "tcp"

[flags]
no_tun = true
accept_dns = true
mtu = 1300
disable_p2p = true
relay_network_whitelist = "net-a net-b"
`;

describe("NetworkConfig pbjson field mapping", () => {
  it("matches the pinned api_manage.proto field numbers exactly", () => {
    const proto = readFileSync(
      resolve(REPO_ROOT, "proto/easytier/api_manage.proto"),
      "utf8",
    );
    const body = proto.split("message NetworkConfig {")[1]?.split("\n}")[0];
    expect(body).toBeTruthy();
    const parsed: Record<string, number> = {};
    const pattern = /^\s*(?:optional\s+|repeated\s+)?[\w.]+\s+(\w+)\s*=\s*(\d+)/gm;
    for (const match of body!.matchAll(pattern)) {
      parsed[match[1]!] = Number(match[2]);
    }
    expect(parsed).toEqual(NETWORK_CONFIG_FIELD_NUMBERS);
  });

  it("serialises enums by name, 64-bit integers as strings and omits unset fields", () => {
    const config: manage.NetworkConfig = {
      ...emptyNetworkConfig(),
      networkName: "alpha",
      networkingMethod: manage.NetworkingMethod.Manual,
      instanceRecvBpsLimit: 123456789012345n,
      enableMagicDns: true,
    };
    const json = toPbjson(config);
    expect(json.network_name).toBe("alpha");
    expect(json.networking_method).toBe("Manual");
    expect(json.instance_recv_bps_limit).toBe("123456789012345");
    expect(json.enable_magic_dns).toBe(true);
    expect(json).not.toHaveProperty("network_secret");
    expect(json).not.toHaveProperty("peer_urls");
  });

  it("round-trips a nested ACL through the pbjson shape", () => {
    const value: acl.Acl = {
      aclV1: {
        chains: [
          {
            name: "inbound",
            chainType: acl.ChainType.Inbound,
            description: "",
            enabled: true,
            defaultAction: acl.Action.Drop,
            rules: [
              {
                name: "allow-web",
                description: "",
                priority: 1000,
                enabled: true,
                protocol: acl.Protocol.TCP,
                ports: ["443"],
                sourceIps: ["10.0.0.0/24"],
                destinationIps: [],
                sourcePorts: [],
                action: acl.Action.Allow,
                rateLimit: 0,
                burstLimit: 0,
                stateful: true,
                sourceGroups: ["tag:server"],
                destinationGroups: [],
              },
            ],
          },
        ],
        group: {
          declares: [{ groupName: "tag:server", groupSecret: "abc" }],
          members: ["tag:server"],
        },
      },
    };
    const json = aclToPbjson(value);
    expect(json).toMatchObject({
      acl_v1: {
        chains: [
          {
            name: "inbound",
            chain_type: "Inbound",
            default_action: "Drop",
            rules: [{ protocol: "TCP", action: "Allow" }],
          },
        ],
      },
    });
    expect(aclFromPbjson(json)).toMatchObject(value);
  });
});

describe("EasyTier TOML <-> NetworkConfig", () => {
  it("parses the upstream full example and keeps the secret", () => {
    const parsed = tomlToNetworkConfig(UPSTREAM_TOML);
    expect(parsed.secretPresent).toBe(true);
    expect(parsed.credentialMode).toBe(false);
    expect(parsed.config).toMatchObject({
      networkName: "default",
      networkSecret: "s3cr3t-network-secret",
      virtualIpv4: "10.144.144.10",
      networkLength: 24,
      networkingMethod: manage.NetworkingMethod.Manual,
      noTun: true,
      enableMagicDns: true,
      mtu: 1300,
      disableP2p: true,
      listenerUrls: ["tcp://0.0.0.0:11010", "udp://0.0.0.0:11010"],
      peerUrls: ["tcp://public.kkrainbow.top:11010", "udp://192.168.94.33:11010"],
      routes: ["192.168.0.0/16"],
      enableManualRoutes: true,
      enableRelayNetworkWhitelist: true,
      relayNetworkWhitelist: ["net-a", "net-b"],
      proxyCidrs: ["10.147.223.0/24", "10.1.1.0/24->192.168.1.0/24"],
    });
    expect(parsed.config.portForwards).toEqual([
      {
        bindIp: "0.0.0.0",
        bindPort: 11011,
        dstIp: "192.168.94.33",
        dstPort: 11011,
        proto: "tcp",
      },
    ]);
    expect(parsed.unsupported).toContain("proxy CIDRs (managed by EasyPlane route approvals)");
    expect(parsed.warnings.join("\n")).toContain("rpc_portal");
    expect(parsed.warnings.join("\n")).toContain("allow is not supported");
  });

  it("exports TOML that parses back to an equivalent config", () => {
    const original = tomlToNetworkConfig(UPSTREAM_TOML).config;
    const toml = networkConfigToToml(original);
    const reparsed = tomlToNetworkConfig(toml);
    expect(reparsed.secretPresent).toBe(true);
    const left = { ...original, instanceId: undefined };
    const right = { ...reparsed.config, instanceId: undefined };
    // EasyTier drops `allow` from proxy_network entries and ACKs legacy fields;
    // everything NetworkConfig can express must survive.
    expect(right).toMatchObject({
      networkName: left.networkName,
      networkSecret: left.networkSecret,
      virtualIpv4: left.virtualIpv4,
      networkLength: left.networkLength,
      noTun: left.noTun,
      enableMagicDns: left.enableMagicDns,
      mtu: left.mtu,
      disableP2p: left.disableP2p,
      listenerUrls: left.listenerUrls,
      peerUrls: left.peerUrls,
      routes: left.routes,
      proxyCidrs: left.proxyCidrs,
      portForwards: left.portForwards,
    });
  });

  it("round-trips an ACL through TOML", () => {
    const parsed = tomlToNetworkConfig(`
[network_identity]
network_name = "acl-net"
network_secret = "sec"
[acl.acl_v1]
[[acl.acl_v1.chains]]
name = "inbound"
chain_type = "Inbound"
default_action = "Drop"
enabled = true
[[acl.acl_v1.chains.rules]]
name = "allow-web"
protocol = "TCP"
ports = ["443"]
action = "Allow"
priority = 1000
enabled = true
stateful = true
source_groups = ["tag:server"]
`);
    expect(parsed.config.acl?.aclV1?.chains?.[0]?.defaultAction).toBe(
      acl.Action.Drop,
    );
    const toml = networkConfigToToml(parsed.config);
    const again = tomlToNetworkConfig(toml);
    expect(again.config.acl).toMatchObject(parsed.config.acl!);
  });

  it("rejects TOML without a network identity", () => {
    expect(() => tomlToNetworkConfig('ipv4 = "10.0.0.2/24"')).toThrow(
      /network_identity/,
    );
  });

  it("detects credential-mode configs", () => {
    const parsed = tomlToNetworkConfig(`
[network_identity]
network_name = "credential-net"
[secure_mode]
enabled = true
local_private_key = "cHJpdmF0ZQ=="
local_public_key = "cHVibGlj"
`);
    expect(parsed.secretPresent).toBe(true);
    expect(parsed.credentialMode).toBe(true);
    expect(parsed.unsupported).toContain(
      "credential-mode network (secure_mode.local_private_key)",
    );
  });

  it("accepts an empty network_secret (open network)", () => {
    const parsed = tomlToNetworkConfig(`
[network_identity]
network_name = "open"
network_secret = ""
`);
    expect(parsed.secretPresent).toBe(false);
    expect(parsed.config.networkSecret).toBe("");
  });
});

describe("share link <-> NetworkConfig", () => {
  const config: manage.NetworkConfig = {
    ...emptyNetworkConfig(),
    instanceId: undefined,
    networkName: "shared-net",
    networkSecret: "shared-secret",
    networkingMethod: manage.NetworkingMethod.Manual,
    dhcp: false,
    virtualIpv4: "10.50.0.10",
    networkLength: 20,
    hostname: "peer-a",
    peerUrls: ["tcp://relay.example.com:11010"],
    listenerUrls: ["tcp://0.0.0.0:11010"],
    proxyCidrs: ["192.168.50.0/24"],
    enableMagicDns: true,
    noTun: true,
    mtu: 1400,
    acl: {
      aclV1: {
        chains: [
          {
            name: "inbound",
            chainType: acl.ChainType.Inbound,
            description: "",
            enabled: true,
            rules: [],
            defaultAction: acl.Action.Drop,
          },
        ],
      },
    },
  };

  it("encodes a link shaped like the EasyTier GUI's comp_cfg link", () => {
    const link = networkConfigToShareLink(config, { displayName: "shared" });
    const url = new URL(link);
    expect(url.host).toBe("easytier.cn");
    expect(url.pathname).toBe("/comp_cfg");
    expect(url.searchParams.get("name")).toBe("shared");
    const raw = Buffer.from(url.searchParams.get("cfg")!, "base64url");
    // zlib header (deflate) — not raw deflate and not gzip.
    expect(raw[0]).toBe(0x78);
  });

  it("decodes a link produced by the GUI's field-number mapping", () => {
    // Hand-built exactly like share_link_service.rs: top-level keys are field
    // numbers, nested keys are snake_case pbjson.
    const payload = {
      2: false,
      6: "ui-net",
      7: "ui-secret",
      8: "Manual",
      3: "10.9.0.7",
      4: 24,
      10: ["tcp://peer.example.com:11010"],
      42: true,
      33: ["10.0.0.0/8"],
      32: true,
      55: { enabled: false },
    };
    const cfg = deflateSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64url",
    );
    const decoded = decodeShareLink(
      `https://easytier.cn/comp_cfg?cfg=${cfg}&name=ui`,
    );
    expect(decoded.displayName).toBe("ui");
    expect(decoded.config).toMatchObject({
      networkName: "ui-net",
      networkSecret: "ui-secret",
      networkingMethod: manage.NetworkingMethod.Manual,
      virtualIpv4: "10.9.0.7",
      networkLength: 24,
      enableMagicDns: true,
      routes: ["10.0.0.0/8"],
      enableManualRoutes: true,
    });
  });

  it("round-trips in both directions", () => {
    const { instanceId: _ignoredInstanceId, ...expected } = config;
    const link = networkConfigToShareLink(config);
    const decoded = decodeShareLink(link).config;
    expect(decoded).toMatchObject(expected);
    const linkAgain = networkConfigToShareLink(decoded);
    expect(decodeShareLink(linkAgain).config).toEqual(decoded);
  });

  it("accepts a raw base64url payload and rejects garbage", () => {
    const link = networkConfigToShareLink(config);
    const payload = new URL(link).searchParams.get("cfg")!;
    expect(decodeShareLink(payload).config.networkName).toBe("shared-net");
    expect(() => decodeShareLink("https://easytier.cn/comp_cfg?cfg=!!!")).toThrow();
    expect(() => decodeShareLink("https://easytier.cn/other?cfg=x")).toThrow(/path/);
  });
});

describe("import description never leaks the secret", () => {
  it("returns a secret-free summary", () => {
    const parsed = tomlToNetworkConfig(UPSTREAM_TOML);
    const described = describeNetworkConfig(parsed.config);
    expect(described.spec.networkName).toBe("default");
    expect(described.spec.ipv4Cidr).toBe("10.144.144.0/24");
    const serialised = JSON.stringify(described);
    expect(serialised).not.toContain("s3cr3t-network-secret");
    expect(described.unsupported).toContain("port forwarding");
    expect(described.unsupported.join("|")).toContain("proxy CIDRs");
  });

  it("derives a CIDR for a DHCP config and warns", () => {
    const parsed = tomlToNetworkConfig(`
[network_identity]
network_name = "dhcp-net"
network_secret = "s"
dhcp = true
[flags]
network_length = 24
`);
    // network_length lives in NetworkConfig, not flags; set it explicitly.
    parsed.config.networkLength = 16;
    const described = describeNetworkConfig(parsed.config);
    expect(described.spec.ipv4Cidr).toBe("10.144.0.0/16");
    expect(described.warnings.join(" ")).toContain("DHCP or unset");
  });
});
