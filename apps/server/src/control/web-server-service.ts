import { web } from "@easyplane/proto";

import { WEB_SERVER_SERVICE, WebServerMethod } from "../rpc/descriptors.js";
import type { RpcSession } from "../rpc/session.js";

/**
 * Server half of the config-server control channel (WebServerService).
 * Upstream easytier-web registers exactly these two methods
 * (easytier-web/src/client_manager/session.rs + proto/web.proto).
 */
export interface WebServerServiceOptions {
  /**
   * Advertised in GetFeatureResponse. Clients with web-secure support then
   * reconnect and run the Noise handshake; clients built with
   * `--secure-mode` refuse to talk to a server that answers `false`.
   */
  supportEncryption: boolean;
  onHeartbeat: (request: web.HeartbeatRequest, session: RpcSession) => void | Promise<void>;
}

export function registerWebServerService(session: RpcSession, options: WebServerServiceOptions): void {
  session.register(WEB_SERVER_SERVICE, WebServerMethod.Heartbeat, async (body) => {
    const request = web.HeartbeatRequest.decode(body);
    await options.onHeartbeat(request, session);
    return web.HeartbeatResponse.encode({}).finish();
  });

  session.register(WEB_SERVER_SERVICE, WebServerMethod.GetFeature, async () => {
    return web.GetFeatureResponse.encode({ supportEncryption: options.supportEncryption }).finish();
  });
}
