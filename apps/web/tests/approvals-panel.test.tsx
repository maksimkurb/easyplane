import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type {
  ListDevices200Item,
  ListInvites200Item,
  ListNetworkRoutes200RoutesItem,
} from "@/api/generated/model"
import { ApprovalsPanel } from "@/components/network/approvals-panel"
import { renderWithProviders } from "./test-utils"

const NETWORK_ID = "8a2f1b0e-0000-4000-8000-000000000010"

const ADMIN = {
  user: {
    id: "u1",
    email: "admin@example.com",
    displayName: "Admin",
    role: "admin",
    groups: [],
    bootstrap: false,
    lastLoginAt: null,
  },
  organisation: { id: "org", name: "Acme", slug: "acme" },
  csrfToken: "csrf",
  providers: [],
}

const PENDING_DEVICE = {
  id: "d-pending",
  networkId: NETWORK_ID,
  networkName: "Home lab",
  state: "pending",
  online: "offline",
  sync: "not-applicable",
  label: "",
  machineId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  hostname: "pixel-8",
  dnsName: "pixel-8",
  magicDnsName: null,
  magicDnsZone: "et.net",
  magicDnsEnabled: true,
  easytierVersion: "2.4.2",
  os: { type: "android", distribution: "Android", version: "15" },
  sourceIp: "198.51.100.7",
  virtualIpv4: null,
  inviteId: "invite-1",
  ownerUserId: null,
  advertisedEndpoints: [],
  isHub: false,
  role: "member",
  effectiveRole: "member",
  knowsSecret: false,
  accessMode: "shared_secret",
  credential: null,
  tags: [],
  reportedState: {},
  reportedStateAt: null,
  desiredRevision: null,
  appliedRevision: null,
  policyVersion: 0,
  appliedAt: null,
  lastPushAt: null,
  lastPushError: null,
  lastSeenAt: null,
  approvedAt: null,
  blockedAt: null,
  createdAt: new Date(Date.now() - 120_000).toISOString(),
} as unknown as ListDevices200Item

const PENDING_ROUTE = {
  id: "route-pending",
  networkId: NETWORK_ID,
  deviceId: "d-rpi",
  deviceHostname: "rpi-garage",
  kind: "subnet",
  cidr: "192.168.50.0/24",
  state: "pending",
  note: "",
  requestedBy: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
} as unknown as ListNetworkRoutes200RoutesItem

const INVITES = [
  {
    id: "invite-1",
    networkId: NETWORK_ID,
    label: "Family phones",
    role: "member",
    createdAt: new Date().toISOString(),
    expiresAt: null,
    maxUses: 5,
    uses: 1,
    reusable: true,
    remainingUses: 4,
    status: "active",
    revokedAt: null,
    lastUsedAt: null,
  },
] as unknown as ListInvites200Item[]

function stubApi() {
  const calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const body = url.endsWith("/api/auth/me")
      ? ADMIN
      : url.endsWith("/api/config")
        ? {
            orgName: "Acme",
            publicUrl: null,
            publicConfigServerUrl: null,
            bootstrapAvailable: false,
            providers: [],
          }
        : {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return calls
}

describe("ApprovalsPanel", () => {
  it("lists pending devices and route requests with the invite label", async () => {
    stubApi()
    renderWithProviders(
      <ApprovalsPanel
        devices={[PENDING_DEVICE]}
        invites={INVITES}
        networkId={NETWORK_ID}
        routes={[PENDING_ROUTE]}
      />
    )

    expect(await screen.findByText("Needs your approval")).toBeInTheDocument()
    expect(await screen.findByText("pixel-8")).toBeInTheDocument()
    expect(screen.getByText("wants to join")).toBeInTheDocument()
    expect(screen.getByText(/invite “Family phones”/)).toBeInTheDocument()
    expect(screen.getByText("rpi-garage")).toBeInTheDocument()
    expect(screen.getByText("192.168.50.0/24")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2)
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(2)
  })

  it("posts the approve decision and the reject decision", async () => {
    const calls = stubApi()
    const user = userEvent.setup()
    renderWithProviders(
      <ApprovalsPanel
        devices={[PENDING_DEVICE]}
        invites={INVITES}
        networkId={NETWORK_ID}
        routes={[PENDING_ROUTE]}
      />
    )

    const [deviceApprove] = await screen.findAllByRole("button", { name: "Approve" })
    await user.click(deviceApprove!)
    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith("/api/devices/d-pending/approve"))).toBe(
        true
      )
    )

    const rejectButtons = screen.getAllByRole("button", { name: "Reject" })
    await user.click(rejectButtons[1]!)
    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith("/decision"))
      expect(call).toBeDefined()
      expect(JSON.parse(String(call?.init?.body))).toMatchObject({ state: "rejected" })
    })
  })
})
