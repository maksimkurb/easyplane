import { HttpResponse, http, sse } from "msw"

import type {
  CreateInvite201,
  GetCompiledAcl200,
  GetNetworkPolicy200,
} from "@/api/generated/model"
import {
  appConfig,
  me,
  networkById,
  networks,
  tags,
  users,
} from "../fixtures/networks"
import { deviceById, deviceRoutes, devices } from "../fixtures/devices"
import {
  compiledAcl,
  policy,
  policySubjects,
  policyVersions,
} from "../fixtures/access"
import {
  adoptableInstances,
  auditLog,
  deviceTopology,
  invites,
  magicDns,
  networkPeers,
  networkRoutes,
  officeTopology,
  revisions,
  topology,
} from "../fixtures/network"

/**
 * Every backend endpoint the story stories can reach. Handlers answer from
 * typed fixtures; no request leaves the browser (the catch-all at the bottom
 * makes sure of that and says which URL was missing).
 */
const emptyPolicy = (networkId: string): GetNetworkPolicy200 => ({
  version: 0,
  mode: "open",
  policy: null,
  document: null,
  rules: [],
  summary: null,
  deviceCount: networkId === "net-office-mesh" ? 5 : 0,
})

const emptyCompiledAcl = (deviceId: string): GetCompiledAcl200 => ({
  deviceId,
  hostname: deviceById.get(deviceId)?.hostname ?? "unknown",
  virtualIpv4: deviceById.get(deviceId)?.virtualIpv4 ?? null,
  enabled: false,
  policyVersion: 0,
  mode: "open",
  chains: [],
  group: { declares: [], members: [] },
  hash: "sha256:open",
})

const createdInvite = (): CreateInvite201 => {
  const invite = invites[0]!
  return {
    invite,
    token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpbnZpdGUiOiJpbnZpdGUtYWN0aXZlIn0.storybook-demo-token",
  }
}

const isHome = (networkId: string | undefined) => networkId !== "net-office-mesh"

export const handlers = [
  http.get("/api/auth/me", () => HttpResponse.json(me)),
  http.get("/api/config", () => HttpResponse.json(appConfig)),
  http.get("/api/organisation", () =>
    HttpResponse.json(me.organisation)
  ),
  http.get("/api/auth/providers", () => HttpResponse.json(me.providers)),
  http.get("/api/users", () => HttpResponse.json(users)),
  http.get("/api/rendezvous", () =>
    HttpResponse.json({
      configured: true,
      endpoints: ["wss://rdv.easytier.dev"],
      relayData: true,
      privateMode: false,
      networkName: "easytier-home-lab",
      secretComparisonAvailable: true,
    })
  ),

  http.get("/api/networks", () => HttpResponse.json(networks)),
  http.get("/api/networks/:networkId", ({ params }) => {
    const network = networkById.get(String(params.networkId))
    const body = network ?? networks[0]
    return HttpResponse.json(body)
  }),

  http.get("/api/devices", ({ request }) => {
    const url = new URL(request.url)
    const networkId = url.searchParams.get("networkId")
    const state = url.searchParams.get("state")
    const matches = devices.filter((device) => {
      if (networkId && device.networkId !== networkId) return false
      if (state && device.state !== state) return false
      return true
    })
    return HttpResponse.json(matches)
  }),
  http.get("/api/devices/:deviceId/revisions", ({ params }) => {
    const deviceId = String(params.deviceId)
    const device = deviceById.get(deviceId)
    if (!device) return HttpResponse.json({ error: "device not found" }, { status: 404 })
    return HttpResponse.json(isHome(device.networkId) ? revisions : [])
  }),
  http.get("/api/devices/:deviceId/routes", ({ params }) => {
    const deviceId = String(params.deviceId)
    return HttpResponse.json(deviceRoutes.filter((route) => route.deviceId === deviceId))
  }),
  http.get("/api/devices/:deviceId/topology", ({ params }) => {
    const deviceId = String(params.deviceId)
    return HttpResponse.json({ ...deviceTopology, deviceId })
  }),
  http.get("/api/devices/:deviceId/import/instances", ({ params }) => {
    const deviceId = String(params.deviceId)
    if (deviceId === "__none__") return HttpResponse.json([])
    return HttpResponse.json(adoptableInstances)
  }),
  http.get("/api/devices/:deviceId", ({ params }) => {
    const device = deviceById.get(String(params.deviceId))
    if (!device) {
      return HttpResponse.json({ error: "device not found", code: "not_found" }, { status: 404 })
    }
    return HttpResponse.json(device)
  }),

  http.get("/api/tags", () => HttpResponse.json(tags)),
  http.get("/api/user-groups", () => HttpResponse.json([])),

  http.get("/api/networks/:networkId/policy", ({ params }) =>
    HttpResponse.json(
      isHome(String(params.networkId)) ? policy : emptyPolicy(String(params.networkId))
    )
  ),
  http.get("/api/networks/:networkId/policy/subjects", ({ params }) =>
    HttpResponse.json(
      isHome(String(params.networkId))
        ? policySubjects
        : {
            devices: [],
            tags: [],
            userGroups: [],
            subnets: [],
            hosts: [],
          }
    )
  ),
  http.get("/api/networks/:networkId/policy/versions", ({ params }) =>
    HttpResponse.json(isHome(String(params.networkId)) ? policyVersions : [])
  ),
  http.get("/api/networks/:networkId/policy/compiled/:deviceId", ({ params }) =>
    HttpResponse.json(
      isHome(String(params.networkId))
        ? { ...compiledAcl, deviceId: String(params.deviceId) }
        : emptyCompiledAcl(String(params.deviceId))
    )
  ),

  http.get("/api/networks/:networkId/routes", ({ params }) =>
    HttpResponse.json(
      isHome(String(params.networkId))
        ? networkRoutes
        : { routes: [], reports: [] }
    )
  ),
  http.get("/api/networks/:networkId/peers", ({ params }) =>
    HttpResponse.json(
      isHome(String(params.networkId)) ? networkPeers : { peers: [] }
    )
  ),
  http.get("/api/networks/:networkId/dns", ({ params }) =>
    HttpResponse.json(
      isHome(String(params.networkId))
        ? magicDns
        : {
            enabled: false,
            zone: "office.easytier.",
            clientFlag: "--dns 100.64.0.1",
            defaultZone: "easytier.",
            names: [],
          }
    )
  ),
  http.get("/api/networks/:networkId/invites", ({ params }) =>
    HttpResponse.json(isHome(String(params.networkId)) ? invites : [])
  ),
  http.get("/api/networks/:networkId/topology", ({ params }) => {
    const networkId = String(params.networkId)
    return HttpResponse.json(isHome(networkId) ? topology : officeTopology)
  }),
  http.get("/api/networks/:networkId/export", () =>
    HttpResponse.text("[network_identity]\nnetwork_name = \"easytier-home-lab\"\n")
  ),

  http.get("/api/audit", () => HttpResponse.json(auditLog)),

  // The topology page opens its own authenticated event stream. Keep it open
  // with a hello event and no further traffic: stories must not wait on (or
  // reconnect against) a real SSE endpoint.
  sse<{ hello: unknown }>("/api/events", async ({ client }) => {
    client.send({
      event: "hello",
      data: {
        seq: 1,
        type: "hello",
        at: new Date().toISOString(),
        orgId: "org-easyplane",
        topics: [],
        data: {},
      },
    })
    await new Promise(() => undefined)
  }),

  // ------------------------------------------------------------------ mutations
  // Stories rarely submit, but a play function or an accidental click must not
  // reach a real backend. These answer with a plausible success envelope.
  http.post("/api/auth/logout", () => HttpResponse.json({ status: "ok" })),
  http.post("/api/networks/:networkId/invites", () => HttpResponse.json(createdInvite())),
  http.post("/api/devices/:deviceId/approve", ({ params }) => {
    const device = deviceById.get(String(params.deviceId)) ?? devices[0]!
    return HttpResponse.json({ ...device, state: "approved" })
  }),
  http.post("/api/devices/:deviceId/block", ({ params }) => {
    const device = deviceById.get(String(params.deviceId)) ?? devices[0]!
    return HttpResponse.json({ ...device, state: "blocked" })
  }),
  http.patch("/api/devices/:deviceId", () =>
    HttpResponse.json({ status: "ok" })
  ),
  http.put("/api/networks/:networkId/policy", () =>
    HttpResponse.json({ ...policy, version: policy.version + 1 })
  ),
  http.patch("/api/networks/:networkId/policy/mode", ({ request }) =>
    request.json().then((body) => HttpResponse.json({ ...policy, mode: (body as { mode?: string }).mode ?? "rules" }))
  ),
  http.post("/api/networks/:networkId/policy/validate", () =>
    HttpResponse.json({ valid: true, warnings: [] })
  ),
  http.post("/api/networks/:networkId/policy/test", () =>
    HttpResponse.json({ reachability: { allowed: true, decidedBy: "default" }, devices: [] })
  ),
  http.patch("/api/routes/:routeId/decision", ({ request }) =>
    request.json().then((body) => {
      const state = (body as { state?: string }).state ?? "approved"
      return HttpResponse.json({ ...networkRoutes.routes[0], state })
    })
  ),
  http.delete("/api/*", () => HttpResponse.json({ status: "ok" })),
  http.put("/api/*", () => HttpResponse.json({ status: "ok" })),
  http.patch("/api/*", () => HttpResponse.json({ status: "ok" })),
  http.post("/api/*", () => HttpResponse.json({ status: "ok" })),

  // ------------------------------------------------------------------- catch-all
  http.all("/api/*", ({ request }) => {
    const url = new URL(request.url)
    console.warn(
      `[storybook] Unhandled API request: ${request.method} ${url.pathname}${url.search}. ` +
        "Add a handler in apps/web/.storybook/mocks/handlers.ts (and a fixture) instead of relying on a real server."
    )
    return HttpResponse.json(
      {
        error: `Storybook has no fixture for ${request.method} ${url.pathname}`,
        code: "storybook_unhandled_request",
      },
      { status: 501 }
    )
  }),
  http.all("/health", () =>
    HttpResponse.json({ status: "ok", database: "ok" })
  ),
]
