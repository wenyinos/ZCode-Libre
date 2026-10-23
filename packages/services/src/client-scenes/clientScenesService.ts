import type { ApiClient } from "@zcode/shared";
import { readApiJson } from "../providers/api/apiJson.js";
import { ZCODE_CLIENT_SCENES_URL } from "../providers/api/apiEndpoints.js";
import type { ClientScenesResponse, IClientScenesService } from "./clientScenes.js";

export function createClientScenesService(dependencies: {
  apiClient: ApiClient;
}): IClientScenesService {
  return {
    list: () =>
      readApiJson<ClientScenesResponse>(dependencies.apiClient, ZCODE_CLIENT_SCENES_URL, {
        method: "GET",
      }),
  };
}

/**
 * 客户端场景固定关闭时的实现：不请求厂商接口，建议提示与自动化模板保持为空。
 */
export function createDisabledClientScenesService(): IClientScenesService {
  return {
    list: async () => ({ code: 0, msg: "", data: [] }),
  };
}
