import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAuth, requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import {
  approveDeviceSchema,
  createRevisionResponseSchema,
  createRevisionSchema,
  deviceSchema,
  deviceStateSchema,
  okSchema,
  paramsDeviceSchema,
  paramsRevisionSchema,
  pushResultSchema,
  revisionSchema,
  updateDeviceEndpointsSchema,
  updateDeviceHubSchema,
} from "../app/schemas.js";

const listQuerySchema = z.object({
  networkId: z.string().uuid().optional(),
  state: deviceStateSchema.optional(),
});

export function registerDeviceRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/devices",
    {
      schema: {
        operationId: "listDevices",
        tags: ["devices"],
        querystring: listQuerySchema,
        response: { 200: z.array(deviceSchema) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.devices.list(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        { networkId: request.query.networkId, state: request.query.state },
      );
    },
  );

  typed.get(
    "/api/devices/:deviceId",
    {
      schema: {
        operationId: "getDevice",
        tags: ["devices"],
        params: paramsDeviceSchema,
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.devices.get(
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
    "/api/devices/:deviceId/approve",
    {
      schema: {
        operationId: "approveDevice",
        tags: ["devices"],
        params: paramsDeviceSchema,
        body: approveDeviceSchema.optional(),
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.devices.approve(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
        request.body ?? {},
      );
    },
  );

  typed.post(
    "/api/devices/:deviceId/block",
    {
      schema: {
        operationId: "blockDevice",
        tags: ["devices"],
        params: paramsDeviceSchema,
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.devices.block(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
      );
    },
  );

  typed.delete(
    "/api/devices/:deviceId",
    {
      schema: {
        operationId: "deleteDevice",
        tags: ["devices"],
        params: paramsDeviceSchema,
        response: { 200: okSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      await context.devices.remove(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
      );
      return { status: "ok" as const };
    },
  );

  typed.post(
    "/api/devices/:deviceId/push",
    {
      schema: {
        operationId: "pushDeviceConfig",
        tags: ["devices"],
        params: paramsDeviceSchema,
        response: { 200: pushResultSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.devices.push(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
      );
    },
  );

  typed.put(
    "/api/devices/:deviceId/endpoints",
    {
      schema: {
        operationId: "updateDeviceEndpoints",
        tags: ["devices"],
        params: paramsDeviceSchema,
        body: updateDeviceEndpointsSchema,
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.devices.setAdvertisedEndpoints(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
        request.body.endpoints,
      );
    },
  );

  typed.put(
    "/api/devices/:deviceId/hub",
    {
      schema: {
        operationId: "updateDeviceHub",
        tags: ["devices"],
        params: paramsDeviceSchema,
        body: updateDeviceHubSchema,
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      // The hub flag adds/removes a network peer entry, so it is admin-only.
      const auth = requireRole(request, ["admin"]);
      return context.devices.setHub(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
        request.body.isHub,
      );
    },
  );

  typed.get(
    "/api/devices/:deviceId/revisions",
    {
      schema: {
        operationId: "listDeviceRevisions",
        tags: ["config"],
        params: paramsDeviceSchema,
        response: { 200: z.array(revisionSchema) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.devices.listRevisions(
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
    "/api/devices/:deviceId/revisions",
    {
      schema: {
        operationId: "createDeviceRevision",
        tags: ["config"],
        params: paramsDeviceSchema,
        body: createRevisionSchema,
        response: { 201: createRevisionResponseSchema },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin", "member"]);
      const result = await context.devices.createRevision(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
        request.body,
      );
      return reply.code(201).send(result);
    },
  );

  typed.post(
    "/api/devices/:deviceId/revisions/:revision/rollback",
    {
      schema: {
        operationId: "rollbackDeviceRevision",
        tags: ["config"],
        params: paramsRevisionSchema,
        response: { 201: createRevisionResponseSchema },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin", "member"]);
      const result = await context.devices.rollback(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
        request.params.revision,
      );
      return reply.code(201).send(result);
    },
  );
}
