import { manage } from "@easyplane/proto";
import { protoToUuid, uuidToProto } from "@easyplane/shared";

import { WEB_CLIENT_SERVICE, WebClientMethod } from "../rpc/descriptors.js";
import { RpcSession } from "../rpc/session.js";

/**
 * Typed wrappers for the WebClientService methods the server calls on a
 * connected easytier-core client (easytier-proto/proto/api_manage.proto).
 */
export class RemoteWebClient {
  constructor(private readonly session: RpcSession) {}

  async validateConfig(config: manage.NetworkConfig): Promise<manage.ValidateConfigResponse> {
    const response = await this.session.call({
      descriptor: { ...WEB_CLIENT_SERVICE, methodIndex: WebClientMethod.ValidateConfig },
      payload: manage.ValidateConfigRequest.encode({ config }).finish(),
    });
    return manage.ValidateConfigResponse.decode(response);
  }

  async runNetworkInstance(request: {
    instId: string;
    config: manage.NetworkConfig;
    overwrite?: boolean;
    source?: manage.ConfigSource;
    timeoutMs?: number;
  }): Promise<manage.RunNetworkInstanceResponse> {
    const response = await this.session.call({
      descriptor: { ...WEB_CLIENT_SERVICE, methodIndex: WebClientMethod.RunNetworkInstance },
      payload: manage.RunNetworkInstanceRequest.encode({
        instId: uuidToProto(request.instId),
        config: request.config,
        overwrite: request.overwrite ?? false,
        source: request.source ?? manage.ConfigSource.ConfigSourceWeb,
      }).finish(),
      timeoutMs: request.timeoutMs ?? 15_000,
    });
    return manage.RunNetworkInstanceResponse.decode(response);
  }

  async retainNetworkInstance(instIds: string[]): Promise<manage.RetainNetworkInstanceResponse> {
    const response = await this.session.call({
      descriptor: { ...WEB_CLIENT_SERVICE, methodIndex: WebClientMethod.RetainNetworkInstance },
      payload: manage.RetainNetworkInstanceRequest.encode({
        instIds: instIds.map(uuidToProto),
      }).finish(),
    });
    return manage.RetainNetworkInstanceResponse.decode(response);
  }

  async collectNetworkInfo(instIds: string[]): Promise<manage.CollectNetworkInfoResponse> {
    const response = await this.session.call({
      descriptor: { ...WEB_CLIENT_SERVICE, methodIndex: WebClientMethod.CollectNetworkInfo },
      payload: manage.CollectNetworkInfoRequest.encode({
        instIds: instIds.map(uuidToProto),
      }).finish(),
    });
    return manage.CollectNetworkInfoResponse.decode(response);
  }

  async listNetworkInstance(): Promise<string[]> {
    const response = await this.session.call({
      descriptor: { ...WEB_CLIENT_SERVICE, methodIndex: WebClientMethod.ListNetworkInstance },
      payload: manage.ListNetworkInstanceRequest.encode({}).finish(),
    });
    return manage.ListNetworkInstanceResponse.decode(response).instIds.map(protoToUuid);
  }

  async deleteNetworkInstance(instIds: string[]): Promise<manage.DeleteNetworkInstanceResponse> {
    const response = await this.session.call({
      descriptor: { ...WEB_CLIENT_SERVICE, methodIndex: WebClientMethod.DeleteNetworkInstance },
      payload: manage.DeleteNetworkInstanceRequest.encode({
        instIds: instIds.map(uuidToProto),
      }).finish(),
    });
    return manage.DeleteNetworkInstanceResponse.decode(response);
  }

  async getNetworkInstanceConfig(instId: string): Promise<manage.GetNetworkInstanceConfigResponse> {
    const response = await this.session.call({
      descriptor: { ...WEB_CLIENT_SERVICE, methodIndex: WebClientMethod.GetNetworkInstanceConfig },
      payload: manage.GetNetworkInstanceConfigRequest.encode({
        instId: uuidToProto(instId),
      }).finish(),
    });
    return manage.GetNetworkInstanceConfigResponse.decode(response);
  }

  async listNetworkInstanceMeta(instIds: string[]): Promise<manage.ListNetworkInstanceMetaResponse> {
    const response = await this.session.call({
      descriptor: { ...WEB_CLIENT_SERVICE, methodIndex: WebClientMethod.ListNetworkInstanceMeta },
      payload: manage.ListNetworkInstanceMetaRequest.encode({
        instIds: instIds.map(uuidToProto),
      }).finish(),
    });
    return manage.ListNetworkInstanceMetaResponse.decode(response);
  }
}
