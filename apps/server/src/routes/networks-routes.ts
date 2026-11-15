import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { devices } from "../db/schema.js";
import { requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import {
  createInviteResponseSchema,
  createInviteSchema,
  createNetworkPeerSchema,
  createNetworkSchema,
  inviteSchema,
  linkNetworkPeerSchema,
  networkPeersSchema,
  networkPeerSchema,
  networkSchema,
  okSchema,
  paramsInviteSchema,
  paramsNetworkSchema,
  paramsPeerSchema,
  patchNetworkSchema,
} from "../app/schemas.js";
import { requireAuth } from "../app/auth-hooks.js";
import { pushNetworkDevices } from "../services/push-service.js";

export function registerNetworkRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/networks",
    {
      schema: {
        operationId: "listNetworks",
        tags: ["networks"],
        response: { 200: z.array(networkSchema) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.networks.list(auth.organisation.id);
    },
  );

  typed.post(
    "/api/networks",
    {
      schema: {
        operationId: "createNetwork",
        tags: ["networks"],
        body: createNetworkSchema,
        response: { 201: networkSchema },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin"]);
      const network = await context.networks.create({
        orgId: auth.organisation.id,
        userId: auth.user.id,
        name: request.body.name,
        ipv4Cidr: request.body.ipv4Cidr,
        defaultConfig: request.body.defaultConfig,
      });
      return reply.code(201).send(network);
    },
  );

  typed.get(
    "/api/networks/:networkId",
    {
      schema: {
        operationId: "getNetwork",
        tags: ["networks"],
        params: paramsNetworkSchema,
        response: { 200: networkSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.networks.get(auth.organisation.id, request.params.networkId);
    },
  );

  typed.patch(
    "/api/networks/:networkId",
    {
      schema: {
        operationId: "updateNetwork",
        tags: ["networks"],
        params: paramsNetworkSchema,
        body: patchNetworkSchema,
        response: { 200: networkSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const before = await context.networks.requireNetwork(
        auth.organisation.id,
        request.params.networkId,
      );
      const network = await context.networks.update(
        auth.organisation.id,
        auth.user.id,
        request.params.networkId,
        request.body,
      );
      // MagicDNS is a network-level setting: flip it on every device.
      if (
        network.magicDnsEnabled !== before.magicDnsEnabled ||
        network.magicDnsZone !== before.magicDnsZone
      ) {
        await pushNetworkDevices(
          context.db,
          context.push,
          request.params.networkId,
          "magic dns updated",
        );
      }
      return network;
    },
  );

  typed.delete(
    "/api/networks/:networkId",
    {
      schema: {
        operationId: "deleteNetwork",
        tags: ["networks"],
        params: paramsNetworkSchema,
        response: { 200: okSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const affected = await context.db
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.networkId, request.params.networkId));
      for (const device of affected) {
        context.deviceSessions.get(device.id)?.close("network deleted");
      }
      await context.networks.delete(
        auth.organisation.id,
        auth.user.id,
        request.params.networkId,
      );
      return { status: "ok" as const };
    },
  );

  typed.post(
    "/api/networks/:networkId/secret/reveal",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        operationId: "revealNetworkSecret",
        tags: ["networks"],
        params: paramsNetworkSchema,
        response: { 200: z.object({ secret: z.string() }) },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const secret = await context.networks.revealSecret(
        auth.organisation.id,
        auth.user.id,
        request.params.networkId,
      );
      return { secret };
    },
  );

  typed.post(
    "/api/networks/:networkId/secret/rotate",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        operationId: "rotateNetworkSecret",
        tags: ["networks"],
        params: paramsNetworkSchema,
        response: { 200: z.object({ secret: z.string() }) },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const secret = await context.networks.regenerateSecret(
        auth.organisation.id,
        auth.user.id,
        request.params.networkId,
      );
      // Existing approved devices are re-pushed with the new secret.
      const approved = await context.db
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.networkId, request.params.networkId),
            eq(devices.state, "approved"),
          ),
        );
      for (const device of approved) {
        context.push.schedule(device.id, "network secret rotated");
      }
      return { secret };
    },
  );

  typed.get(
    "/api/networks/:networkId/peers",
    {
      schema: {
        operationId: "listNetworkPeers",
        tags: ["networks"],
        params: paramsNetworkSchema,
        response: { 200: networkPeersSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const peers = await context.networks.listPeers(
        auth.organisation.id,
        request.params.networkId,
      );
      return { peers };
    },
  );

  typed.post(
    "/api/networks/:networkId/peers",
    {
      schema: {
        operationId: "createNetworkPeer",
        tags: ["networks"],
        params: paramsNetworkSchema,
        body: createNetworkPeerSchema,
        response: { 201: networkPeerSchema },
      },
    },
    async (request, reply) => {
      // Peer entries are network topology: admins only, like the network row.
      const auth = requireRole(request, ["admin"]);
      const peer = await context.networks.addPeer(
        auth.organisation.id,
        auth.user.id,
        request.params.networkId,
        request.body,
      );
      await pushNetworkDevices(
        context.db,
        context.push,
        request.params.networkId,
        "network peer added",
      );
      return reply.code(201).send(peer);
    },
  );

  typed.post(
    "/api/networks/:networkId/peers/:peerId/link",
    {
      schema: {
        operationId: "linkNetworkPeer",
        tags: ["networks"],
        params: paramsPeerSchema,
        body: linkNetworkPeerSchema,
        response: { 200: networkPeerSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const peer = await context.networks.linkPeer(
        auth.organisation.id,
        auth.user.id,
        request.params.networkId,
        request.params.peerId,
        request.body.deviceId,
      );
      await pushNetworkDevices(
        context.db,
        context.push,
        request.params.networkId,
        "network peer linked",
      );
      return peer;
    },
  );

  typed.delete(
    "/api/networks/:networkId/peers/:peerId",
    {
      schema: {
        operationId: "deleteNetworkPeer",
        tags: ["networks"],
        params: paramsPeerSchema,
        response: { 200: okSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      await context.networks.removePeer(
        auth.organisation.id,
        auth.user.id,
        request.params.networkId,
        request.params.peerId,
      );
      await pushNetworkDevices(
        context.db,
        context.push,
        request.params.networkId,
        "network peer removed",
      );
      return { status: "ok" as const };
    },
  );

  typed.get(
    "/api/networks/:networkId/invites",
    {
      schema: {
        operationId: "listInvites",
        tags: ["invites"],
        params: paramsNetworkSchema,
        response: { 200: z.array(inviteSchema) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      await context.networks.requireNetwork(
        auth.organisation.id,
        request.params.networkId,
      );
      return context.invites.list(auth.organisation.id, request.params.networkId);
    },
  );

  typed.post(
    "/api/networks/:networkId/invites",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        operationId: "createInvite",
        tags: ["invites"],
        params: paramsNetworkSchema,
        body: createInviteSchema,
        response: { 201: createInviteResponseSchema },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin", "member"]);
      await context.networks.requireNetwork(
        auth.organisation.id,
        request.params.networkId,
      );
      const result = await context.invites.create({
        orgId: auth.organisation.id,
        networkId: request.params.networkId,
        userId: auth.user.id,
        label: request.body.label,
        expiresInHours: request.body.expiresInHours,
        maxUses: request.body.maxUses,
      });
      return reply.code(201).send(result);
    },
  );

  typed.delete(
    "/api/invites/:inviteId",
    {
      schema: {
        operationId: "revokeInvite",
        tags: ["invites"],
        params: paramsInviteSchema,
        response: { 200: inviteSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.invites.revoke(
        auth.organisation.id,
        auth.user.id,
        request.params.inviteId,
      );
    },
  );

  typed.get(
    "/api/organisation",
    {
      schema: {
        operationId: "getOrganisation",
        tags: ["users"],
        response: {
          200: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
        },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return auth.organisation;
    },
  );
}
