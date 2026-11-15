import { createServer, type Server } from "node:http";

import type { AppContext } from "../app/context.js";
import { collectMetrics } from "./scrape.js";

/**
 * Optional internal-only scrape listener (`EASYPLANE_METRICS_PORT`). It binds
 * `EASYPLANE_METRICS_HOST` (127.0.0.1 by default) and serves only `/metrics`
 * and `/health`, so a Prometheus agent on the same host/network namespace does
 * not need the public API token. Never publish this port.
 */
export async function startInternalMetricsServer(
  context: AppContext,
  host: string,
  port: number,
): Promise<{ close: () => Promise<void> }> {
  const server: Server = createServer(async (request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    if (request.method !== "GET" || (path !== "/metrics" && path !== "/health")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found", code: "not_found" }));
      return;
    }
    if (path === "/health") {
      let database = "ok";
      try {
        await context.pool.query("select 1");
      } catch {
        database = "down";
      }
      response.writeHead(database === "ok" ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          status: database === "ok" ? "ok" : "degraded",
          database,
          clients: context.controlPlane.listClients().length,
        }),
      );
      return;
    }
    const body = await collectMetrics(context);
    response.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    });
    response.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
