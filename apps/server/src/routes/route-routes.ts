import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAuth, requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import {
  decideRouteSchema,
  deviceRouteSchema,
  paramsDeviceSchema,
  paramsNetworkSchema,
  paramsRouteSchema,
  requestRouteSchema,
  routeListSchema,
} from "../app/schemas.js";

/**
 * Subnet/exit-node approval API.
 *
 * Requests: member or admin (a device cannot call the API itself, so its owner
 * asks on its behalf). Decisions: admin only. Only approved rows reach the
 * pushed config.
 */
export function registerRouteRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/networks/:networkId/routes",
    {
      schema: {
        operationId: "listNetworkRoutes",
        tags: ["routes"],
        params: paramsNetworkSchema,
        response: { 200: routeListSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.routes.listForNetwork(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
      );
    },
  );

  typed.get(
    "/api/devices/:deviceId/routes",
    {
      schema: {
        operationId: "listDeviceRoutes",
        tags: ["routes"],
        params: paramsDeviceSchema,
        response: { 200: z.array(deviceRouteSchema) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.routes.listForDevice(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
      );
    },
  );

  typed.post(
    "/api/devices/:deviceId/routes",
    {
      schema: {
        operationId: "requestDeviceRoute",
        tags: ["routes"],
        params: paramsDeviceSchema,
        body: requestRouteSchema,
        response: { 201: deviceRouteSchema },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin", "member"]);
      const route = await context.routes.request(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
        {
          kind: request.body.kind,
          ...(request.body.cidr ? { cidr: request.body.cidr } : {}),
          ...(request.body.note ? { note: request.body.note } : {}),
        },
      );
      return reply.code(201).send(route);
    },
  );

  typed.post(
    "/api/routes/:routeId/decision",
    {
      schema: {
        operationId: "decideDeviceRoute",
        tags: ["routes"],
        params: paramsRouteSchema,
        body: decideRouteSchema,
        response: { 200: deviceRouteSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      return context.routes.decide(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.routeId,
        {
          state: request.body.state,
          ...(request.body.note ? { note: request.body.note } : {}),
        },
      );
    },
  );
}
