import { describe, expect, it } from "vitest";

import {
  compareTopologyLinks,
  compareTopologyNodes,
  deriveTopology,
  type TopologyObserverInput,
} from "@easyplane/server";

/**
 * Topology order must not depend on heartbeat state (`online`) or on the order
 * of the probes: the map re-renders on every collection and used to shuffle
 * rows whenever `online` flipped.
 */

type Node = Parameters<typeof compareTopologyNodes>[0];
type Link = Parameters<typeof compareTopologyLinks>[0];

function node(overrides: Partial<Node> & Pick<Node, "id">): Node {
  return {
    deviceId: null,
    hostname: "",
    virtualIpv4: null,
    networkLength: null,
    version: "",
    managed: false,
    online: false,
    peerId: null,
    natType: "Unknown",
    tcpNatType: "Unknown",
    natFriendly: false,
    publicIps: [],
    listeners: [],
    proxyCidrs: [],
    featureFlags: {
      isPublicServer: false,
      avoidRelayData: false,
      disableP2p: false,
      quicInput: false,
      kcpInput: false,
    },
    reachable: false,
    relayCapable: false,
    capabilityReasons: [],
    relaysFor: [],
    observed: false,
    ...overrides,
  } as Node;
}

function link(source: string, target: string, id?: string): Link {
  const [left, right] = source <= target ? [source, target] : [target, source];
  return {
    id: id ?? `${left}--${right}`,
    source: left,
    target: right,
    kind: "direct",
    via: null,
    viaHostname: null,
    protocol: "tcp",
    rawTunnelType: "tcp",
    latencyMs: null,
    lossPercent: null,
    cost: 1,
    pathLatencyMs: null,
    direction: "unknown",
    localAddr: null,
    remoteAddr: null,
    protocolIsFirstHop: false,
    asymmetric: false,
    observedBy: [],
    evidence: [],
  } as Link;
}

function labels(nodes: readonly Node[]): string[] {
  return nodes.map((entry) => entry.hostname || entry.id);
}

describe("compareTopologyNodes", () => {
  it("orders by hostname and then id, never by online or managed", () => {
    const nodes = [
      node({ id: "ip:3", hostname: "charlie", online: true, managed: true }),
      node({ id: "ip:2", hostname: "alpha", online: false, managed: false }),
      node({ id: "ip:1", hostname: "bravo", online: false, managed: true }),
    ];
    expect([...nodes].sort(compareTopologyNodes).map((entry) => entry.hostname)).toEqual([
      "alpha",
      "bravo",
      "charlie",
    ]);
  });

  it("breaks hostname ties by the node id", () => {
    const nodes = [
      node({ id: "ip:20", hostname: "same" }),
      node({ id: "ip:10", hostname: "same" }),
    ];
    expect([...nodes].sort(compareTopologyNodes).map((entry) => entry.id)).toEqual([
      "ip:10",
      "ip:20",
    ]);
  });

  it("falls back to the id when a node has no hostname", () => {
    const nodes = [
      node({ id: "peer:b/2" }),
      node({ id: "peer:a/1" }),
      node({ id: "peer:0", hostname: "alpha" }),
    ];
    expect([...nodes].sort(compareTopologyNodes).map((entry) => entry.id)).toEqual([
      "peer:0",
      "peer:a/1",
      "peer:b/2",
    ]);
  });

  it("is independent of the input order and of online flipping", () => {
    const base = [
      node({ id: "ip:1", hostname: "core-a", online: true, managed: true }),
      node({ id: "ip:2", hostname: "core-b", online: true, managed: true }),
      node({ id: "ip:3", hostname: "core-c", online: false, managed: false }),
    ];
    const expected = labels([...base].sort(compareTopologyNodes));

    const shuffled = [
      node({ id: "ip:3", hostname: "core-c", online: true, managed: true }),
      node({ id: "ip:1", hostname: "core-a", online: false, managed: false }),
      node({ id: "ip:2", hostname: "core-b", online: false, managed: true }),
    ];
    expect(labels([...shuffled].sort(compareTopologyNodes))).toEqual(expected);
  });
});

describe("compareTopologyLinks", () => {
  const names = new Map([
    ["ip:90", "alpha"],
    ["ip:91", "bravo"],
    ["ip:2", "charlie"],
    ["ip:3", "delta"],
  ]);
  const nameOf = (nodeId: string) => names.get(nodeId) ?? nodeId;

  it("orders links by the neighbour name, not by the raw node id", () => {
    const first = link("ip:90", "ip:91"); // alpha <-> bravo
    const second = link("ip:2", "ip:3"); // charlie <-> delta
    // The ids would put `ip:2--ip:3` first; the displayed names do not.
    expect([second, first].sort((left, right) => compareTopologyLinks(left, right, nameOf))).toEqual([
      first,
      second,
    ]);
  });

  it("does not depend on which endpoint reported the link", () => {
    const forward = link("ip:90", "ip:91", "a--b");
    const backward = link("ip:91", "ip:90", "a--b");
    expect(compareTopologyLinks(forward, backward, nameOf)).toBe(0);
  });

  it("orders a shared first endpoint by the second neighbour name", () => {
    const bravo = link("ip:90", "ip:91", "shared--bravo");
    const charlie = link("ip:90", "ip:2", "shared--charlie");
    expect(
      [charlie, bravo].sort((left, right) => compareTopologyLinks(left, right, nameOf)),
    ).toEqual([bravo, charlie]);
  });

  it("breaks equal endpoint names by the link id", () => {
    const first = link("ip:90", "ip:91", "aaa");
    const second = link("ip:90", "ip:91", "bbb");
    expect(
      [second, first].sort((left, right) => compareTopologyLinks(left, right, nameOf)),
    ).toEqual([first, second]);
  });
});

describe("deriveTopology ordering", () => {
  function inputs(): TopologyObserverInput[] {
    return [
      { deviceId: "device-1", hostname: "core-a", virtualIpv4: "10.0.0.1", online: true },
      { deviceId: "device-2", hostname: "core-b", virtualIpv4: "10.0.0.2", online: true },
      { deviceId: "device-3", hostname: "core-c", virtualIpv4: "10.0.0.3", online: false },
      { deviceId: "device-4", hostname: "core-d", virtualIpv4: "10.0.0.4", online: true },
    ];
  }

  const options = {
    networkId: "net-order",
    collectedAt: Date.parse("2026-01-01T00:00:00Z"),
    intervalMs: 5_000,
  };

  it("sorts managed nodes by name regardless of probe order", () => {
    const forward = deriveTopology(inputs(), options);
    const reversed = deriveTopology([...inputs()].reverse(), options);
    expect(forward.nodes.map((entry) => entry.hostname)).toEqual([
      "core-a",
      "core-b",
      "core-c",
      "core-d",
    ]);
    expect(reversed.nodes.map((entry) => entry.id)).toEqual(
      forward.nodes.map((entry) => entry.id),
    );
  });

  it("keeps the order when every device goes online or offline", () => {
    const online = deriveTopology(
      inputs().map((input) => ({ ...input, online: true })),
      options,
    );
    const offline = deriveTopology(
      inputs().map((input) => ({ ...input, online: false })),
      options,
    );
    expect(offline.nodes.map((entry) => entry.id)).toEqual(
      online.nodes.map((entry) => entry.id),
    );
  });

  it("is stable across repeated collections with the same input", () => {
    const first = deriveTopology(inputs(), options);
    const second = deriveTopology(inputs(), options);
    expect(second.nodes.map((entry) => entry.id)).toEqual(
      first.nodes.map((entry) => entry.id),
    );
    expect(second.links.map((entry) => entry.id)).toEqual(
      first.links.map((entry) => entry.id),
    );
  });
});
