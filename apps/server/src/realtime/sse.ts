import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireRole } from "../app/auth-hooks.js";
import type { AppContext } from "../app/context.js";
import type { RealtimeEvent } from "./events.js";
import { RealtimeLimitError } from "./hub.js";

/** Keep-alive comment interval; proxies must not idle the stream out. */
export const SSE_HEARTBEAT_SECONDS = 15;
/**
 * A slow consumer is disconnected rather than buffered without limit. The
 * browser reconnects, gets `resync` and refetches, so nothing is lost.
 */
export const SSE_MAX_BUFFERED_BYTES = 1_000_000;

const eventStreamQuerySchema = z.object({
  /** Filter delivery to one network. */
  networkId: z.string().uuid().optional(),
  /** `1` marks the stream as a topology map viewer (drives adaptive polling). */
  topology: z.enum(["0", "1"]).optional(),
});

function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // nginx and friends buffer proxied responses by default, which breaks SSE.
    "x-accel-buffering": "no",
  };
}

function serialize(event: RealtimeEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * `GET /api/events` — server-sent events for the panel.
 *
 * Authenticated with the session cookie (EventSource sends cookies for
 * same-origin requests), role-checked by the same pre-handler as every other
 * API route, and bounded per user by `RealtimeHub`. The endpoint is hidden from
 * the OpenAPI document because a generated JSON client cannot consume a
 * stream; docs/REALTIME.md documents the contract instead.
 */
export function registerEventRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/events",
    {
      schema: {
        operationId: "streamEvents",
        tags: ["system"],
        hide: true,
        querystring: eventStreamQuerySchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { query } = request as FastifyRequest & {
        query: z.infer<typeof eventStreamQuerySchema>;
      };
      // Every role may read; the check runs before the stream is opened.
      const auth = requireRole(request, ["admin", "member", "viewer"]);

      reply.hijack();

      const write = (event: RealtimeEvent): void => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        if (reply.raw.writableLength > SSE_MAX_BUFFERED_BYTES) {
          // Slow consumer: drop the stream instead of growing memory. The
          // client reconnects with backoff and receives `resync`.
          request.log.warn(
            { userId: auth.user.id, buffered: reply.raw.writableLength },
            "closing a slow SSE stream",
          );
          reply.raw.destroy();
          return;
        }
        reply.raw.write(serialize(event));
      };

      let subscription;
      try {
        subscription = context.realtime.subscribe(
          {
            userId: auth.user.id,
            orgId: auth.organisation.id,
            role: auth.user.role,
            email: auth.user.email,
          },
          {
            networkIds: query.networkId ? [query.networkId] : undefined,
            topics: query.topology === "1" ? ["topology"] : undefined,
            lastEventId: parseLastEventId(request),
          },
          write,
        );
      } catch (error) {
        if (error instanceof RealtimeLimitError) {
          reply.raw.writeHead(429, { "content-type": "application/json" });
          reply.raw.end(
            JSON.stringify({ error: error.message, code: error.code }),
          );
          return reply;
        }
        throw error;
      }

      reply.raw.writeHead(200, sseHeaders());

      // Base reconnect hint for the browser; the client also applies its own
      // exponential backoff (docs/REALTIME.md §4).
      reply.raw.write("retry: 3000\n\n");
      write({
        seq: 0,
        type: "hello",
        at: new Date().toISOString(),
        orgId: auth.organisation.id,
        topics: [],
        data: {
          user: {
            id: auth.user.id,
            email: auth.user.email,
            role: auth.user.role,
          },
          heartbeatSeconds: SSE_HEARTBEAT_SECONDS,
          maxPerUser: context.realtime.maxPerUser,
        },
      });
      if (subscription.resync) {
        write({
          seq: context.realtime.lastSequence,
          type: "resync",
          at: new Date().toISOString(),
          orgId: auth.organisation.id,
          topics: [],
          data: { reason: "last-event-id is no longer available" },
        });
      }
      for (const event of subscription.replay) write(event);

      const heartbeat = setInterval(() => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        // A comment frame keeps the connection alive and is ignored by the
        // browser's EventSource parser.
        reply.raw.write(`: keep-alive ${Date.now()}\n\n`);
      }, SSE_HEARTBEAT_SECONDS * 1000);
      heartbeat.unref?.();

      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        subscription.close();
      };
      request.raw.on("close", cleanup);
      request.raw.on("error", cleanup);
      reply.raw.on("close", cleanup);
      reply.raw.on("error", cleanup);

      // The response stays open until the client disconnects.
      return reply;
    },
  );
}

function parseLastEventId(request: FastifyRequest): number | undefined {
  const header = request.headers["last-event-id"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export { serialize as serializeSseEvent };
