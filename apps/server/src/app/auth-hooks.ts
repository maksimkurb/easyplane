import type { FastifyReply, FastifyRequest } from "fastify";

import { SESSION_COOKIE } from "../auth/session.js";
import type { Organisation, User, UserRole } from "../db/schema.js";
import type { AppContext } from "./context.js";
import { AppError } from "../services/errors.js";

export interface AuthContext {
  user: User;
  organisation: Organisation;
  session: { id: string; csrfToken: string; expiresAt: Date };
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isPublicRoute(method: string, path: string): boolean {
  if (method === "GET") {
    if (path === "/api/config") return true;
    if (path === "/api/auth/providers") return true;
    if (path === "/api/openapi.json") return true;
    if (path.startsWith("/api/auth/login/")) return true;
    if (path.startsWith("/api/auth/callback/")) return true;
  }
  if (method === "POST" && path === "/api/auth/bootstrap") return true;
  return false;
}

export async function authenticate(
  context: AppContext,
  request: FastifyRequest,
): Promise<AuthContext | null> {
  if (request.auth) return request.auth;
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const found = await context.sessions.resolve(token);
  if (!found) return null;
  const auth: AuthContext = {
    user: found.user,
    organisation: found.organisation,
    session: {
      id: found.session.id,
      csrfToken: found.session.csrfToken,
      expiresAt: found.session.expiresAt,
    },
  };
  request.auth = auth;
  return auth;
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw new AppError(401, "authentication required", "unauthenticated");
  }
  return request.auth;
}

export function requireRole(
  request: FastifyRequest,
  roles: readonly UserRole[],
): AuthContext {
  const auth = requireAuth(request);
  if (!roles.includes(auth.user.role)) {
    throw new AppError(403, "insufficient role", "forbidden");
  }
  return auth;
}

/** Global pre-handler: sessions, roles and CSRF for every non-public API route. */
export function registerAuthHooks(app: import("fastify").FastifyInstance, context: AppContext): void {
  app.decorateRequest("auth", null);

  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/")) return;
    if (isPublicRoute(request.method, path)) return;

    const auth = await authenticate(context, request);
    if (!auth) {
      await reply.code(401).send({
        error: "authentication required",
        code: "unauthenticated",
      });
      return reply;
    }
    if (!SAFE_METHODS.has(request.method)) {
      const header = request.headers["x-csrf-token"];
      if (
        typeof header !== "string" ||
        !context.sessions.verifyCsrf(auth.session, header)
      ) {
        await reply.code(403).send({
          error: "invalid or missing CSRF token",
          code: "invalid_csrf",
        });
        return reply;
      }
    }
    return undefined;
  });
}
