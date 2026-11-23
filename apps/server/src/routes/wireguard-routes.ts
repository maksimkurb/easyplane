import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAuth, requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import {
  createWireguardClientSchema,
  okSchema,
  paramsDeviceSchema,
  paramsNetworkSchema,
  paramsWireguardClientSchema,
  renameWireguardClientSchema,
  wireguardClientSchema,
  wireguardClientTagsSchema,
  wireguardConfigSchema,
  wireguardPortalConfigSchema,
  wireguardPortalSchema,
  wireguardPortalSchemaResponse,
} from "../app/schemas.js";

/**
 * WireGuard portal API.
 *
 * Clients belong to a network and are served by one hub device. The config
 * endpoints are admin-only and never cached: the body contains the client's
 * WireGuard private key.
 */
export function registerWireguardRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/networks/:networkId/wireguard-clients",
    {
      schema: {
        operationId: "listWireguardClients",
        tags: ["devices"],
        params: paramsNetworkSchema,
        response: { 200: z.array(wireguardClientSchema) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.wireguard.list(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
      );
    },
  );

  typed.post(
    "/api/networks/:networkId/wireguard-clients",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        operationId: "createWireguardClient",
        tags: ["devices"],
        params: paramsNetworkSchema,
        body: createWireguardClientSchema,
        response: { 201: wireguardClientSchema },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin", "member"]);
      const client = await context.wireguard.create(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
        request.body,
      );
      return reply.code(201).send(client);
    },
  );

  typed.get(
    "/api/wireguard-clients/:clientId",
    {
      schema: {
        operationId: "getWireguardClient",
        tags: ["devices"],
        params: paramsWireguardClientSchema,
        response: { 200: wireguardClientSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.wireguard.get(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.clientId,
      );
    },
  );

  typed.put(
    "/api/wireguard-clients/:clientId/name",
    {
      schema: {
        operationId: "renameWireguardClient",
        tags: ["devices"],
        params: paramsWireguardClientSchema,
        body: renameWireguardClientSchema,
        response: { 200: wireguardClientSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.wireguard.rename(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.clientId,
        request.body.name,
      );
    },
  );

  typed.put(
    "/api/wireguard-clients/:clientId/tags",
    {
      schema: {
        operationId: "setWireguardClientTags",
        tags: ["devices"],
        params: paramsWireguardClientSchema,
        body: wireguardClientTagsSchema,
        response: { 200: wireguardClientSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.wireguard.setTags(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.clientId,
        request.body.tags,
      );
    },
  );

  typed.delete(
    "/api/wireguard-clients/:clientId",
    {
      schema: {
        operationId: "deleteWireguardClient",
        tags: ["devices"],
        params: paramsWireguardClientSchema,
        response: { 200: okSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      await context.wireguard.remove(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.clientId,
      );
      return { status: "ok" as const };
    },
  );

  typed.get(
    "/api/wireguard-clients/:clientId/config",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        operationId: "getWireguardClientConfig",
        tags: ["devices"],
        params: paramsWireguardClientSchema,
        response: { 200: wireguardConfigSchema },
      },
    },
    async (request, reply) => {
      // Admin-only: the response is a credential (it embeds a private key).
      const auth = requireRole(request, ["admin"]);
      const result = await context.wireguard.clientConfig(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.clientId,
      );
      reply.header("cache-control", "no-store");
      return result;
    },
  );

  typed.get(
    "/api/wireguard-clients/:clientId/config/download",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        operationId: "downloadWireguardClientConfig",
        tags: ["devices"],
        params: paramsWireguardClientSchema,
        response: { 200: z.string() },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin"]);
      const result = await context.wireguard.clientConfig(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.clientId,
      );
      const filename = result.filename.replace(/[^a-z0-9._-]+/gi, "-");
      reply.header("cache-control", "no-store");
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      return reply.type("text/plain; charset=utf-8").send(result.config);
    },
  );

  typed.get(
    "/api/devices/:deviceId/wireguard-portal/config",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        operationId: "getDeviceWireguardPortalConfig",
        tags: ["devices"],
        params: paramsDeviceSchema,
        response: { 200: wireguardPortalConfigSchema },
      },
    },
    async (request, reply) => {
      // Admin-only: the legacy shared config embeds a private key too.
      const auth = requireRole(request, ["admin"]);
      const result = await context.wireguard.legacyPortalConfig(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
      );
      reply.header("cache-control", "no-store");
      return result;
    },
  );

  typed.get(
    "/api/devices/:deviceId/wireguard-portal/config/download",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        operationId: "downloadDeviceWireguardPortalConfig",
        tags: ["devices"],
        params: paramsDeviceSchema,
        response: { 200: z.string() },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin"]);
      const result = await context.wireguard.legacyPortalConfig(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
      );
      const filename = result.filename.replace(/[^a-z0-9._-]+/gi, "-");
      reply.header("cache-control", "no-store");
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      return reply.type("text/plain; charset=utf-8").send(result.config);
    },
  );

  typed.put(
    "/api/devices/:deviceId/wireguard-portal",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        operationId: "updateDeviceWireguardPortal",
        tags: ["devices"],
        params: paramsDeviceSchema,
        body: wireguardPortalSchema,
        response: { 200: wireguardPortalSchemaResponse },
      },
    },
    async (request) => {
      // Enabling the portal opens a UDP port; disabling it changes whether
      // existing clients can connect. Admin-only, like the hub settings.
      const auth = requireRole(request, ["admin"]);
      return context.wireguard.updatePortal(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
        request.body,
      );
    },
  );
}
