import {
  WEB_REMOTE_CONTROL_RELAY_V2_HTTP,
  WebRemoteControlV2ConnectionError,
  parseWebRemoteControlRelayV2HttpResponse,
} from "@zcode/shared/web-remote-relay";
import { withWebRemoteControlHttpSignal } from "#src/web-remote-control/adapters/webRemoteControlHttpSignal.js";
import type { WebRemoteControlLocalTokenStore } from "#src/web-remote-control/adapters/webRemoteControlLocalToken.js";

function readSessionToken(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const token = (data as { sessionToken?: unknown }).sessionToken;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

/**
 * 一次性 token 不缓存；401 交给入口恢复登录，网络故障交给 transport 退避。
 *
 * 本地模式下不再使用官方 JWT：已有 sessionToken 时用它重连，首次配对用 pairing code；
 * 响应里的 sessionToken 写回本地存储，后续刷新和断线重连都不再消费配对码。
 */
export function createWebRemoteControlV2TokenClient(
  origin: string,
  fetcher = fetch,
  localStore?: WebRemoteControlLocalTokenStore,
) {
  return async (jwt: string, signal: AbortSignal): Promise<string> => {
    const sessionToken = localStore?.getSessionToken() ?? null;
    const pairCode = sessionToken ? null : (localStore?.getPairCode() ?? null);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (localStore) {
      if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
    } else {
      headers.Authorization = `Bearer ${jwt}`;
    }
    const body =
      localStore && pairCode
        ? JSON.stringify({ role: "terminal", pairCode })
        : JSON.stringify({ role: "terminal" });
    try {
      return await withWebRemoteControlHttpSignal(signal, async (requestSignal) => {
        const response = await fetcher(
          new URL(WEB_REMOTE_CONTROL_RELAY_V2_HTTP.token.path, origin),
          {
            method: "POST",
            headers,
            body,
            signal: requestSignal,
            redirect: "error",
          },
        );
        if (response.status === 401) throw new WebRemoteControlV2ConnectionError("auth-required");
        if (!response.ok)
          throw new WebRemoteControlV2ConnectionError("relay-unavailable", response.status >= 500);
        // 读取正文也可能断网或超时，必须交给外层网络重试；只有完整但非法的 JSON 才是终态。
        const text = await response.text();
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          throw new WebRemoteControlV2ConnectionError("relay-unavailable");
        }
        const result = parseWebRemoteControlRelayV2HttpResponse("token", value);
        if (!result || result.code !== 0 || !result.data)
          throw new WebRemoteControlV2ConnectionError("relay-unavailable");
        if (localStore) {
          const nextSessionToken = readSessionToken(value);
          if (nextSessionToken) localStore.setSessionToken(nextSessionToken);
        }
        return result.data.token;
      });
    } catch (error) {
      // 不传播 fetch/服务端正文，避免一次性 token 与 JWT 进入 UI 或诊断日志。
      if (error instanceof WebRemoteControlV2ConnectionError) throw error;
      throw new WebRemoteControlV2ConnectionError("relay-unavailable", true);
    }
  };
}
