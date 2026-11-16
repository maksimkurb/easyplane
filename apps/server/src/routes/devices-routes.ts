import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAuth, requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import {
  acknowledgeAnchorRiskSchema,
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
  setDeviceRoleResponseSchema,
  setDeviceRoleSchema,
  updateDeviceEndpointsSchema,
  updateDeviceHubSchema,
} from "../app/schemas.js";
import { pushNetworkDevices } from "../services/push-service.js";

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
        body: acknowledgeAnchorRiskSchema.optional(),
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
        { acknowledgeAnchorRisk: request.body?.acknowledgeAnchorRisk },
      );
    },
  );

  typed.post(
    "/api/devices/:deviceId/credential/renew",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        operationId: "renewDeviceCredential",
        tags: ["devices"],
        params: paramsDeviceSchema,
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      // Admin-only: a renewal changes the key a member runs with.
      const auth = requireRole(request, ["admin"]);
      return context.devices.renewCredential(
        { orgId: auth.organisation.id, userId: auth.user.id, role: auth.user.role },
        request.params.deviceId,
      );
    },
  );

  typed.post(
    "/api/devices/:deviceId/credential/revoke",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        operationId: "revokeDeviceCredential",
        tags: ["devices"],
        params: paramsDeviceSchema,
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      return context.devices.revokeCredential(
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
    "/api/devices/:deviceId/role",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        operationId: "setDeviceRole",
        tags: ["devices"],
        params: paramsDeviceSchema,
        body: setDeviceRoleSchema,
        response: { 200: setDeviceRoleResponseSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const device = await context.devices.requireDevice(
        auth.organisation.id,
        request.params.deviceId,
      );
      const result = await context.networks.setDeviceRole({
        orgId: auth.organisation.id,
        userId: auth.user.id,
        networkId: device.networkId,
        deviceId: device.id,
        role: request.body.role,
        acknowledge: request.body.acknowledge,
      });
      await pushNetworkDevices(
        context.db,
        context.push,
        device.networkId,
        "device role changed",
      );
      return {
        device: await context.devices.get(
          {
            orgId: auth.organisation.id,
            userId: auth.user.id,
            role: auth.user.role,
          },
          device.id,
        ),
        needsSecretRotation: result.needsSecretRotation,
      };
    },
  );

  typed.delete(
    "/api/devices/:deviceId",
    {
      schema: {
        operationId: "deleteDevice",
        tags: ["devices"],
        params: paramsDeviceSchema,
        body: acknowledgeAnchorRiskSchema.optional(),
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
        { acknowledgeAnchorRisk: request.body?.acknowledgeAnchorRisk },
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
