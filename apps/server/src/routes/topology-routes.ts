import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { requireAuth } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import { paramsDeviceSchema, paramsNetworkSchema } from "../app/schemas.js";
import {
  deviceTopologySchema,
  networkTopologySchema,
  topologyRefreshQuerySchema,
} from "../app/topology-schemas.js";
import type { NetworkTopologySnapshot } from "../topology/derive.js";

/**
 * Topology read API.
 *
 * Collection is adaptive: `getOrCollect` returns the cached snapshot while it
 * is younger than the active interval and otherwise probes the devices. Both
 * routes are read-only, so every role (including viewer) may call them.
 */
export function registerTopologyRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/networks/:networkId/topology",
    {
      schema: {
        operationId: "getNetworkTopology",
        tags: ["topology"],
        params: paramsNetworkSchema,
        querystring: topologyRefreshQuerySchema,
        response: { 200: networkTopologySchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      // Enforces organisation ownership before any probe is scheduled.
      await context.networks.requireNetwork(
        auth.organisation.id,
        request.params.networkId,
      );
      const result =
        request.query.refresh === "1"
          ? await context.topology.collect(request.params.networkId, "api-refresh")
          : await context.topology.getOrCollect(request.params.networkId);
      return result.snapshot;
    },
  );

  typed.get(
    "/api/devices/:deviceId/topology",
    {
      schema: {
        operationId: "getDeviceTopology",
        tags: ["topology"],
        params: paramsDeviceSchema,
        querystring: topologyRefreshQuerySchema,
        response: { 200: deviceTopologySchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const device = await context.devices.get(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
      );
      const result =
        request.query.refresh === "1"
          ? await context.topology.collect(device.networkId, "api-refresh")
          : await context.topology.getOrCollect(device.networkId);
      const snapshot: NetworkTopologySnapshot = result.snapshot;
      const node =
        snapshot.nodes.find((entry) => entry.deviceId === device.id) ?? null;
      const observation =
        snapshot.observations.find((entry) => entry.deviceId === device.id) ??
        null;
      const links = node
        ? snapshot.links.filter(
            (link) => link.source === node.id || link.target === node.id,
          )
        : [];
      return {
        deviceId: device.id,
        networkId: device.networkId,
        collectedAt: snapshot.collectedAt,
        generation: snapshot.generation,
        node,
        observation,
        links,
      };
    },
  );
}
