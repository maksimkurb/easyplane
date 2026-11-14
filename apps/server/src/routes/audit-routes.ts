import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import { toAuditDto } from "../app/dto.js";
import { auditSchema } from "../app/schemas.js";

export function registerAuditRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/audit",
    {
      schema: {
        operationId: "listAuditLog",
        tags: ["audit"],
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
        response: { 200: z.array(auditSchema) },
      },
    },
    async (request) => {
      const auth = requireRole(request, ["admin"]);
      const entries = await context.audit.list(
        auth.organisation.id,
        request.query.limit,
      );
      return entries.map(toAuditDto);
    },
  );
}
