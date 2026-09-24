/**
 * 自有 Release 的更新检测。
 *
 * ZCode-Libre 的应用内更新只做一件事：查询本仓库的 GitHub Release 判断是否有新版本，
 * 然后在界面上引导用户前往下载页 —— 不在应用内下载或安装。
 *
 * 两点原因：
 * 1. 上游的更新清单来自厂商 manifest，安装它会把官方 ZCode 装回本分支，覆盖品牌与
 *    默认关闭的厂商服务设置；
 * 2. 本分支的桌面产物未做代码签名，应用内自动安装会持续触发系统安全拦截。
 */
import semver from "semver";
import { logger } from "./logger.js";

/** 本分支的 Release 仓库，与应用内"检查更新"的目标保持一致。 */
export const SELF_HOSTED_RELEASE_REPOSITORY = "wenyinos/ZCode-Libre";

const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${SELF_HOSTED_RELEASE_REPOSITORY}/releases/latest`;
const REQUEST_TIMEOUT_MS = 10_000;

export interface SelfHostedReleaseInfo {
  /** 去掉 v 前缀的版本号，如 3.14.4。 */
  version: string;
  /** 原始 tag，如 v3.14.4。 */
  tagName: string;
  /** Release 页面地址，用户在这里自行下载对应平台安装包。 */
  downloadUrl: string;
  releaseNotes?: string;
  publishedAt?: string;
}

export type SelfHostedReleaseCheckOutcome =
  | { kind: "up-to-date"; currentVersion: string }
  | { kind: "available"; currentVersion: string; release: SelfHostedReleaseInfo }
  | { kind: "error"; message: string };

/** candidate 是否比 baseline 新。任一侧无法解析时返回 false，宁可漏报不误报。 */
export function isReleaseNewerThan(candidate: string, baseline: string): boolean {
  const next = semver.valid(semver.coerce(candidate));
  const current = semver.valid(semver.coerce(baseline));
  if (!next || !current) {
    return false;
  }
  return semver.gt(next, current);
}

function readStringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 查询本仓库最新 Release 并与当前版本比较。
 * 网络失败、限流、响应结构异常都收敛为 error 结果，由调用方展示，不抛出。
 */
export async function checkSelfHostedRelease(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SelfHostedReleaseCheckOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(GITHUB_LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        // GitHub API 要求有 User-Agent，否则直接 403。
        "User-Agent": "ZCode-Libre-Update-Check",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(`[self-update] 查询自有 Release 失败: ${String(error)}`);
    return { kind: "error", message: "network-unreachable" };
  }

  if (response.status === 404) {
    // 尚未发布任何 Release：视为已是最新，不打扰用户。
    logger.info("[self-update] 仓库暂无 Release");
    return { kind: "up-to-date", currentVersion };
  }
  if (!response.ok) {
    logger.warn(`[self-update] 查询自有 Release 返回 ${response.status}`);
    return { kind: "error", message: `http-${response.status}` };
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    logger.warn(`[self-update] Release 响应解析失败: ${String(error)}`);
    return { kind: "error", message: "invalid-response" };
  }

  const tagName = readStringField(payload, "tag_name");
  const downloadUrl = readStringField(payload, "html_url");
  if (!tagName || !downloadUrl) {
    logger.warn("[self-update] Release 缺少 tag_name 或 html_url");
    return { kind: "error", message: "invalid-response" };
  }

  const version = tagName.replace(/^v/i, "");
  if (!isReleaseNewerThan(version, currentVersion)) {
    return { kind: "up-to-date", currentVersion };
  }

  const release: SelfHostedReleaseInfo = {
    version,
    tagName,
    downloadUrl,
    releaseNotes: readStringField(payload, "body"),
    publishedAt: readStringField(payload, "published_at"),
  };
  logger.info(`[self-update] 发现新版本 ${tagName}（当前 ${currentVersion}）`);
  return { kind: "available", currentVersion, release };
}
