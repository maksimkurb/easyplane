import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAuth, requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import {
  createTagSchema,
  deviceSchema,
  deviceTagsSchema,
  dnsNameSchema,
  okSchema,
  paramsDeviceSchema,
  paramsNetworkSchema,
  renameDeviceSchema,
  tagSchema,
} from "../app/schemas.js";
import { DEFAULT_MAGIC_DNS_ZONE, normalizeDnsZone } from "../domain/magic-dns.js";
import { pushNetworkDevices } from "../services/push-service.js";
import { invalid } from "../services/errors.js";

/** MagicDNS names, device renames and tags (policy subjects). */
export function registerDnsRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/networks/:networkId/dns",
    {
      schema: {
        operationId: "listMagicDnsNames",
        tags: ["dns"],
        params: paramsNetworkSchema,
        response: {
          200: z.object({
            enabled: z.boolean(),
            zone: z.string(),
            /**
             * EasyTier keeps the DNS zone in local client flags, not in
             * NetworkConfig, so a client must be started with this flag.
             */
            clientFlag: z.string(),
            defaultZone: z.string(),
            names: z.array(dnsNameSchema),
          }),
        },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const network = await context.networks.requireNetwork(
        auth.organisation.id,
        request.params.networkId,
      );
      const names = await context.networks.resolvedNames(
        auth.organisation.id,
        request.params.networkId,
      );
      return {
        enabled: network.magicDnsEnabled,
        zone: network.magicDnsZone,
        clientFlag:
          network.magicDnsZone === DEFAULT_MAGIC_DNS_ZONE
            ? ""
            : `--tld-dns-zone ${network.magicDnsZone}`,
        defaultZone: DEFAULT_MAGIC_DNS_ZONE,
        names,
      };
    },
  );

  typed.put(
    "/api/devices/:deviceId/hostname",
    {
      schema: {
        operationId: "renameDevice",
        tags: ["dns"],
        params: paramsDeviceSchema,
        body: renameDeviceSchema,
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.devices.rename(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
        request.body.dnsName,
      );
    },
  );

  typed.get(
    "/api/tags",
    {
      schema: {
        operationId: "listTags",
        tags: ["policy"],
        response: { 200: z.array(tagSchema) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const tags = await context.db.query.tags.findMany({
        where: (table, { eq }) => eq(table.orgId, auth.organisation.id),
      });
      const links = await context.db.query.deviceTags.findMany();
      const counts = new Map<string, number>();
      for (const link of links) {
        counts.set(link.tagId, (counts.get(link.tagId) ?? 0) + 1);
      }
      return tags
        .map((tag) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          deviceCount: counts.get(tag.id) ?? 0,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    },
  );

  typed.post(
    "/api/tags",
    {
      schema: {
        operationId: "createTag",
        tags: ["policy"],
        body: createTagSchema,
        response: { 201: tagSchema },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin"]);
      const raw = request.body.name.trim();
      if (!/^tag:[a-z0-9][a-z0-9-]{0,62}$/i.test(raw)) {
        invalid('tag names must look like "tag:server" (letters, digits, dashes)');
      }
      const tag = await context.policies.createTag(
        { orgId: auth.organisation.id, userId: auth.user.id, role: auth.user.role },
        { name: raw.toLowerCase(), color: request.body.color },
      );
      return reply.code(201).send({ ...tag, deviceCount: 0 });
    },
  );

  typed.put(
    "/api/devices/:deviceId/tags",
    {
      schema: {
        operationId: "setDeviceTags",
        tags: ["policy"],
        params: paramsDeviceSchema,
        body: deviceTagsSchema,
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.devices.setTags(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
        request.body.tags.map((tag) => tag.toLowerCase()),
      );
    },
  );

  typed.put(
    "/api/devices/:deviceId/owner",
    {
      schema: {
        operationId: "setDeviceOwner",
        tags: ["policy"],
        params: paramsDeviceSchema,
        body: z.object({ userId: z.string().uuid().nullable() }).strict(),
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      return context.devices.setOwner(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.deviceId,
        request.body.userId,
      );
    },
  );

  typed.post(
    "/api/networks/:networkId/dns/zone/check",
    {
      schema: {
        operationId: "checkDnsZone",
        tags: ["dns"],
        params: paramsNetworkSchema,
        body: z.object({ zone: z.string().min(3).max(200) }).strict(),
        response: { 200: z.object({ zone: z.string(), valid: z.boolean(), error: z.string().nullable() }) },
      },
    },
    async (request) => {
      requireAuth(request);
      try {
        return { zone: normalizeDnsZone(request.body.zone), valid: true, error: null };
      } catch (error) {
        return {
          zone: request.body.zone,
          valid: false,
          error: error instanceof Error ? error.message : "invalid zone",
        };
      }
    },
  );

  typed.post(
    "/api/networks/:networkId/dns/repush",
    {
      schema: {
        operationId: "repushMagicDns",
        tags: ["dns"],
        params: paramsNetworkSchema,
        response: { 200: okSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      await context.networks.requireNetwork(auth.organisation.id, request.params.networkId);
      await pushNetworkDevices(
        context.db,
        context.push,
        request.params.networkId,
        "magic dns repush",
      );
      return { status: "ok" as const };
    },
  );
}
