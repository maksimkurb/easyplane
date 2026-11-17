import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAuth, requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import {
  assignTagSchema,
  compiledAclSchema,
  createTagSchema,
  createUserGroupSchema,
  paramsNetworkSchema,
  policyCatalogSchema,
  policyModeInputSchema,
  policyStateSchema,
  policyTagSchema,
  policyUserGroupSchema,
  policyVersionSchema,
  previewInputSchema,
  previewSchema,
  savePolicySchema,
  tagSchema,
  testReachabilitySchema,
  userGroupMemberSchema,
} from "../app/schemas.js";
import {
  PolicyValidationError,
  describePolicy,
  normalizePolicyDocument,
  parsePolicyText,
  type PolicyDocument,
} from "../domain/policy/index.js";
import { AppError, invalid } from "../services/errors.js";

const tagParamsSchema = z.object({ tagId: z.string().uuid() });
const groupParamsSchema = z.object({ groupId: z.string().min(1).max(80) });
const groupMemberParamsSchema = z.object({
  groupId: z.string().min(1).max(80),
  email: z.string().min(3).max(253),
});
const compiledParamsSchema = z.object({
  networkId: z.string().uuid(),
  deviceId: z.string().uuid(),
});

/**
 * Policy API (model v2).
 *
 * Reads are available to every authenticated user (a document contains device
 * names and ports, no secrets); every write requires admin. Subjects, tags and
 * user groups are separate collections: `tag:` labels devices, `group:` is a
 * set of people.
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
      return context.policies.getState(request.params.networkId);
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

  typed.get(
    "/api/networks/:networkId/policy/subjects",
    {
      schema: {
        operationId: "getPolicySubjects",
        tags: ["policy"],
        params: paramsNetworkSchema,
        response: { 200: policyCatalogSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const actor = {
        orgId: auth.organisation.id,
        userId: auth.user.id,
        role: auth.user.role,
      };
      await context.networks.requireNetwork(actor.orgId, request.params.networkId);
      return context.policies.catalog(actor, request.params.networkId);
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
            summary: policyStateSchema.shape.summary,
            upgradedFromV1: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const { document, upgradedFromV1 } = await resolveDocument(context, request.body);
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
        upgradedFromV1,
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
            upgradedFromV1: z.boolean(),
            mode: z.enum(["open", "rules", "json"]),
          }),
        },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const { document, upgradedFromV1 } = await resolveDocument(context, request.body);
      const result = await context.policies.save(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
        {
          document,
          ...(request.body.note !== undefined ? { note: request.body.note } : {}),
          ...(request.body.mode !== undefined ? { mode: request.body.mode } : {}),
          upgradedFromV1,
        },
      );
      return {
        ...result,
        mode: request.body.mode ?? document.mode,
      };
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
          200: z.object({
            status: z.literal("ok"),
            revisionsCreated: z.number().int(),
          }),
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
    "/api/networks/:networkId/policy/mode",
    {
      schema: {
        operationId: "setNetworkPolicyMode",
        tags: ["policy"],
        params: paramsNetworkSchema,
        body: policyModeInputSchema,
        response: {
          200: z.object({
            version: z.number().int(),
            mode: z.enum(["open", "rules", "json"]),
            revisionsCreated: z.number().int(),
          }),
        },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      return context.policies.setMode(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
        request.body.mode,
      );
    },
  );

  typed.get(
    "/api/networks/:networkId/policy/compiled/:deviceId",
    {
      schema: {
        operationId: "getCompiledAcl",
        tags: ["policy"],
        params: compiledParamsSchema,
        response: { 200: compiledAclSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.policies.compiledAcl(
        {
          orgId: auth.organisation.id,
          userId: auth.user.id,
          role: auth.user.role,
        },
        request.params.networkId,
        request.params.deviceId,
      );
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
          ? context.policies.normalize(request.body.document).document
          : (await context.policies.getActive(request.params.networkId)).policy
              ?.document;
      if (!document) {
        throw new AppError(409, "provide a document or save a policy first", "no_policy");
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
          ...(request.body.srcDeviceId ? { srcDeviceId: request.body.srcDeviceId } : {}),
          ...(request.body.srcIp ? { srcIp: request.body.srcIp } : {}),
          ...(request.body.dstDeviceId ? { dstDeviceId: request.body.dstDeviceId } : {}),
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
          ...(request.body.srcDeviceId ? { srcDeviceId: request.body.srcDeviceId } : {}),
          ...(request.body.srcIp ? { srcIp: request.body.srcIp } : {}),
          ...(request.body.dstDeviceId ? { dstDeviceId: request.body.dstDeviceId } : {}),
          ...(request.body.dstCidr ? { dstCidr: request.body.dstCidr } : {}),
          ...(request.body.port !== undefined ? { port: request.body.port } : {}),
          protocol: request.body.protocol,
        },
      );
    },
  );

  // ------------------------------------------------------------------ tags

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
      return context.policies.listTags({
        orgId: auth.organisation.id,
        userId: auth.user.id,
        role: auth.user.role,
      });
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
      if (!/^(?:tag:)?[a-z0-9][a-z0-9-]{0,62}$/i.test(raw)) {
        invalid('tag names must be plain names like "us" or namespaced "tag:us"');
      }
      const tag = await context.policies.createTag(
        { orgId: auth.organisation.id, userId: auth.user.id, role: auth.user.role },
        { name: raw.replace(/^tag:/, ""), color: request.body.color },
      );
      return reply.code(201).send(tag);
    },
  );

  typed.delete(
    "/api/tags/:tagId",
    {
      schema: {
        operationId: "deleteTag",
        tags: ["policy"],
        params: tagParamsSchema,
        response: { 200: z.object({ status: z.literal("ok") }) },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      await context.policies.deleteTag(
        { orgId: auth.organisation.id, userId: auth.user.id, role: auth.user.role },
        request.params.tagId,
      );
      return { status: "ok" as const };
    },
  );

  typed.put(
    "/api/tags/:tagId/devices",
    {
      schema: {
        operationId: "assignTagDevices",
        tags: ["policy"],
        params: tagParamsSchema,
        body: assignTagSchema,
        response: { 200: policyTagSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin", "member"]);
      return context.policies.assignTag(
        { orgId: auth.organisation.id, userId: auth.user.id, role: auth.user.role },
        request.params.tagId,
        request.body.deviceIds,
      );
    },
  );

  // ----------------------------------------------------------- user groups

  typed.get(
    "/api/user-groups",
    {
      schema: {
        operationId: "listUserGroups",
        tags: ["policy"],
        response: { 200: z.array(policyUserGroupSchema) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return context.policies.listUserGroups({
        orgId: auth.organisation.id,
        userId: auth.user.id,
        role: auth.user.role,
      });
    },
  );

  typed.post(
    "/api/user-groups",
    {
      schema: {
        operationId: "createUserGroup",
        tags: ["policy"],
        body: createUserGroupSchema,
        response: { 201: policyUserGroupSchema },
      },
    },
    async (request, reply) => {
      const auth = requireRole(request, ["admin"]);
      const group = await context.policies.createUserGroup(
        { orgId: auth.organisation.id, userId: auth.user.id, role: auth.user.role },
        request.body,
      );
      return reply.code(201).send(group);
    },
  );

  typed.delete(
    "/api/user-groups/:groupId",
    {
      schema: {
        operationId: "deleteUserGroup",
        tags: ["policy"],
        params: groupParamsSchema,
        response: { 200: z.object({ status: z.literal("ok") }) },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      await context.policies.deleteUserGroup(
        { orgId: auth.organisation.id, userId: auth.user.id, role: auth.user.role },
        request.params.groupId,
      );
      return { status: "ok" as const };
    },
  );

  typed.post(
    "/api/user-groups/:groupId/members",
    {
      schema: {
        operationId: "addUserGroupMember",
        tags: ["policy"],
        params: groupParamsSchema,
        body: userGroupMemberSchema,
        response: { 200: policyUserGroupSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      return context.policies.addUserGroupMember(
        { orgId: auth.organisation.id, userId: auth.user.id, role: auth.user.role },
        request.params.groupId,
        request.body.email,
      );
    },
  );

  typed.delete(
    "/api/user-groups/:groupId/members/:email",
    {
      schema: {
        operationId: "removeUserGroupMember",
        tags: ["policy"],
        params: groupMemberParamsSchema,
        response: { 200: policyUserGroupSchema },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      return context.policies.removeUserGroupMember(
        { orgId: auth.organisation.id, userId: auth.user.id, role: auth.user.role },
        request.params.groupId,
        decodeURIComponent(request.params.email),
      );
    },
  );
}

async function resolveDocument(
  context: AppContext,
  body: { document?: Record<string, unknown>; text?: string },
): Promise<{ document: PolicyDocument; upgradedFromV1: boolean }> {
  if (body.text !== undefined) {
    try {
      const parsed = parsePolicyText(body.text);
      return { document: parsed, upgradedFromV1: false };
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
  return context.policies.normalize(body.document ?? {});
}

/** Kept for tests and callers that import normalization from the routes. */
export { normalizePolicyDocument };
