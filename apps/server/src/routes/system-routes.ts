import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { SESSION_COOKIE } from "../auth/session.js";
import { AppError } from "../services/errors.js";
import { requireAuth, requireRole } from "../app/auth-hooks.js";
import {
  configServerBaseUrl,
  publicBaseUrl,
  toOrganisationDto,
  toUserDto,
} from "../app/dto.js";
import {
  appConfigSchema,
  loginProvidersSchema,
  meSchema,
  okSchema,
  paramsProviderSchema,
  userSchema,
} from "../app/schemas.js";
import type { AppContext } from "../app/context.js";
import { VERSION } from "../app/context.js";

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const loginQuerySchema = z.object({
  returnTo: z.string().optional(),
});

const bootstrapBodySchema = z
  .object({
    token: z.string().min(1).max(512),
    email: z.string().email(),
    displayName: z.string().max(200).optional(),
  })
  .strict();

export function registerSystemRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/health",
    {
      schema: {
        operationId: "health",
        tags: ["system"],
        response: {
          200: z.object({
            status: z.enum(["ok", "degraded"]),
            version: z.string(),
            uptimeSeconds: z.number(),
            database: z.enum(["ok", "down"]),
            clients: z.number().int(),
          }),
          503: z.object({
            status: z.enum(["ok", "degraded"]),
            version: z.string(),
            uptimeSeconds: z.number(),
            database: z.enum(["ok", "down"]),
            clients: z.number().int(),
          }),
        },
      },
    },
    async (_request, reply) => {
      let database: "ok" | "down" = "ok";
      try {
        await context.pool.query("select 1");
      } catch {
        database = "down";
      }
      const status: "ok" | "degraded" = database === "ok" ? "ok" : "degraded";
      if (database === "down") reply.code(503);
      return {
        status,
        version: VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        database,
        clients: context.controlPlane.listClients().length,
      };
    },
  );

  typed.get(
    "/api/config",
    {
      schema: {
        operationId: "getAppConfig",
        tags: ["system"],
        response: { 200: appConfigSchema },
      },
    },
    async (request) => {
      return {
        orgName: context.organisation.name,
        publicUrl: context.env.publicUrl ?? null,
        publicConfigServerUrl: configServerBaseUrl(
          context.env.publicConfigServerUrl,
          request,
        ),
        bootstrapAvailable: await context.auth.bootstrapAvailable(),
        providers: context.auth.listProviders(),
      };
    },
  );

  typed.get(
    "/api/auth/providers",
    {
      schema: {
        operationId: "listLoginProviders",
        tags: ["auth"],
        response: { 200: loginProvidersSchema },
      },
    },
    async () => ({
      providers: context.auth
        .listProviders()
        .map((provider) => ({ id: provider.id, label: provider.label })),
    }),
  );

  typed.get(
    "/api/auth/login/:provider",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
      schema: {
        operationId: "startOidcLogin",
        tags: ["auth"],
        params: paramsProviderSchema,
        querystring: loginQuerySchema,
      },
    },
    async (request, reply) => {
      const redirectUri = `${publicBaseUrl(context.env.publicUrl, request)}/api/auth/callback/${encodeURIComponent(request.params.provider)}`;
      const { url } = await context.auth.beginLogin(request.params.provider, {
        redirectUri,
        returnTo: request.query.returnTo,
      });
      return reply.redirect(url, 302);
    },
  );

  typed.get(
    "/api/auth/callback/:provider",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
      schema: {
        operationId: "finishOidcLogin",
        tags: ["auth"],
        params: paramsProviderSchema,
        querystring: callbackQuerySchema,
      },
    },
    async (request, reply) => {
      if (request.query.error) {
        request.log.info(
          { provider: request.params.provider, error: request.query.error },
          "OIDC provider returned an error",
        );
        return reply.redirect(
          `/login?error=${encodeURIComponent(request.query.error)}`,
          302,
        );
      }
      if (!request.query.code || !request.query.state) {
        throw new AppError(400, "missing code or state", "invalid_callback");
      }
      const redirectUri = `${publicBaseUrl(context.env.publicUrl, request)}/api/auth/callback/${encodeURIComponent(request.params.provider)}`;
      const result = await context.auth.completeLogin(request.params.provider, {
        code: request.query.code,
        state: request.query.state,
        redirectUri,
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? "",
      });
      reply.header("set-cookie", [
        result.session.cookie,
        result.session.csrfCookie,
      ]);
      return reply.redirect(result.returnTo, 302);
    },
  );

  typed.post(
    "/api/auth/bootstrap",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        operationId: "bootstrapAdmin",
        tags: ["auth"],
        body: bootstrapBodySchema,
        response: { 200: z.object({ user: userSchema }) },
      },
    },
    async (request, reply) => {
      const result = await context.auth.bootstrap({
        token: request.body.token,
        email: request.body.email,
        displayName: request.body.displayName,
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? "",
      });
      reply.header("set-cookie", [
        result.session.cookie,
        result.session.csrfCookie,
      ]);
      return { user: toUserDto(result.user) };
    },
  );

  typed.get(
    "/api/auth/me",
    {
      schema: {
        operationId: "getMe",
        tags: ["auth"],
        response: { 200: meSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return {
        user: toUserDto(auth.user),
        organisation: toOrganisationDto(auth.organisation),
        csrfToken: auth.session.csrfToken,
        providers: context.auth
          .listProviders()
          .map((provider) => ({ id: provider.id, label: provider.label })),
      };
    },
  );

  typed.post(
    "/api/auth/logout",
    {
      schema: {
        operationId: "logout",
        tags: ["auth"],
        response: { 200: okSchema },
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const token = request.cookies[SESSION_COOKIE];
      if (token) await context.sessions.destroy(token);
      reply.header("set-cookie", context.sessions.clearCookies());
      await context.audit.record({
        orgId: auth.organisation.id,
        actorUserId: auth.user.id,
        action: "auth.logout",
        targetType: "user",
        targetId: auth.user.id,
      });
      return { status: "ok" as const };
    },
  );

  typed.get(
    "/api/users",
    {
      schema: {
        operationId: "listUsers",
        tags: ["users"],
        response: { 200: z.array(userSchema) },
      },
    },
    async (request) => {
      requireRole(request, ["admin"]);
      const users = await context.db.query.users.findMany({
        where: (table, { eq }) => eq(table.orgId, context.organisation.id),
      });
      return users.map(toUserDto);
    },
  );
}
