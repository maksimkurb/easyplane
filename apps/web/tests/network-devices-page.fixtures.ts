import type { GetNetwork200, ListDevices200Item } from "@/api/generated/model"

export type Device = ListDevices200Item
export type Network = GetNetwork200

const BASE_DEVICE = {
  networkId: "8a2f1b0e-0000-4000-8000-000000000010",
  networkName: "Home lab",
  state: "approved",
  online: "online",
  sync: "in-sync",
  label: "",
  machineId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  dnsName: "device",
  magicDnsName: null,
  magicDnsZone: "et.net",
  magicDnsEnabled: true,
  easytierVersion: "2.4.2",
  os: { type: "linux", distribution: "Debian", version: "12" },
  sourceIp: "198.51.100.7",
  virtualIpv4: "10.144.144.2",
  inviteId: null,
  ownerUserId: null,
  advertisedEndpoints: [],
  isHub: false,
  role: "member",
  effectiveRole: "member",
  knowsSecret: true,
  accessMode: "shared_secret",
  credential: null,
  tags: [],
  description: null,
  reportedState: {},
  reportedStateAt: null,
  desiredRevision: 1,
  appliedRevision: 1,
  policyVersion: 0,
  appliedAt: null,
  lastPushAt: null,
  lastPushError: null,
  lastSeenAt: new Date().toISOString(),
  approvedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  blockedAt: null,
  createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
}

export function makeDevice(
  overrides: Partial<Device> & { id: string; hostname: string; dnsName: string }
): Device {
  return { ...BASE_DEVICE, ...overrides } as unknown as Device
}

const BASE_NETWORK = {
  name: "Home lab",
  networkName: "homelab-7f3a91",
  ipv4Cidr: "10.144.144.0/24",
  defaultConfig: {},
  magicDnsEnabled: true,
  magicDnsZone: "et.net",
  policyVersion: 0,
  useRendezvous: false,
  p2pOnly: false,
  access: {
    mode: "shared_secret",
    anchors: 0,
    onlineAnchors: 0,
    members: 0,
    activeCredentials: 0,
    expiringCredentials: 0,
    warnings: [],
  },
  rendezvous: {
    configured: false,
    useBundled: false,
    secretMatches: null,
    endpoints: [],
    relayData: false,
    privateMode: false,
    networkName: null,
  },
  peerPlan: {
    hubEndpoints: 0,
    rawPeers: 0,
    rendezvousEndpoints: 0,
    hasPeerEndpoint: false,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deviceCounts: { approved: 3, pending: 1, blocked: 0 },
}

export function makeNetwork(overrides: Partial<Network> & { id: string }): Network {
  return { ...BASE_NETWORK, ...overrides } as unknown as Network
}
