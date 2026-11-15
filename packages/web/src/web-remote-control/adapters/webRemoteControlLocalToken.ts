const SESSION_KEY_PREFIX = "zcode-web-remote-session:";

/** 手机端本地远控的配对材料；云端模式返回 undefined，token 客户端保持原 JWT 路径。 */
export interface WebRemoteControlLocalTokenStore {
  getPairCode(): string | null;
  getSessionToken(): string | null;
  setSessionToken(token: string): void;
}

function isPrivateHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value))) {
    return false;
  }
  const [a = -1, b = -1] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * 只有从桌面内置 relay 同源加载的页面才是本地模式：
 * URL 带 pairing code，或页面本身跑在私有地址上（桌面重启后二维码参数可能被清掉）。
 * 云端 `/remote/v4` 保持 undefined，避免把 `pair` 参数当成云端登录凭据。
 */
export function createWebRemoteControlLocalTokenStore(options: {
  href: string;
  storage: Pick<Storage, "getItem" | "setItem">;
}): WebRemoteControlLocalTokenStore | undefined {
  let url: URL;
  try {
    url = new URL(options.href);
  } catch {
    return undefined;
  }
  const pairCode = url.searchParams.get("pair")?.trim() || null;
  if (!pairCode && !isPrivateHostname(url.hostname)) return undefined;
  const storageKey = `${SESSION_KEY_PREFIX}${url.origin}`;
  return {
    getPairCode: () => pairCode,
    getSessionToken: () => {
      try {
        return options.storage.getItem(storageKey)?.trim() || null;
      } catch {
        return null;
      }
    },
    setSessionToken: (token: string) => {
      try {
        options.storage.setItem(storageKey, token);
      } catch {
        // 隐私模式等禁用 localStorage 时只影响跨刷新重连，不阻断当前配对。
      }
    },
  };
}
