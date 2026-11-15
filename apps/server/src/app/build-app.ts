import { existsSync } from "node:fs";
import { resolve } from "node:path";

import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
} from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { AuthError } from "../auth/service.js";
import { AppError } from "../services/errors.js";
import { registerAuthHooks } from "./auth-hooks.js";
import type { AppContext } from "./context.js";
import { VERSION } from "./context.js";
import { registerAuditRoutes } from "../routes/audit-routes.js";
import { registerDeviceRoutes } from "../routes/devices-routes.js";
import { registerDnsRoutes } from "../routes/dns-routes.js";
import { registerNetworkRoutes } from "../routes/networks-routes.js";
import { registerPolicyRoutes } from "../routes/policy-routes.js";
import { registerRouteRoutes } from "../routes/route-routes.js";
import { registerSystemRoutes } from "../routes/system-routes.js";
import { registerTopologyRoutes } from "../routes/topology-routes.js";
import { registerEventRoutes } from "../realtime/sse.js";

export interface BuildAppOptions {
  /** Overrides `EASYPLANE_WEB_DIR`. */
  webDir?: string | null;
  /** Skip static file serving (OpenAPI generation, tests). */
  serveWeb?: boolean;
}

function defaultWebDir(): string | undefined {
  const candidate = resolve(import.meta.dirname, "../../web/dist");
  return existsSync(candidate) ? candidate : undefined;
}

export async function buildApp(
  context: AppContext,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const { env } = context;
  const app = Fastify({
    logger: {
      level: env.logLevel,
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.headers['x-csrf-token']",
          "res.headers['set-cookie']",
        ],
        censor: "[redacted]",
      },
    },
    trustProxy: env.trustProxy,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(rateLimit, {
    // Blanket protection for the HTTP API; auth endpoints add stricter limits
    // via their route config. The config-server listeners have their own
    // unknown-token limiter in the device service.
    global: true,
    max: 600,
    timeWindow: "1 minute",
    errorResponseBuilder: (_request, limit) => ({
      error: "too many requests",
      code: "rate_limited",
      retryAfter: limit.after,
    }),
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "EasyPlane API",
        description:
          "Control plane for EasyTier. Session-cookie authenticated; state-changing requests require the X-CSRF-Token header.",
        version: VERSION,
      },
      servers: [{ url: "/" }],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: "easyplane_session",
          },
        },
      },
      security: [{ sessionCookie: [] }],
      tags: [
        { name: "system" },
        { name: "auth" },
        { name: "networks" },
        { name: "invites" },
        { name: "devices" },
        { name: "config" },
        { name: "policy" },
        { name: "dns" },
        { name: "routes" },
        { name: "audit" },
        { name: "users" },
        { name: "topology" },
      ],
    },
    transform: jsonSchemaTransform,
  });

  registerAuthHooks(app, context);
  registerSystemRoutes(app, context);
  registerNetworkRoutes(app, context);
  registerDeviceRoutes(app, context);
  registerPolicyRoutes(app, context);
  registerDnsRoutes(app, context);
  registerRouteRoutes(app, context);
  registerAuditRoutes(app, context);
  registerTopologyRoutes(app, context);
  registerEventRoutes(app, context);

  app.get(
    "/api/openapi.json",
    { schema: { hide: true } },
    async () =>
      (
        app as unknown as { swagger: () => Record<string, unknown> }
      ).swagger(),
  );

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    if (
      env.nodeEnv === "production" &&
      (request.url === "/" || request.url.endsWith(".html"))
    ) {
      reply.header(
        "content-security-policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; font-src 'self' data:; frame-ancestors 'none'",
      );
    }
    return payload;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError || error instanceof AuthError) {
      return reply.code(error.statusCode).send({
        error: error.message,
        code: error instanceof AppError ? error.code : "auth_error",
      });
    }
    if (error.validation) {
      return reply.code(400).send({
        error: error.message,
        code: "validation_error",
      });
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) {
      return reply
        .code(statusCode)
        .send({ error: error.message, code: "request_error" });
    }
    request.log.error({ err: error }, "request failed");
    return reply
      .code(500)
      .send({ error: "internal server error", code: "internal_error" });
  });

  const webDir =
    options.serveWeb === false
      ? null
      : (options.webDir ?? env.webDir ?? defaultWebDir());

  if (webDir && existsSync(resolve(webDir, "index.html"))) {
    await app.register(fastifyStatic, { root: webDir, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split("?")[0] ?? request.url;
      if (path.startsWith("/api/")) {
        return reply
          .code(404)
          .send({ error: "not found", code: "not_found" });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return reply.code(404).send({ error: "not found", code: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      if (!request.url.startsWith("/api/")) {
        return reply
          .code(404)
          .type("text/plain")
          .send("EasyPlane API. The web UI is not bundled in this build.\n");
      }
      return reply.code(404).send({ error: "not found", code: "not_found" });
    });
  }

  return app;
}
