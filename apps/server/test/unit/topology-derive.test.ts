import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { manage } from "@easyplane/proto";
import {
  deriveTopology,
  normalizeTunnelProtocol,
  type TopologyObserverInput,
} from "@easyplane/server";

/**
 * Derivation is tested against the exact protobuf bytes a real easytier-core
 * 2.6.4-81487c36 returned from `CollectNetworkInfo` in the M3 conformance run
 * (hub-and-spoke: core-a relays between core-b and core-c, which run with
 * disable_p2p). See test/conformance/m3.test.ts and the fixture header.
 */
interface Fixture {
  capturedWith: string;
  topology: string;
  instances: Record<
    string,
    { deviceId: string; virtualIpv4: string | null; base64: string }
  >;
}

const fixture = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../fixtures/easytier/collect-network-info-m3.json",
    ),
    "utf8",
  ),
) as Fixture;

function inputs(): TopologyObserverInput[] {
  return Object.entries(fixture.instances).map(([hostname, entry]) => {
    const decoded = manage.CollectNetworkInfoResponse.decode(
      Buffer.from(entry.base64, "base64"),
    );
    const info = Object.values(decoded.info?.map ?? {})[0];
    if (!info) throw new Error(`fixture ${hostname} has no instance`);
    return {
      deviceId: `device-${hostname}`,
      hostname,
      virtualIpv4: entry.virtualIpv4,
      online: true,
      info,
      collectedAt: Date.parse("2026-01-01T00:00:00Z"),
    };
  });
}

function build() {
  return deriveTopology(inputs(), {
    networkId: "net-fixture",
    collectedAt: Date.parse("2026-01-01T00:00:00Z"),
    intervalMs: 5_000,
  });
}

describe("topology derivation from a real CollectNetworkInfo fixture", () => {
  it("describes the fixture honestly", () => {
    expect(fixture.capturedWith).toContain("2.6.4-81487c36");
    expect(Object.keys(fixture.instances).sort()).toEqual([
      "core-a",
      "core-b",
      "core-c",
    ]);
  });

  it("decodes three managed nodes with real version, listener and NAT data", () => {
    const snapshot = build();
    expect(snapshot.stats.nodes).toBe(3);
    expect(snapshot.stats.managedNodes).toBe(3);
    expect(snapshot.stats.failedObservations).toBe(0);
    const a = snapshot.nodes.find((node) => node.hostname === "core-a")!;
    expect(a.managed).toBe(true);
    expect(a.online).toBe(true);
    expect(a.virtualIpv4).toBe("10.89.0.2");
    expect(a.version).toBe("2.6.4-81487c36");
    expect(a.listeners).toContain("tcp://0.0.0.0:11021");
    // STUN filled the local NAT type and public address list.
    expect(a.natType).not.toBe("Unknown");
    expect(a.publicIps.length).toBeGreaterThan(0);
    expect(a.peerId).toBeGreaterThan(0);
  });

  it("derives the direct links with tunnel protocol, latency and loss", () => {
    const snapshot = build();
    const a = snapshot.nodes.find((node) => node.hostname === "core-a")!;
    const b = snapshot.nodes.find((node) => node.hostname === "core-b")!;
    const ab = snapshot.links.find(
      (link) =>
        (link.source === a.id && link.target === b.id) ||
        (link.source === b.id && link.target === a.id),
    )!;
    expect(ab.kind).toBe("direct");
    expect(ab.via).toBeNull();
    expect(ab.cost).toBe(1);
    expect(ab.protocol).toBe("tcp");
    expect(ab.rawTunnelType).toBe("tcp");
    expect(ab.protocolIsFirstHop).toBe(false);
    expect(ab.observedBy).toHaveLength(2);
    expect(ab.latencyMs).not.toBeNull();
    expect(ab.lossPercent).not.toBeNull();
    expect(ab.direction).not.toBe("unknown");
    expect(ab.remoteAddr).toContain("tcp://");
    expect(ab.evidence.every((entry) => entry.kind === "direct")).toBe(true);
  });

  it("derives the relayed link from Route.cost/next_hop_peer_id", () => {
    const snapshot = build();
    const a = snapshot.nodes.find((node) => node.hostname === "core-a")!;
    const b = snapshot.nodes.find((node) => node.hostname === "core-b")!;
    const c = snapshot.nodes.find((node) => node.hostname === "core-c")!;
    const bc = snapshot.links.find(
      (link) =>
        (link.source === b.id && link.target === c.id) ||
        (link.source === c.id && link.target === b.id),
    )!;
    expect(bc.kind).toBe("relayed");
    expect(bc.via).toBe(a.id);
    expect(bc.viaHostname).toBe("core-a");
    expect(bc.cost).toBe(2);
    expect(bc.pathLatencyMs).toBeGreaterThan(0);
    // A relayed edge has no direct transport; the protocol shown is the first
    // hop's tunnel to the relay.
    expect(bc.protocol).toBe("tcp");
    expect(bc.protocolIsFirstHop).toBe(true);
    expect(bc.asymmetric).toBe(false);
    expect(bc.observedBy).toHaveLength(2);
    expect(snapshot.stats.directLinks).toBe(2);
    expect(snapshot.stats.relayedLinks).toBe(1);
  });

  it("marks the relay-capable node from observed relay usage", () => {
    const snapshot = build();
    const a = snapshot.nodes.find((node) => node.hostname === "core-a")!;
    const b = snapshot.nodes.find((node) => node.hostname === "core-b")!;
    const c = snapshot.nodes.find((node) => node.hostname === "core-c")!;
    expect(a.relayCapable).toBe(true);
    expect(a.relaysFor.sort()).toEqual([b.id, c.id].sort());
    expect(a.capabilityReasons).toContain("relaying-for:2");
    expect(b.relayCapable).toBe(false);
    expect(c.relayCapable).toBe(false);
    // Docker bridge NAT is not "open", so nothing is unconditionally reachable.
    expect(a.reachable).toBe(false);
    expect(snapshot.stats.hasReachableNode).toBe(false);
  });

  it("keeps the raw peer/route data for the device drawer", () => {
    const snapshot = build();
    const b = snapshot.observations.find((entry) => entry.hostname === "core-b")!;
    expect(b.error).toBeNull();
    expect(b.peerId).toBeGreaterThan(0);
    const relayed = b.routes.find((route) => route.hostname === "core-c")!;
    expect(relayed.cost).toBe(2);
    expect(relayed.nextHopPeerId).toBe(
      snapshot.observations.find((entry) => entry.hostname === "core-a")!.peerId,
    );
    expect(relayed.virtualIpv4).toBe("10.89.0.4");
    expect(b.peers.length).toBeGreaterThanOrEqual(1);
    const conn = b.peers[0]!;
    expect(conn.connId.length).toBeGreaterThan(0);
    expect(conn.rawTunnelType).toBe("tcp");
    expect(conn.isClient).toBe(true);
    expect(conn.remoteAddr).toContain("tcp://");
    expect(b.events.length).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic for the same input", () => {
    const first = build();
    const second = build();
    expect(second.nodes).toEqual(first.nodes);
    expect(second.links).toEqual(first.links);
  });

  it("keeps the node and link order when the probes arrive in another order", () => {
    const forward = build();
    const reversed = deriveTopology([...inputs()].reverse(), {
      networkId: "net-fixture",
      collectedAt: Date.parse("2026-01-01T00:00:00Z"),
      intervalMs: 5_000,
    });
    expect(reversed.nodes.map((node) => node.id)).toEqual(
      forward.nodes.map((node) => node.id),
    );
    expect(reversed.links.map((link) => link.id)).toEqual(
      forward.links.map((link) => link.id),
    );
  });
});

describe("tunnel protocol normalisation", () => {
  it.each([
    ["tcp", "tcp"],
    ["tcp6", "tcp"],
    ["udp", "udp"],
    ["udp6", "udp"],
    ["ws", "ws"],
    ["wss", "wss"],
    ["quic", "quic"],
    ["quic6", "quic"],
    ["wg", "wg"],
    ["txt-tcp", "tcp"],
    ["tcp://et.example:11010", "tcp"],
    ["faketcp", "other"],
    ["ring", "other"],
    ["", "other"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(normalizeTunnelProtocol(input).protocol).toBe(expected);
    expect(normalizeTunnelProtocol(input).raw).toBe(input);
  });
});
