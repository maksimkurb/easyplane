import { createServer, type Server, type Socket } from "node:net";

import type { FrameTransport } from "../transport/frames.js";
import { tcpFrameTransport } from "../transport/frames.js";
import type { Logger } from "../logger.js";

export interface TcpConfigServerListenerOptions {
  host: string;
  port: number;
  logger: Logger;
  onTransport: (transport: FrameTransport) => void;
}

/** Plain TCP config-server listener (`tcp://host:port/<token>`). */
export class TcpConfigServerListener {
  private server: Server | undefined;
  private actualPort = 0;

  constructor(private readonly options: TcpConfigServerListenerOptions) {}

  async start(): Promise<number> {
    const server = createServer((socket: Socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, this.options.host, () => resolve());
    });
    server.on("error", (error) => this.options.logger.error("tcp listener error", { error: String(error) }));
    const address = server.address();
    this.actualPort = typeof address === "object" && address ? address.port : this.options.port;
    return this.actualPort;
  }

  private accept(socket: Socket): void {
    const label = `tcp://${socket.remoteAddress ?? "?"}:${socket.remotePort ?? 0}`;
    this.options.logger.debug("tcp connection accepted", { remote: label });
    // NOTE: the tunnel scheme clears the URL path for non-ws schemes, so the
    // token is only carried in HeartbeatRequest.user_token (see
    // easytier-core/src/management/full/web_client.rs).
    this.options.onTransport(tcpFrameTransport(socket, label));
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  get port(): number {
    return this.actualPort;
  }
}
