import { createLogger } from "./logger.js";
import { ControlPlaneServer } from "./control/control-plane.js";

function parsePort(value: string | undefined, fallback: number | null): number | null {
  if (value === undefined || value === "") return fallback;
  if (value === "off" || value === "false") return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port: ${value}`);
  }
  return port;
}

async function main(): Promise<void> {
  const logger = createLogger({ level: (process.env.EASYPLANE_LOG_LEVEL as "info" | undefined) ?? "info" });
  const tokens = (process.env.EASYPLANE_TOKENS ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const secureSetting = (process.env.EASYPLANE_SECURE ?? "on").toLowerCase();
  if (secureSetting === "off" && (process.env.EASYPLANE_REQUIRE_SECURE ?? "") === "1") {
    throw new Error("EASYPLANE_SECURE=off conflicts with EASYPLANE_REQUIRE_SECURE=1");
  }

  const wssPort = parsePort(process.env.EASYPLANE_WSS_PORT, null);
  const certFile = process.env.EASYPLANE_TLS_CERT;
  const keyFile = process.env.EASYPLANE_TLS_KEY;
  if (wssPort !== null && (!certFile || !keyFile)) {
    throw new Error("EASYPLANE_WSS_PORT requires EASYPLANE_TLS_CERT and EASYPLANE_TLS_KEY");
  }

  const server = new ControlPlaneServer({
    host: process.env.EASYPLANE_HOST ?? "0.0.0.0",
    tcpPort: parsePort(process.env.EASYPLANE_TCP_PORT, 22020),
    wsPort: parsePort(process.env.EASYPLANE_WS_PORT, 22023),
    wss: wssPort !== null && certFile && keyFile ? { port: wssPort, certFile, keyFile } : null,
    supportEncryption: secureSetting !== "off",
    allowedTokens: tokens,
    logger,
  });

  server.on("client-connected", (client) => {
    logger.info("client session opened", { id: client.id, transport: client.transportKind });
  });
  server.on("client-disconnected", (client) => {
    logger.info("client session closed", { id: client.id, heartbeats: client.heartbeatCount });
  });
  server.on("heartbeat", (client, heartbeat) => {
    if (client.heartbeatCount === 1) {
      logger.info("first heartbeat", {
        id: client.id,
        machineId: heartbeat.machineId,
        hostname: heartbeat.hostname,
        version: heartbeat.easytierVersion,
        os: heartbeat.deviceOs,
      });
    }
  });

  const addresses = await server.start();
  logger.info("easyplane control plane listening", { ...addresses });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("shutting down", { signal });
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "fatal",
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exit(1);
});
