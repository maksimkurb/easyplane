import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAuth, requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import {
  paramsNetworkSchema,
  policyStateSchema,
  policyVersionSchema,
  previewInputSchema,
  previewSchema,
  savePolicySchema,
  testReachabilitySchema,
} from "../app/schemas.js";
import {
  describePolicy,
  normalizePolicyDocument,
  parsePolicyText,
  PolicyValidationError,
  type PolicyDocument,
} from "../domain/policy/index.js";
import { AppError } from "../services/errors.js";

/**
 * Policy API. Reads are available to every authenticated user (the document
 * contains device names and ports, no secrets); every write requires admin.
 */
export function registerPolicyRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/networks/:networkId/policy",
    {
      schema: {
        operationId: "getNetworkPolicy",
        tags: ["policy"],
        params: paramsNetworkSchema,
        response: { 200: policyStateSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      await context.networks.requireNetwork(auth.organisation.id, request.params.networkId);
      return context.policies.getActive(request.params.networkId);
    },
  );

  typed.get(
    "/api/networks/:networkId/policy/versions",
    {
      schema: {
        operationId: "listNetworkPolicyVersions",
        tags: ["policy"],
        params: paramsNetworkSchema,
        response: { 200: z.array(policyVersionSchema) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      await context.networks.requireNetwork(auth.organisation.id, request.params.networkId);
      return context.policies.listVersions(request.params.networkId);
    },
  );

  typed.post(
    "/api/networks/:networkId/policy/validate",
    {
      schema: {
        operationId: "validateNetworkPolicy",
        tags: ["policy"],
        params: paramsNetworkSchema,
        body: savePolicySchema,
        response: {
          200: z.object({
            warnings: z.array(z.string()),
            devices: previewSchema.shape.devices,
            summary: z.object({
              statements: z.number().int(),
              tags: z.array(z.string()),
              groups: z.array(z.string()),
              hosts: z.array(z.string()),
              strictTags: z.boolean(),
            }),
          }),
        },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const document = await resolveDocument(request.body);
      const result = await context.policies.validate(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
        document,
      );
      return {
        warnings: result.warnings,
        devices: result.devices,
        summary: describePolicy(document),
      };
    },
  );

  typed.put(
    "/api/networks/:networkId/policy",
    {
      schema: {
        operationId: "saveNetworkPolicy",
        tags: ["policy"],
        params: paramsNetworkSchema,
        body: savePolicySchema,
        response: {
          200: z.object({
            policy: policyVersionSchema,
            revisionsCreated: z.number().int(),
          }),
        },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const document = await resolveDocument(request.body);
      return context.policies.save(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
        { document, note: request.body.note },
      );
    },
  );

  typed.delete(
    "/api/networks/:networkId/policy",
    {
      schema: {
        operationId: "deleteNetworkPolicy",
        tags: ["policy"],
        params: paramsNetworkSchema,
        response: {
          200: z.object({ status: z.literal("ok"), revisionsCreated: z.number().int() }),
        },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const result = await context.policies.disable(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
      );
      return { status: "ok" as const, revisionsCreated: result.revisionsCreated };
    },
  );

  typed.post(
    "/api/networks/:networkId/policy/preview",
    {
      schema: {
        operationId: "previewNetworkPolicy",
        tags: ["policy"],
        params: paramsNetworkSchema,
        body: previewInputSchema,
        response: { 200: previewSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      const document = request.body.text
        ? parsePolicyText(request.body.text)
        : request.body.document
          ? normalizePolicyDocument(request.body.document)
          : (await context.policies.getActive(request.params.networkId)).policy
              ?.document;
      if (!document) {
        throw new AppError(
          409,
          "provide a document or save a policy first",
          "no_policy",
        );
      }
      return context.policies.preview(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
        {
          document: document as unknown as PolicyDocument,
          srcDeviceId: request.body.srcDeviceId,
          ...(request.body.dstDeviceId
            ? { dstDeviceId: request.body.dstDeviceId }
            : {}),
          ...(request.body.dstCidr ? { dstCidr: request.body.dstCidr } : {}),
          ...(request.body.port !== undefined ? { port: request.body.port } : {}),
          protocol: request.body.protocol,
        },
      );
    },
  );

  typed.post(
    "/api/networks/:networkId/policy/test",
    {
      schema: {
        operationId: "testNetworkReachability",
        tags: ["policy"],
        params: paramsNetworkSchema,
        body: testReachabilitySchema,
        response: {
          200: previewSchema.extend({ policyVersion: z.number().int() }),
        },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.policies.testReachability(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
        {
          srcDeviceId: request.body.srcDeviceId,
          ...(request.body.dstDeviceId
            ? { dstDeviceId: request.body.dstDeviceId }
            : {}),
          ...(request.body.dstCidr ? { dstCidr: request.body.dstCidr } : {}),
          ...(request.body.port !== undefined ? { port: request.body.port } : {}),
          protocol: request.body.protocol,
        },
      );
    },
  );
}

async function resolveDocument(body: {
  document?: Record<string, unknown>;
  text?: string;
}): Promise<PolicyDocument> {
  if (body.text !== undefined) {
    return parsePolicyText(body.text);
  }
  try {
    return normalizePolicyDocument(body.document);
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      throw new AppError(
        400,
        [error.message, ...error.issues].join("; "),
        "policy_invalid",
      );
    }
    throw error;
  }
}
