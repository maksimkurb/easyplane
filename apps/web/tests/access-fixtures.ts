import type {
  GetNetworkPolicy200,
  GetPolicySubjects200,
  ListNetworkPolicyVersions200Item,
  ListUsers200Item,
} from "@/api/generated/model"
import type { AccessDocument } from "@/lib/access-policy"

export const NETWORK_ID = "8a2f1b0e-0000-4000-8000-000000000010"

export const USER: ListUsers200Item = {
  id: "u1",
  email: "maxim@home.example",
  displayName: "Maxim",
  role: "admin",
  groups: [],
  bootstrap: false,
  lastLoginAt: null,
}

export const SUBJECTS: GetPolicySubjects200 = {
  devices: [
    {
      id: "d-nas",
      name: "nas-01",
      hostname: "nas-01",
      virtualIpv4: "10.144.144.5",
      state: "approved",
      tags: ["home"],
    },
    {
      id: "d-vps",
      name: "vps-fra",
      hostname: "vps-fra",
      virtualIpv4: "10.144.144.7",
      state: "approved",
      tags: ["eu"],
    },
    {
      id: "d-router",
      name: "router-01",
      hostname: "router-01",
      virtualIpv4: "10.144.144.1",
      state: "approved",
      tags: ["home"],
    },
  ],
  tags: [
    {
      id: "t-home",
      name: "home",
      subject: "tag:home",
      color: "",
      deviceCount: 2,
      devices: [
        { id: "d-nas", name: "nas-01", hostname: "nas-01" },
        { id: "d-router", name: "router-01", hostname: "router-01" },
      ],
    },
    {
      id: "t-eu",
      name: "eu",
      subject: "tag:eu",
      color: "",
      deviceCount: 1,
      devices: [{ id: "d-vps", name: "vps-fra", hostname: "vps-fra" }],
    },
  ],
  userGroups: [
    {
      id: "g-admins",
      name: "Admins",
      subject: "group:Admins",
      source: "manual",
      readOnly: false,
      color: "",
      members: [
        { email: "maxim@home.example", displayName: "Maxim", inOrganisation: true },
      ],
      peopleCount: 1,
      deviceCount: 1,
      devices: [{ id: "d-vps", name: "vps-fra" }],
    },
    {
      id: "oidc:family",
      name: "family",
      subject: "group:family",
      source: "oidc",
      readOnly: true,
      color: "",
      members: [
        { email: "anna@home.example", displayName: null, inOrganisation: true },
      ],
      peopleCount: 1,
      deviceCount: 0,
      devices: [],
    },
  ],
  subnets: [
    {
      id: "home-lan",
      name: "Home LAN",
      display: "192.168.55.0/24 via router-01",
      cidr: "192.168.55.0/24",
      viaDeviceId: "d-router",
      viaHostname: "router-01",
      routeId: "r1",
      approved: true,
    },
  ],
  hosts: [{ alias: "printer", subject: "host:printer", value: "192.168.55.20" }],
}

export const DOCUMENT: AccessDocument = {
  version: 2,
  mode: "rules",
  subnets: { "home-lan": { cidr: "192.168.55.0/24", via: "router-01" } },
  tags: { home: ["nas-01", "router-01"], eu: ["vps-fra"] },
  userGroups: {
    Admins: { source: "manual", members: ["maxim@home.example"] },
  },
  tagOwners: {},
  hosts: { printer: "192.168.55.20" },
  chains: {
    inbound: { default: "block", enabled: true },
    outbound: { default: "allow", enabled: true },
    forward: { default: "block", enabled: true },
  },
  options: { strictTags: false, strictGroups: false },
  rules: [
    {
      name: "Block SSH to NAS",
      enabled: true,
      action: "deny",
      from: ["*"],
      to: ["device:nas-01"],
      protocol: "tcp",
      ports: ["22"],
      sourcePorts: [],
      stateful: true,
    },
    {
      name: "LAN to VPS",
      enabled: false,
      action: "allow",
      from: ["subnet:home-lan"],
      to: ["device:vps-fra"],
      protocol: "any",
      ports: [],
      sourcePorts: [],
      stateful: true,
    },
  ],
}

export const POLICY: GetNetworkPolicy200 = {
  version: 3,
  mode: "rules",
  policy: null,
  document: DOCUMENT as unknown as GetNetworkPolicy200["document"],
  rules: [],
  summary: null,
  deviceCount: 3,
}

export const VERSIONS: ListNetworkPolicyVersions200Item[] = [
  {
    id: "v3",
    networkId: NETWORK_ID,
    version: 3,
    document: DOCUMENT as unknown as ListNetworkPolicyVersions200Item["document"],
    note: "",
    createdBy: "u1",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    summary: {
      statements: 2,
      tags: ["home", "eu"],
      groups: ["Admins"],
      hosts: ["printer"],
      subnets: ["home-lan"],
      strictTags: false,
      strictGroups: false,
      mode: "rules",
      chains: {
        inbound: { default: "block", enabled: true },
        outbound: { default: "allow", enabled: true },
        forward: { default: "block", enabled: true },
      },
    },
  },
]
