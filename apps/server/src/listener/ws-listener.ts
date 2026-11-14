import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Socket } from "node:net";

import { WebSocketServer } from "ws";

import type { FrameTransport, TransportKind } from "../transport/frames.js";
import { websocketFrameTransport } from "../transport/frames.js";
import type { Logger } from "../logger.js";

export interface WsConfigServerListenerOptions {
  host: string;
  port: number;
  logger: Logger;
  tls?: { certFile: string; keyFile: string } | undefined;
  onTransport: (transport: FrameTransport) => void;
}

/**
 * ws:// / wss:// config-server listener.
 *
 * For websocket schemes the client keeps the token as the last URL path segment
 * (easytier-core/src/management/full/web_client.rs), so any path is accepted and
 * handed to the tunnel layer for logging/association. Authentication remains
 * the HeartbeatRequest.user_token; the path is advisory in M0.
 */
export class WsConfigServerListener {
  private httpServer: HttpServer | undefined;
  private wsServer: WebSocketServer | undefined;
  private actualPort = 0;
  private readonly kind: TransportKind;

  constructor(private readonly options: WsConfigServerListenerOptions) {
    this.kind = options.tls ? "wss" : "ws";
  }

  async start(): Promise<number> {
    const { tls } = this.options;
    const httpServer = tls
      ? createHttpsServer({
          cert: readFileSync(tls.certFile),
          key: readFileSync(tls.keyFile),
        })
      : createHttpServer();

    httpServer.on("request", (_req, res) => {
      res.writeHead(426, { "content-type": "text/plain" });
      res.end("websocket upgrade required\n");
    });

    const wsServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    httpServer.on("upgrade", (request, socket, head) => {
      wsServer.handleUpgrade(request, socket as Socket, head, (ws) => {
        const remote = `${request.socket.remoteAddress ?? "?"}:${request.socket.remotePort ?? 0}`;
        const path = request.url ?? "/";
        const label = `${this.kind}://${remote}${path}`;
        this.options.logger.debug("websocket connection accepted", { remote: label });
        this.options.onTransport(websocketFrameTransport(ws, this.kind, label));
      });
    });

    this.httpServer = httpServer;
    this.wsServer = wsServer;

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(this.options.port, this.options.host, () => resolve());
    });

    const address = httpServer.address();
    this.actualPort = typeof address === "object" && address ? address.port : this.options.port;
    return this.actualPort;
  }

  async stop(): Promise<void> {
    const httpServer = this.httpServer;
    const wsServer = this.wsServer;
    this.httpServer = undefined;
    this.wsServer = undefined;
    for (const client of wsServer?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(() => resolve());
    });
  }

  get port(): number {
    return this.actualPort;
  }
}
