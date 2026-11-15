import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import {
  networkSchema,
  paramsDeviceSchema,
  paramsNetworkSchema,
} from "../app/schemas.js";
import { buildNetworkExport } from "../import/export.js";

const importSourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("toml"),
      text: z.string().min(1).max(512 * 1024),
      name: z.string().min(1).max(120).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("shareLink"),
      link: z.string().min(1).max(64 * 1024),
      name: z.string().min(1).max(120).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("device"),
      deviceId: z.string().uuid(),
      instanceId: z.string().uuid().optional(),
      name: z.string().min(1).max(120).optional(),
    })
    .strict(),
]);

const previewBodySchema = z
  .object({
    source: importSourceSchema,
    existingNetworkId: z.string().uuid().optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .strict();

const commitBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    ipv4Cidr: z.string().min(8).max(32).optional(),
  })
  .strict();

const summarySchema = z.object({
  hostname: z.string().nullable(),
  networkingMethod: z.string(),
  dhcp: z.boolean(),
  virtualIpv4: z.string().nullable(),
  networkLength: z.number().int().nullable(),
  peerUrls: z.array(z.string()),
  listenerUrls: z.array(z.string()),
  routes: z.array(z.string()),
  proxyCidrs: z.array(z.string()),
  exitNodes: z.array(z.string()),
  portForwards: z.number().int(),
  aclChains: z.number().int(),
  magicDns: z.boolean(),
});

const diffEntrySchema = z.object({
  field: z.string(),
  current: z.string().nullable(),
  incoming: z.string().nullable(),
  changed: z.boolean(),
});

const previewSchema = z.object({
  draftId: z.string(),
  expiresAt: z.string(),
  source: z.object({
    type: z.enum(["toml", "shareLink", "device"]),
    detail: z.string(),
  }),
  network: z.object({
    name: z.string(),
    networkName: z.string(),
    ipv4Cidr: z.string(),
    magicDnsEnabled: z.boolean(),
    defaultConfig: z.record(z.string(), z.unknown()),
  }),
  summary: summarySchema,
  secret: z.object({
    present: z.boolean(),
    sameAsExisting: z.boolean().nullable(),
  }),
  diff: z.array(diffEntrySchema),
  warnings: z.array(z.string()),
  unsupported: z.array(z.string()),
  existingNetworkId: z.string().nullable(),
  networkNameTaken: z.boolean(),
});

const draftParamsSchema = z.object({
  draftId: z.string().min(10).max(64),
});

/**
 * M4 import flows: paste/upload TOML, an EasyTier `comp_cfg` share link, or
 * adopt the config a connected device is actually running. Every path produces
 * a server-side draft, a secret-free preview and a diff before anything is
 * saved; the EasyTier secret is preserved byte-for-byte.
 */
export function registerImportRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/api/networks/import/preview",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        operationId: "previewNetworkImport",
        tags: ["networks"],
        body: previewBodySchema,
        response: { 200: previewSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      return context.imports.preview(
        auth.organisation.id,
        auth.user.id,
        request.body.source,
        {
          existingNetworkId: request.body.existingNetworkId,
          name: request.body.name,
        },
      );
    },
  );

  typed.post(
    "/api/networks/import/:draftId/commit",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        operationId: "commitNetworkImport",
        tags: ["networks"],
        params: draftParamsSchema,
        body: commitBodySchema,
        response: { 201: networkSchema },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin"]);
      const network = await context.imports.commit(
        auth.organisation.id,
        auth.user.id,
        request.params.draftId,
        request.body,
      );
      return reply.code(201).send(network);
    },
  );

  typed.get(
    "/api/devices/:deviceId/import/instances",
    {
      schema: {
        operationId: "listAdoptableInstances",
        tags: ["devices"],
        params: paramsDeviceSchema,
        response: {
          200: z.array(
            z.object({ instanceId: z.string(), managed: z.boolean() }),
          ),
        },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      return context.imports.listDeviceInstances(
        auth.organisation.id,
        request.params.deviceId,
      );
    },
  );

  typed.get(
    "/api/networks/:networkId/export",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        operationId: "exportNetworkConfig",
        tags: ["networks"],
        params: paramsNetworkSchema,
        querystring: z.object({
          format: z.enum(["toml", "share-link"]).default("toml"),
        }),
        response: {
          200: z.object({
            format: z.enum(["toml", "share-link"]),
            content: z.string(),
            secretIncluded: z.literal(true),
          }),
        },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const network = await context.networks.requireNetwork(
        auth.organisation.id,
        request.params.networkId,
      );
      const secret = await context.networks.decryptSecretForComparison(network);
      const exported = buildNetworkExport(network, secret);
      await context.audit.record({
        orgId: auth.organisation.id,
        actorUserId: auth.user.id,
        action: "network.exported",
        targetType: "network",
        targetId: network.id,
        metadata: {
          format: request.query.format,
          networkName: network.networkName,
          // The output contains the secret by design; the audit row does not.
          secretIncluded: true,
        },
      });
      const format = request.query.format;
      return {
        format,
        content: format === "toml" ? exported.toml : exported.shareLink,
        secretIncluded: true as const,
      };
    },
  );
}
