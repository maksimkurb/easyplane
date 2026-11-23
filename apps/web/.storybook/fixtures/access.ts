import type {
  GetCompiledAcl200,
  GetNetworkPolicy200,
  GetPolicySubjects200,
  ListNetworkPolicyVersions200Item,
} from "@/api/generated/model"
import type {
  AccessChainName,
  AccessRule,
  AccessSubjects,
} from "@/lib/access-policy"
import { devices, homeDevices } from "./devices"
import { tags, users } from "./networks"

const at = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString()

const tagSubject = (name: string, deviceCount: number) => ({
  subject: `tag:${name}`,
  kind: "tag" as const,
  id: `tag-${name}`,
  name: `tag:${name}`,
  display: `tag:${name}`,
  deviceCount,
})

const groupSubject = (name: string, peopleCount: number, deviceCount: number) => ({
  subject: `group:${name}`,
  kind: "group" as const,
  id: `group-${name}`,
  name: `group:${name}`,
  display: `group:${name}`,
  peopleCount,
  deviceCount,
  readOnly: true,
  source: "oidc" as const,
})

const anySubject = {
  subject: "anyone",
  kind: "any" as const,
  id: "anyone",
  name: "anyone",
  display: "anyone",
  deviceCount: devices.length,
}

export const policy: GetNetworkPolicy200 = {
  version: 7,
  mode: "rules",
  policy: null,
  document: {
    version: 2,
    mode: "rules",
    chains: {
      inbound: { default: "block", enabled: true },
      outbound: { default: "allow", enabled: true },
      forward: { default: "block", enabled: true },
    },
  },
  rules: [
    {
      index: 0,
      name: "Admins may reach anything",
      enabled: true,
      action: "allow",
      protocol: "any",
      ports: [],
      sourcePorts: [],
      stateful: true,
      rateLimit: null,
      burst: null,
      from: [groupSubject("admins", 2, 9)],
      to: [anySubject],
      affectedDeviceCount: 9,
    },
    {
      index: 1,
      name: "Workstations reach the NAS over SMB and AFP",
      enabled: true,
      action: "allow",
      protocol: "tcp",
      ports: ["445", "548"],
      sourcePorts: [],
      stateful: true,
      rateLimit: null,
      burst: null,
      from: [tagSubject("work", 3)],
      to: [
        tagSubject("storage", 3),
        {
          subject: "host:nas",
          kind: "host",
          id: "host-nas",
          name: "host:nas",
          display: "host:nas",
          detail: "192.168.50.10",
          deviceCount: 1,
        },
      ],
      affectedDeviceCount: 3,
    },
    {
      index: 2,
      name: "Block family devices from infrastructure management ports",
      enabled: true,
      action: "deny",
      protocol: "tcp",
      ports: ["22", "5900", "8080"],
      sourcePorts: [],
      stateful: false,
      rateLimit: null,
      burst: null,
      from: [tagSubject("family", 2)],
      to: [tagSubject("infra", 4)],
      affectedDeviceCount: 2,
    },
    {
      index: 3,
      name: "Build farm reaches every internal subnet through a long allow list",
      enabled: true,
      action: "allow",
      protocol: "tcp",
      ports: ["443", "8080", "8443", "9418", "3000", "5000"],
      sourcePorts: ["1024-65535"],
      stateful: true,
      rateLimit: 5000,
      burst: 10000,
      from: [tagSubject("infra", 4)],
      to: [
        {
          subject: "cidr:10.42.1.0/24",
          kind: "cidr",
          id: "cidr-1",
          name: "cidr:10.42.1.0/24",
          display: "10.42.1.0/24",
          detail: "Docker bridge network",
          deviceCount: 0,
        },
        {
          subject: "cidr:10.42.2.0/24",
          kind: "cidr",
          id: "cidr-2",
          name: "cidr:10.42.2.0/24",
          display: "10.42.2.0/24",
          detail: "Kubernetes pods",
          deviceCount: 0,
        },
        {
          subject: "cidr:10.42.3.0/24",
          kind: "cidr",
          id: "cidr-3",
          name: "cidr:10.42.3.0/24",
          display: "10.42.3.0/24",
          detail: "Storage replication",
          deviceCount: 0,
        },
        {
          subject: "cidr:10.42.4.0/24",
          kind: "cidr",
          id: "cidr-4",
          name: "cidr:10.42.4.0/24",
          display: "10.42.4.0/24",
          detail: "Camera VLAN",
          deviceCount: 0,
        },
        {
          subject: "subnet:office",
          kind: "subnet",
          id: "subnet-office",
          name: "subnet:office",
          display: "subnet:office",
          detail: "172.20.0.0/16 via freebsd-fw",
          deviceCount: 5,
        },
      ],
      affectedDeviceCount: 4,
    },
    {
      index: 4,
      name: "Rate-limited SSH from the family VLAN (disabled while testing)",
      enabled: false,
      action: "allow",
      protocol: "tcp",
      ports: ["22"],
      sourcePorts: [],
      stateful: true,
      rateLimit: 10,
      burst: 20,
      from: [tagSubject("family", 2)],
      to: [tagSubject("infra", 4)],
      affectedDeviceCount: 2,
    },
  ],
  summary: {
    statements: 5,
    tags: ["tag:work", "tag:storage", "tag:family", "tag:infra"],
    groups: ["group:admins"],
    hosts: ["host:nas"],
    subnets: ["subnet:office"],
    strictTags: true,
    strictGroups: false,
    mode: "rules",
    chains: {
      inbound: { default: "block", enabled: true },
      outbound: { default: "allow", enabled: true },
      forward: { default: "block", enabled: true },
    },
  },
  deviceCount: homeDevices.length,
}

export const policySubjects: GetPolicySubjects200 = {
  devices: homeDevices.map((device) => ({
    id: device.id,
    name: device.dnsName ?? device.hostname,
    hostname: device.hostname,
    virtualIpv4: device.virtualIpv4,
    state: device.state,
    tags: device.tags,
  })),
  tags: tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    subject: tag.subject,
    color: tag.color,
    deviceCount: tag.deviceCount,
    devices: tag.devices,
  })),
  userGroups: [
    {
      id: "group-admins",
      name: "group:admins",
      subject: "group:admins",
      source: "oidc",
      readOnly: true,
      color: "indigo",
      members: users.slice(0, 2).map((user) => ({
        email: user.email,
        displayName: user.displayName || null,
        inOrganisation: true,
      })),
      peopleCount: 2,
      deviceCount: 9,
      devices: homeDevices
        .slice(0, 4)
        .map((device) => ({ id: device.id, name: device.hostname })),
    },
    {
      id: "group-design",
      name: "group:design",
      subject: "group:design",
      source: "manual",
      readOnly: false,
      color: "rose",
      members: [
        { email: "anna@example.com", displayName: "Anna Petrova", inOrganisation: true },
      ],
      peopleCount: 1,
      deviceCount: 2,
      devices: [],
    },
  ],
  subnets: [
    {
      id: "subnet-office",
      name: "subnet:office",
      display: "subnet:office",
      cidr: "172.20.0.0/16",
      viaDeviceId: "dev-freebsd-fw",
      viaHostname: "freebsd-fw",
      routeId: "route-office",
      approved: true,
    },
    {
      id: "subnet-iot",
      name: "subnet:iot",
      display: "subnet:iot",
      cidr: "192.168.60.0/24",
      viaDeviceId: "dev-nas-01",
      viaHostname: "nas-01",
      routeId: null,
      approved: false,
    },
  ],
  hosts: [
    { alias: "nas", subject: "host:nas", value: "192.168.50.10" },
    { alias: "printer", subject: "host:printer", value: "192.168.50.20" },
  ],
}

const compiledRule = (
  priority: number,
  name: string,
  action: "Allow" | "Drop",
  sourceIps: string[],
  destinationIps: string[],
  ports: string[] = []
) => ({
  name,
  description: `${action === "Allow" ? "accept" : "drop"} ${name}`,
  priority,
  enabled: true,
  protocol: "tcp",
  ports,
  sourceIps,
  destinationIps,
  sourcePorts: [],
  action,
  rateLimit: 0,
  burstLimit: 0,
  stateful: true,
  sourceGroups: [],
  destinationGroups: [],
})

export const compiledAcl: GetCompiledAcl200 = {
  deviceId: "dev-nas-01",
  hostname: "nas-01",
  virtualIpv4: "10.42.0.11",
  enabled: true,
  policyVersion: 7,
  mode: "rules",
  chains: [
    {
      name: "inbound",
      chainType: "Inbound",
      enabled: true,
      defaultAction: "Drop",
      rules: [
        compiledRule(
          100,
          "admins-any",
          "Allow",
          ["10.42.0.0/16"],
          ["10.42.0.11/32", "10.42.1.0/24", "10.42.2.0/24"]
        ),
        compiledRule(
          110,
          "work-to-storage",
          "Allow",
          ["10.42.0.12/32", "10.42.0.21/32", "10.42.0.22/32"],
          ["10.42.0.11/32"],
          ["445", "548"]
        ),
      ],
    },
    {
      name: "outbound",
      chainType: "Outbound",
      enabled: true,
      defaultAction: "Allow",
      rules: [],
    },
    {
      name: "forward",
      chainType: "Forward",
      enabled: true,
      defaultAction: "Drop",
      rules: [
        compiledRule(
          200,
          "infra-to-subnets",
          "Allow",
          ["10.42.0.0/16"],
          ["192.168.50.0/24", "192.168.60.0/24"],
          ["443", "8080"]
        ),
      ],
    },
  ],
  group: {
    declares: [
      { groupName: "tag:infra" },
      { groupName: "tag:storage" },
    ],
    members: ["nas-01", "edge-router", "rpi-sensor"],
  },
  hash: "sha256:8a1c5f0e91b2d4c6a7f03e58d9b4012c3d5e6f70819a2b3c4d5e6f708192a3b4",
}

export const policyVersions: ListNetworkPolicyVersions200Item[] = [
  {
    id: "policy-v7",
    networkId: "net-home-lab",
    version: 7,
    document: { version: 2, mode: "rules" },
    note: "Tighten family → infra ports",
    createdBy: "user-1",
    createdAt: at(1),
    summary: policy.summary!,
  },
  {
    id: "policy-v6",
    networkId: "net-home-lab",
    version: 6,
    document: { version: 2, mode: "rules" },
    note: "Initial rules for the NAS",
    createdBy: "user-1",
    createdAt: at(14),
    summary: policy.summary!,
  },
]

/* ------------------------------------------------------------------ rule UI */


export const accessChains: Record<AccessChainName, { default: "allow" | "block"; enabled: boolean }> = {
  inbound: { default: "block", enabled: true },
  outbound: { default: "allow", enabled: true },
  forward: { default: "block", enabled: true },
}

export const accessRules: AccessRule[] = [
  {
    name: "Admins may reach anything",
    enabled: true,
    action: "allow",
    from: ["group:admins"],
    to: ["*"],
    protocol: "any",
    ports: [],
    sourcePorts: [],
    stateful: true,
  },
  {
    name: "Workstations reach the NAS over SMB and AFP",
    enabled: true,
    action: "allow",
    from: ["tag:work"],
    to: ["tag:storage", "host:nas"],
    protocol: "tcp",
    ports: ["445", "548"],
    sourcePorts: [],
    stateful: true,
  },
  {
    name: "Block family devices from infrastructure management ports",
    enabled: true,
    action: "deny",
    from: ["tag:family"],
    to: ["tag:infra"],
    protocol: "tcp",
    ports: ["22", "5900", "8080"],
    sourcePorts: [],
    stateful: false,
  },
  {
    name: "Build farm reaches every internal subnet and host through a deliberately long allow list",
    enabled: true,
    action: "allow",
    from: ["tag:infra"],
    to: [
      "cidr:10.42.1.0/24",
      "cidr:10.42.2.0/24",
      "cidr:10.42.3.0/24",
      "cidr:10.42.4.0/24",
      "subnet:office",
      "subnet:iot",
      "host:nas",
      "host:printer",
      "group:design",
      "tag:storage",
      "device:nas-01",
      "device:edge-router",
    ],
    protocol: "tcp",
    ports: ["443", "8080", "8443", "9418", "3000", "5000"],
    sourcePorts: ["1024-65535"],
    stateful: true,
    rateLimit: 5000,
    burst: 10000,
  },
  {
    name: "Rate-limited SSH from the family VLAN (disabled while testing)",
    enabled: false,
    action: "allow",
    from: ["tag:family"],
    to: ["tag:infra"],
    protocol: "tcp",
    ports: ["22"],
    sourcePorts: [],
    stateful: true,
    rateLimit: 10,
    burst: 20,
  },
]

export const accessSubjects: AccessSubjects = policySubjects
