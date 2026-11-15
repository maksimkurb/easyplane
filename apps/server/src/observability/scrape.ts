import type { AppContext } from "../app/context.js";
import { VERSION } from "../app/context.js";
import { METRIC_NAMES } from "./metrics.js";

/**
 * Refreshes the scrape-time gauges and returns Prometheus text. Called by the
 * authenticated `/metrics` route and by the optional internal-only listener.
 */
export async function collectMetrics(context: AppContext): Promise<string> {
  let databaseUp = 1;
  try {
    await context.pool.query("select 1");
  } catch {
    databaseUp = 0;
  }
  const metrics = context.metrics;
  metrics.set(METRIC_NAMES.info, 1, { version: VERSION });
  metrics.set(METRIC_NAMES.uptime, process.uptime());
  metrics.set(METRIC_NAMES.memory, process.memoryUsage.rss());
  metrics.set(METRIC_NAMES.clients, context.controlPlane.listClients().length);
  metrics.set(METRIC_NAMES.sseStreams, context.realtime.size);
  metrics.set(METRIC_NAMES.dbUp, databaseUp);
  metrics.set("easyplane_topology_snapshots", context.topology.snapshotCount);
  metrics.set("easyplane_import_drafts", context.imports.drafts.size);
  metrics.set("easyplane_device_sessions", context.deviceSessions.size);
  return metrics.render();
}
