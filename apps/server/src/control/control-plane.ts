import { EventEmitter } from "node:events";
import { web } from "@easyplane/proto";

import { createLogger, type Logger } from "../logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import { METRIC_NAMES } from "../observability/metrics.js";
import { AcceptRateLimiter, findSilentClients } from "./limits.js";
import { TcpConfigServerListener } from "../listener/tcp-listener.js";
import { WsConfigServerListener } from "../listener/ws-listener.js";
import { UdpConfigServerListener } from "../listener/udp-listener.js";
import type { RpcSession } from "../rpc/session.js";
import { RpcSession as RpcSessionImpl } from "../rpc/session.js";
import type { FrameTransport, TransportKind } from "../transport/frames.js";
import { acceptLink } from "../transport/link.js";
import { ManagedClient, type HeartbeatSnapshot } from "./managed-client.js";
import { registerWebServerService } from "./web-server-service.js";

export interface ControlPlaneOptions {
  host?: string;
  /** Port 0 picks an ephemeral port; null disables the listener. */
  tcpPort?: number | null;
  wsPort?: number | null;
  wss?: { port: number; certFile: string; keyFile: string } | null;
  /** UDP config-server transport (`udp://`); disabled unless set. */
  udpPort?: number | null;
  /** Idle timeout for one UDP session (no DATA/SYN for this long). */
  udpSessionIdleTimeoutMs?: number;
  /**
   * Advertised by GetFeature. `true` (default) enables the web-secure Noise
   * tunnel when the client supports it. Set false only for debugging/legacy
   * compatibility tests; clients with `--secure-mode` will then refuse to work.
   */
  supportEncryption?: boolean;
  /**
   * Accepted config-server tokens (HeartbeatRequest.user_token). Kept for the
   * M0 conformance harness; M1 resolves tokens through `onHeartbeat`.
   */
  allowedTokens?: string[];
  logger?: Logger;
  /**
   * M1 hook: resolves an invite/device from the heartbeat. Throwing rejects the
   * RPC (the client logs and reconnects in 1 s).
   */
  onHeartbeat?: (
    client: ManagedClient,
    request: web.HeartbeatRequest,
    snapshot: HeartbeatSnapshot,
  ) => Promise<void> | void;
  /** M1 hook: session closed (device is offline once heartbeats stop). */
  onClientClosed?: (client: ManagedClient) => void;
  /** Hard cap on simultaneous config-server tunnels. */
  maxConnections?: number;
  /** Per-IP tunnel admission limit (fixed one-minute window, 0 disables). */
  acceptLimitPerMinute?: number;
  /**
   * Close a tunnel that has not sent a heartbeat for this long. The real
   * client heartbeats every second, so this only catches half-open/dead links.
   */
  heartbeatTimeoutMs?: number;
  metrics?: MetricsRegistry;
}

export interface ControlPlaneAddresses {
  tcpPort: number | null;
  wsPort: number | null;
  wssPort: number | null;
  udpPort: number | null;
}

export interface ControlPlaneEvents {
  "client-connected": [client: ManagedClient];
  "client-disconnected": [client: ManagedClient];
  heartbeat: [client: ManagedClient, snapshot: HeartbeatSnapshot];
  error: [error: Error];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Read-only M0 control plane: accepts easytier-core config-server connections,
 * answers WebServerService, and lets callers drive WebClientService RPCs.
 */
export class ControlPlaneServer extends EventEmitter<ControlPlaneEvents> {
  private readonly logger: Logger;
  private readonly clients = new Map<string, ManagedClient>();
  private readonly sessionTasks = new Set<Promise<void>>();
  private tcpListener: TcpConfigServerListener | undefined;
  private wsListener: WsConfigServerListener | undefined;
  private wssListener: WsConfigServerListener | undefined;
  private udpListener: UdpConfigServerListener | undefined;
  private started = false;
  private readonly acceptLimiter: AcceptRateLimiter;
  private reaper: NodeJS.Timeout | undefined;

  constructor(private readonly options: ControlPlaneOptions = {}) {
    super();
    this.logger = options.logger ?? createLogger();
    this.acceptLimiter = new AcceptRateLimiter(options.acceptLimitPerMinute ?? 600);
  }

  async start(): Promise<ControlPlaneAddresses> {
    if (this.started) throw new Error("control plane already started");
    this.started = true;
    const host = this.options.host ?? "0.0.0.0";

    const tcpPort = this.options.tcpPort === undefined ? null : this.options.tcpPort;
    const wsPort = this.options.wsPort === undefined ? null : this.options.wsPort;
    const wss = this.options.wss ?? null;
    const udpPort = this.options.udpPort === undefined ? null : this.options.udpPort;

    if (tcpPort !== null) {
      this.tcpListener = new TcpConfigServerListener({
        host,
        port: tcpPort,
        logger: this.logger,
        onTransport: (transport) => void this.acceptTransport(transport),
      });
      await this.tcpListener.start();
    }
    if (wsPort !== null) {
      this.wsListener = new WsConfigServerListener({
        host,
        port: wsPort,
        logger: this.logger,
        onTransport: (transport) => void this.acceptTransport(transport),
      });
      await this.wsListener.start();
    }
    if (wss) {
      this.wssListener = new WsConfigServerListener({
        host,
        port: wss.port,
        logger: this.logger,
        tls: { certFile: wss.certFile, keyFile: wss.keyFile },
        onTransport: (transport) => void this.acceptTransport(transport),
      });
      await this.wssListener.start();
    }
    if (udpPort !== null) {
      this.udpListener = new UdpConfigServerListener({
        host,
        port: udpPort,
        logger: this.logger,
        sessionIdleTimeoutMs: this.options.udpSessionIdleTimeoutMs,
        onTransport: (transport) => void this.acceptTransport(transport),
      });
      await this.udpListener.start();
    }

    const heartbeatTimeoutMs = this.options.heartbeatTimeoutMs ?? 20_000;
    if (heartbeatTimeoutMs > 0) {
      const interval = Math.max(250, Math.min(5_000, Math.floor(heartbeatTimeoutMs / 3)));
      this.reaper = setInterval(() => this.reapSilentClients(), interval);
      this.reaper.unref?.();
    }

    return {
      tcpPort: this.tcpListener?.port ?? null,
      wsPort: this.wsListener?.port ?? null,
      wssPort: this.wssListener?.port ?? null,
      udpPort: this.udpListener?.port ?? null,
    };
  }

  /**
   * Closes tunnels that stopped heartbeating. A half-open connection cannot be
   * detected from the socket alone (the kernel keeps it "open" for a long
   * time), so application-level liveness is the practical signal.
   */
  reapSilentClients(now = Date.now()): number {
    const timeoutMs = this.options.heartbeatTimeoutMs ?? 20_000;
    const silent = findSilentClients(
      [...this.clients.values()],
      now,
      timeoutMs,
    );
    for (const client of silent) {
      this.logger.info("closing a silent config-server tunnel", {
        session: client.id,
        lastHeartbeatAt: client.lastHeartbeatAt,
        timeoutMs,
      });
      this.options.metrics?.inc(METRIC_NAMES.clientsReaped);
      client.close("heartbeat timeout");
    }
    return silent.length;
  }

  private async acceptTransport(transport: FrameTransport): Promise<void> {
    // Normalise IPv4-mapped IPv6 so one source cannot bypass the per-IP cap by
    // connecting over both address families.
    const remote = (transport.remoteAddress || "unknown").replace(/^::ffff:/, "");
    if (!this.acceptLimiter.allow(remote)) {
      this.logger.warn("config-server connection rate limit exceeded", { remote });
      this.options.metrics?.inc(METRIC_NAMES.clientRejected, { reason: "rate" });
      transport.close();
      return;
    }
    const maxConnections = this.options.maxConnections ?? 2_000;
    if (this.clients.size >= maxConnections) {
      this.logger.warn("config-server connection cap reached", {
        clients: this.clients.size,
        maxConnections,
      });
      this.options.metrics?.inc(METRIC_NAMES.clientRejected, { reason: "cap" });
      transport.close();
      return;
    }
    let link;
    try {
      link = await acceptLink(transport);
    } catch (error) {
      this.logger.warn("failed to establish config-server tunnel", {
        transport: transport.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      transport.close();
      return;
    }

    const session = new RpcSessionImpl(link.link);
    const client = new ManagedClient(session);
    this.clients.set(session.id, client);

    registerWebServerService(session, {
      supportEncryption: this.options.supportEncryption ?? true,
      onHeartbeat: (request, rpcSession) =>
        this.onHeartbeat(client, request, rpcSession),
    });

    session.on("request", (descriptor) => {
      this.logger.debug("rpc request", {
        session: session.id,
        service: descriptor.serviceName,
        method: descriptor.methodIndex,
      });
    });
    session.on("error", (error) => {
      this.logger.debug("rpc session error", { session: session.id, error: error.message });
    });

    this.logger.info("client connected", {
      session: session.id,
      transport: session.transportKind,
      secure: session.secure,
      remote: session.label,
    });
    this.options.metrics?.inc(METRIC_NAMES.clientSessions);
    this.emit("client-connected", client);

    const task = session
      .run()
      .catch((error: unknown) => {
        this.logger.debug("rpc session loop failed", {
          session: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.clients.delete(session.id);
        this.logger.info("client disconnected", {
          session: session.id,
          heartbeats: client.heartbeatCount,
          error: session.lastError?.message,
        });
        this.emit("client-disconnected", client);
        try {
          this.options.onClientClosed?.(client);
        } catch (error) {
          this.logger.warn("onClientClosed hook failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    this.sessionTasks.add(task);
    void task.finally(() => this.sessionTasks.delete(task));
  }

  private async onHeartbeat(
    client: ManagedClient,
    request: web.HeartbeatRequest,
    session: RpcSession,
  ): Promise<void> {
    if (this.options.onHeartbeat) {
      const snapshot = client.recordHeartbeat(request);
      this.logger.debug("heartbeat", {
        session: session.id,
        machineId: snapshot.machineId,
        hostname: snapshot.hostname,
        version: snapshot.easytierVersion,
        instances: snapshot.runningNetworkInstances.length,
      });
      this.options.metrics?.inc(METRIC_NAMES.heartbeats);
      await this.options.onHeartbeat(client, request, snapshot);
      this.emit("heartbeat", client, snapshot);
      return;
    }

    const allowed = this.options.allowedTokens ?? [];
    if (allowed.length > 0 && !allowed.includes(request.userToken)) {
      throw new Error(`unknown config-server token`);
    }
    const snapshot = client.recordHeartbeat(request);
    this.logger.debug("heartbeat", {
      session: session.id,
      machineId: snapshot.machineId,
      hostname: snapshot.hostname,
      version: snapshot.easytierVersion,
      instances: snapshot.runningNetworkInstances.length,
    });
    this.options.metrics?.inc(METRIC_NAMES.heartbeats);
    this.emit("heartbeat", client, snapshot);
  }

  /** Currently open client sessions (closed ones are removed). */
  listClients(): ManagedClient[] {
    return [...this.clients.values()].filter((client) => !client.isClosed);
  }

  /** Wait for a client session; by default one that has sent a heartbeat. */
  async waitForClient(
    options: {
      timeoutMs?: number;
      transportKind?: TransportKind;
      secure?: boolean;
      requireHeartbeat?: boolean;
    } = {},
  ): Promise<ManagedClient> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const requireHeartbeat = options.requireHeartbeat ?? true;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = this.listClients().find(
        (client) =>
          (!requireHeartbeat || client.heartbeatCount > 0) &&
          (options.transportKind === undefined || client.transportKind === options.transportKind) &&
          (options.secure === undefined || client.secure === options.secure),
      );
      if (match) return match;
      if (Date.now() >= deadline) {
        const summary = this.listClients().map((client) => ({
          transport: client.transportKind,
          secure: client.secure,
          heartbeats: client.heartbeatCount,
        }));
        throw new Error(
          `timed out waiting for config-server client (${JSON.stringify(options)}); ` +
            `sessions: ${JSON.stringify(summary)}`,
        );
      }
      await sleep(50);
    }
  }

  async stop(): Promise<void> {
    const clients = [...this.clients.values()];
    for (const client of clients) client.close("server shutting down");
    await Promise.allSettled([
      this.tcpListener?.stop(),
      this.wsListener?.stop(),
      this.wssListener?.stop(),
      this.udpListener?.stop(),
    ]);
    this.tcpListener = undefined;
    this.wsListener = undefined;
    this.wssListener = undefined;
    this.udpListener = undefined;
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = undefined;
    await Promise.allSettled([...this.sessionTasks]);
    this.started = false;
  }
}
