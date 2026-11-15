/**
 * Minimal Prometheus text-format metrics.
 *
 * Deliberately dependency-free: the control plane exposes a handful of
 * counters/gauges, which is not worth a client library. Label values are
 * restricted to a fixed set by the call sites (never a token, network name or
 * device id), so cardinality stays bounded and no secret can reach a scrape.
 */
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly labels = new Map<string, Record<string, string>>();
  private readonly help = new Map<string, string>();
  private readonly types = new Map<string, "counter" | "gauge">();

  private key(name: string, labels: Record<string, string>): string {
    const entries = Object.entries(labels).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length === 0) return name;
    return `${name}{${entries
      .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
      .join(",")}}`;
  }

  declare(name: string, type: "counter" | "gauge", help: string): void {
    this.types.set(name, type);
    this.help.set(name, help);
  }

  inc(name: string, labels: Record<string, string> = {}, by = 1): void {
    this.declareType(name, "counter");
    const key = this.key(name, labels);
    this.labels.set(key, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  set(name: string, value: number, labels: Record<string, string> = {}): void {
    this.declareType(name, "gauge");
    const key = this.key(name, labels);
    this.labels.set(key, labels);
    this.gauges.set(key, value);
  }

  private declareType(name: string, type: "counter" | "gauge"): void {
    if (!this.types.has(name)) this.types.set(name, type);
  }

  /** Prometheus text exposition (version 0.0.4). */
  render(): string {
    const lines: string[] = [];
    const names = new Set<string>([
      ...this.counters.keys(),
      ...this.gauges.keys(),
    ]);
    // Group by metric name so HELP/TYPE precede every sample of that name.
    const byName = new Map<string, string[]>();
    for (const key of names) {
      const name = key.split("{")[0]!;
      const list = byName.get(name) ?? [];
      list.push(key);
      byName.set(name, list);
    }
    for (const [name, keys] of [...byName.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const type = this.types.get(name) ?? "gauge";
      if (this.help.has(name)) lines.push(`# HELP ${name} ${this.help.get(name)}`);
      lines.push(`# TYPE ${name} ${type}`);
      for (const key of keys.sort()) {
        const value = this.counters.get(key) ?? this.gauges.get(key) ?? 0;
        lines.push(`${key} ${formatNumber(value)}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
}

function formatNumber(value: number): string {
  if (Number.isFinite(value)) return String(value);
  return value > 0 ? "+Inf" : "-Inf";
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

export const METRIC_NAMES = {
  info: "easyplane_info",
  uptime: "easyplane_uptime_seconds",
  memory: "easyplane_process_resident_memory_bytes",
  clients: "easyplane_clients_connected",
  clientSessions: "easyplane_client_sessions_total",
  clientRejected: "easyplane_client_connections_rejected_total",
  clientsReaped: "easyplane_clients_reaped_total",
  heartbeats: "easyplane_heartbeats_total",
  unknownTokens: "easyplane_unknown_config_server_tokens_total",
  pushes: "easyplane_config_pushes_total",
  sseStreams: "easyplane_sse_streams",
  sseEvents: "easyplane_sse_events_total",
  topologyCycles: "easyplane_topology_cycles_total",
  topologyProbes: "easyplane_topology_probes_total",
  imports: "easyplane_network_imports_total",
  dbUp: "easyplane_database_up",
  httpRequests: "easyplane_http_requests_total",
} as const;
