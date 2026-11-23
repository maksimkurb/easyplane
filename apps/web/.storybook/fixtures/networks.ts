import type {
  GetAppConfig200,
  GetMe200,
  GetNetwork200,
  GetOrganisation200,
  ListNetworks200Item,
  ListTags200Item,
  ListUsers200Item,
} from "@/api/generated/model"
import { devices } from "./devices"

/**
 * One typed network fixture is used for both `/api/networks` (list) and
 * `/api/networks/:id` (detail); the generated shapes are identical.
 */
export type NetworkFixture = GetNetwork200 & ListNetworks200Item

const dev = (networkId: string) =>
  devices.filter((device) => device.networkId === networkId)

const counts = (networkId: string) => {
  const list = dev(networkId)
  return {
    pending: list.filter((device) => device.state === "pending").length,
    approved: list.filter((device) => device.state === "approved").length,
    blocked: list.filter((device) => device.state === "blocked").length,
  }
}

const HOME_DEVICES = dev("net-home-lab")
const OFFICE_DEVICES = dev("net-office-mesh")

export const networks: NetworkFixture[] = [
  {
    id: "net-home-lab",
    name: "home-lab",
    networkName: "easytier-home-lab",
    ipv4Cidr: "10.42.0.0/16",
    defaultConfig: {
      listeners: ["tcp://0.0.0.0:11010", "udp://0.0.0.0:11010"],
      rpc_portal: "127.0.0.1:0",
      enable_encryption: true,
    },
    magicDnsEnabled: true,
    magicDnsZone: "home.easytier.",
    policyVersion: 7,
    policyMode: "rules",
    useRendezvous: true,
    p2pOnly: false,
    access: {
      mode: "credentials",
      anchors: 2,
      onlineAnchors: 2,
      members: 8,
      activeCredentials: 8,
      expiringCredentials: 1,
      warnings: [],
    },
    rendezvous: {
      configured: true,
      useBundled: true,
      secretMatches: true,
      endpoints: ["wss://rdv.easytier.dev", "udp://rdv.easytier.dev:11011"],
      relayData: true,
      privateMode: false,
      networkName: "easytier-home-lab",
    },
    peerPlan: {
      hubEndpoints: 2,
      rawPeers: 1,
      rendezvousEndpoints: 2,
      hasPeerEndpoint: true,
    },
    createdAt: "2025-03-14T09:12:00.000Z",
    updatedAt: "2026-11-21T18:42:00.000Z",
    deviceCounts: counts("net-home-lab"),
  },
  {
    id: "net-office-mesh",
    name: "office-mesh",
    networkName: "easytier-office-mesh",
    ipv4Cidr: "172.20.0.0/16",
    defaultConfig: {
      listeners: ["tcp://0.0.0.0:11010"],
      enable_encryption: true,
    },
    magicDnsEnabled: true,
    magicDnsZone: "office.easytier.",
    policyVersion: 0,
    policyMode: "open",
    useRendezvous: false,
    p2pOnly: true,
    access: {
      mode: "shared_secret",
      anchors: 1,
      onlineAnchors: 1,
      members: 5,
      activeCredentials: 0,
      expiringCredentials: 0,
      warnings: ["only_one_anchor", "no_members"],
    },
    rendezvous: {
      configured: false,
      useBundled: false,
      secretMatches: null,
      endpoints: [],
      relayData: false,
      privateMode: true,
      networkName: null,
    },
    peerPlan: {
      hubEndpoints: 1,
      rawPeers: 2,
      rendezvousEndpoints: 0,
      hasPeerEndpoint: true,
    },
    createdAt: "2025-08-02T11:30:00.000Z",
    updatedAt: "2026-11-19T08:05:00.000Z",
    deviceCounts: counts("net-office-mesh"),
  },
]

export const networkById = new Map(networks.map((network) => [network.id, network]))
export const primaryNetwork = networks[0]!
export const secondaryNetwork = networks[1]!

export const homeNetworkDevices = HOME_DEVICES
export const officeNetworkDevices = OFFICE_DEVICES

export const tags: ListTags200Item[] = [
  {
    id: "tag-storage",
    name: "tag:storage",
    subject: "tag:storage",
    color: "teal",
    deviceCount: 3,
    devices: devices
      .filter((device) => device.tags.includes("tag:storage"))
      .map((device) => ({ id: device.id, name: device.dnsName ?? device.hostname, hostname: device.hostname })),
  },
  {
    id: "tag-infra",
    name: "tag:infra",
    subject: "tag:infra",
    color: "slate",
    deviceCount: 4,
    devices: devices
      .filter((device) => device.tags.includes("tag:infra"))
      .map((device) => ({ id: device.id, name: device.dnsName ?? device.hostname, hostname: device.hostname })),
  },
  {
    id: "tag-work",
    name: "tag:work",
    subject: "tag:work",
    color: "indigo",
    deviceCount: 3,
    devices: devices
      .filter((device) => device.tags.includes("tag:work"))
      .map((device) => ({ id: device.id, name: device.dnsName ?? device.hostname, hostname: device.hostname })),
  },
  {
    id: "tag-family",
    name: "tag:family",
    subject: "tag:family",
    color: "rose",
    deviceCount: 2,
    devices: devices
      .filter((device) => device.tags.includes("tag:family"))
      .map((device) => ({ id: device.id, name: device.dnsName ?? device.hostname, hostname: device.hostname })),
  },
]

export const users: ListUsers200Item[] = [
  {
    id: "user-1",
    email: "owner@example.com",
    displayName: "Maksim Owner",
    role: "admin",
    groups: ["group:admins"],
    bootstrap: true,
    lastLoginAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  },
  {
    id: "user-2",
    email: "anna@example.com",
    displayName: "Anna Petrova",
    role: "member",
    groups: ["group:design"],
    bootstrap: false,
    lastLoginAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  {
    id: "user-3",
    email: "ivan@example.com",
    displayName: "Ivan Sokolov",
    role: "viewer",
    groups: [],
    bootstrap: false,
    lastLoginAt: null,
  },
  {
    id: "user-4",
    email: "buildbot@example.com",
    displayName: "",
    role: "member",
    groups: ["group:ci"],
    bootstrap: false,
    lastLoginAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  },
]

export const organisation: GetOrganisation200 = {
  id: "org-easyplane",
  name: "EasyPlane Demo",
  slug: "easyplane-demo",
}

export const me: GetMe200 = {
  user: users[0]!,
  organisation,
  csrfToken: "storybook-csrf-token",
  providers: [{ id: "oidc", label: "Company SSO" }],
}

export const appConfig: GetAppConfig200 = {
  orgName: organisation.name,
  publicUrl: "https://panel.example.com",
  publicConfigServerUrl: "https://config.example.com",
  bootstrapAvailable: false,
  providers: [{ id: "oidc", label: "Company SSO", issuer: "https://sso.example.com" }],
}

/** A lower-privilege viewer, for stories that must hide admin actions. */
export const viewerMe: GetMe200 = {
  ...me,
  user: users[2]!,
}
