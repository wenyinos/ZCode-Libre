/* eslint-disable max-lines -- 各厂商端点集中一处便于与参考实现逐条对照；拆文件要把解析辅助函数复制多份。 */
/**
 * 各厂商的额度查询实现。
 *
 * endpoint 与响应字段路径参考 DeepSeekBalanceMonitor 的实测结果。Command Code 需要先取组织
 * id 再查额度，OpenCode Go 只回百分比，两者都多一次请求或多一步换算，已在各自实现处注明。
 *
 * 所有解析都按「拿不到就报错」处理：字段缺失、信封 code 非 0、金额无法解析都会返回可读错误，
 * 而不是把 0 当成余额展示。
 */
import type {
  ProviderBalanceAmount,
  ProviderBalanceVendorId,
  ProviderBalanceWindow,
} from "@zcode/shared";

const REQUEST_TIMEOUT_MS = 10_000;

export interface VendorBalanceQueryResult {
  balances?: ProviderBalanceAmount[];
  windows?: ProviderBalanceWindow[];
  error?: string;
}

/**
 * 从 provider 的 baseUrl 识别厂商；识别不出时返回 null，该 provider 不展示额度。
 *
 * 只有 opencode.ai 需要看路径：Go 与 Zen 两个产品线共用这个域名，用量接口只在 Go 上。
 */
export function resolveBalanceVendor(
  baseUrl: string | null | undefined,
): ProviderBalanceVendorId | null {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return null;
  }
  let host: string;
  let pathname: string;
  try {
    const parsed = new URL(trimmed);
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "api.deepseek.com") return "deepseek";
  if (host.endsWith("bigmodel.cn")) return "glm-cn";
  if (host.endsWith("z.ai")) return "glm-global";
  if (host.endsWith("moonshot.cn")) return "kimi-cn";
  if (host.endsWith("moonshot.ai")) return "kimi-global";
  if (host.endsWith("minimaxi.com")) return "minimax-cn";
  if (host.endsWith("minimax.io")) return "minimax-global";
  if (host.endsWith("openrouter.ai")) return "openrouter";
  if (host.endsWith("opencode.ai")) return pathname.startsWith("/zen/go") ? "opencode-go" : null;
  if (host.endsWith("commandcode.ai")) return "commandcode";
  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** 金额可能是 JSON number 或数字字符串（DeepSeek 返回字符串）。 */
function readAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** 重置时间可能是秒或毫秒 epoch，也可能是 ISO 字符串。 */
function readResetInSeconds(value: unknown, now: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // 大于 1e11 视为毫秒（1e11 秒约为公元 5138 年，不可能出现）。
    const ms = value >= 1e11 ? value : value * 1000;
    return Math.max(0, Math.round((ms - now) / 1000));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round((parsed - now) / 1000));
    }
  }
  return undefined;
}

async function requestJson(
  url: string,
  apiKey: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string; status?: number }> {
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // 错误正文里通常有可读原因，但不同厂商结构不同，这里只保留状态码，避免把上游原文透传到界面。
      return { ok: false, error: `http-${response.status}`, status: response.status };
    }
    const parsed = readRecord(await response.json());
    return parsed ? { ok: true, body: parsed } : { ok: false, error: "invalid-response" };
  } catch {
    return { ok: false, error: "network-unreachable" };
  }
}

async function queryDeepSeek(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<VendorBalanceQueryResult> {
  const result = await requestJson(
    "https://api.deepseek.com/user/balance",
    apiKey,
    { method: "GET" },
    fetchImpl,
  );
  if (!result.ok) {
    return { error: result.error };
  }
  const infos = readArray(result.body.balance_infos);
  if (!infos || infos.length === 0) {
    return { error: "invalid-response" };
  }
  const balances: ProviderBalanceAmount[] = [];
  for (const raw of infos) {
    const info = readRecord(raw);
    const currency = info && typeof info.currency === "string" ? info.currency : null;
    const total = info ? readAmount(info.total_balance) : null;
    if (!currency || total === null) {
      continue;
    }
    const granted = readAmount(info?.granted_balance);
    const toppedUp = readAmount(info?.topped_up_balance);
    balances.push({
      currency,
      total,
      ...(granted !== null ? { granted } : {}),
      ...(toppedUp !== null ? { toppedUp } : {}),
    });
  }
  return balances.length > 0 ? { balances } : { error: "invalid-response" };
}

/**
 * 智谱 Coding Plan：两个站点的响应结构一致。
 * 窗口没有名字字段，按 limits 数组顺序识别：第 1 个 TOKENS_LIMIT 是 5h，第 2 个是 weekly，
 * TIME_LIMIT 是 monthly（统计的是 MCP 工具调用次数，不是 token）。
 */
async function queryGlm(
  apiKey: string,
  vendor: Extract<ProviderBalanceVendorId, "glm-cn" | "glm-global">,
  fetchImpl: typeof fetch,
): Promise<VendorBalanceQueryResult> {
  const url =
    vendor === "glm-cn"
      ? "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
      : "https://api.z.ai/api/monitor/usage/quota/limit";
  let result = await requestJson(url, apiKey, { method: "GET" }, fetchImpl);
  // 该端点对部分 Key 类型要求裸 key（不带 Bearer 前缀），与上游实现保持一致：401 时重试一次。
  if (!result.ok && result.status === 401) {
    result = await requestJson(
      url,
      apiKey,
      { method: "GET", headers: { Authorization: apiKey } },
      fetchImpl,
    );
  }
  if (!result.ok) {
    return { error: result.error };
  }
  const code = result.body.code;
  if (typeof code === "number" && code !== 0 && code !== 200) {
    return { error: "invalid-response" };
  }
  const data = readRecord(result.body.data);
  const limits = data ? readArray(data.limits) : null;
  if (!limits) {
    return { error: "invalid-response" };
  }
  const now = Date.now();
  const windows: ProviderBalanceWindow[] = [];
  let tokenLimitCount = 0;
  for (const raw of limits) {
    const limit = readRecord(raw);
    const type = limit && typeof limit.type === "string" ? limit.type : null;
    const used = limit ? readAmount(limit.percentage) : null;
    if (!type || used === null) {
      continue;
    }
    const resetInSec = readResetInSeconds(limit?.nextResetTime, now);
    if (type === "TOKENS_LIMIT") {
      const name = tokenLimitCount === 0 ? "5h" : "weekly";
      tokenLimitCount += 1;
      windows.push({ name, usedPercent: clampPercent(used), ...(resetInSec !== undefined ? { resetInSec } : {}) });
    } else if (type === "TIME_LIMIT") {
      windows.push({ name: "monthly", usedPercent: clampPercent(used), ...(resetInSec !== undefined ? { resetInSec } : {}) });
    }
  }
  return windows.length > 0 ? { windows } : { error: "invalid-response" };
}

/** Kimi / Moonshot 余额；币种不来自响应，按站点推断。 */
async function queryKimi(
  apiKey: string,
  vendor: Extract<ProviderBalanceVendorId, "kimi-cn" | "kimi-global">,
  fetchImpl: typeof fetch,
): Promise<VendorBalanceQueryResult> {
  const url =
    vendor === "kimi-cn"
      ? "https://api.moonshot.cn/v1/users/me/balance"
      : "https://api.moonshot.ai/v1/users/me/balance";
  const result = await requestJson(url, apiKey, { method: "GET" }, fetchImpl);
  if (!result.ok) {
    return { error: result.error };
  }
  if (result.body.status !== true) {
    return { error: "invalid-response" };
  }
  const data = readRecord(result.body.data);
  const total = data ? readAmount(data.available_balance) : null;
  if (total === null) {
    return { error: "invalid-response" };
  }
  const granted = readAmount(data?.voucher_balance);
  const toppedUp = readAmount(data?.cash_balance);
  return {
    balances: [
      {
        currency: vendor === "kimi-cn" ? "CNY" : "USD",
        total,
        ...(granted !== null ? { granted } : {}),
        ...(toppedUp !== null ? { toppedUp } : {}),
      },
    ],
  };
}

/** MiniMax Token Plan；接口给的是剩余百分比，这里统一换算成已用。 */
async function queryMiniMax(
  apiKey: string,
  vendor: Extract<ProviderBalanceVendorId, "minimax-cn" | "minimax-global">,
  fetchImpl: typeof fetch,
): Promise<VendorBalanceQueryResult> {
  const origin = vendor === "minimax-cn" ? "https://www.minimaxi.com" : "https://www.minimax.io";
  const result = await requestJson(
    `${origin}/v1/token_plan/remains`,
    apiKey,
    { method: "GET" },
    fetchImpl,
  );
  if (!result.ok) {
    return { error: result.error };
  }
  const data = readRecord(result.body.data);
  const remains = (data ? readArray(data.model_remains) : null) ?? readArray(result.body.model_remains);
  if (!remains || remains.length === 0) {
    return { error: "invalid-response" };
  }
  // 有 general 条目时优先它，否则取第一条。
  const entries = remains.map(readRecord).filter((item): item is Record<string, unknown> => item !== null);
  const chosen = entries.find((item) => item.model_name === "general") ?? entries[0];
  if (!chosen) {
    return { error: "invalid-response" };
  }
  const now = Date.now();
  const windows: ProviderBalanceWindow[] = [];
  const intervalRemaining = readAmount(chosen.current_interval_remaining_percent);
  if (intervalRemaining !== null) {
    const resetInSec = readResetInSeconds(chosen.end_time, now);
    windows.push({
      name: "5h",
      usedPercent: clampPercent(100 - intervalRemaining),
      ...(resetInSec !== undefined ? { resetInSec } : {}),
    });
  }
  const weeklyRemaining = readAmount(chosen.current_weekly_remaining_percent);
  if (weeklyRemaining !== null) {
    const resetInSec = readResetInSeconds(chosen.weekly_end_time, now);
    windows.push({
      name: "weekly",
      usedPercent: clampPercent(100 - weeklyRemaining),
      ...(resetInSec !== undefined ? { resetInSec } : {}),
    });
  }
  return windows.length > 0 ? { windows } : { error: "invalid-response" };
}

/** OpenRouter 账户余额；需要 Management Key，普通推理 Key 会被拒。 */
async function queryOpenRouter(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<VendorBalanceQueryResult> {
  const result = await requestJson(
    "https://openrouter.ai/api/v1/credits",
    apiKey,
    { method: "GET" },
    fetchImpl,
  );
  if (!result.ok) {
    return { error: result.error };
  }
  const data = readRecord(result.body.data);
  const totalCredits = data ? readAmount(data.total_credits) : null;
  const totalUsage = data ? readAmount(data.total_usage) : null;
  if (totalCredits === null || totalUsage === null) {
    return { error: "invalid-response" };
  }
  return {
    balances: [
      {
        currency: "USD",
        total: Math.max(0, totalCredits - totalUsage),
        toppedUp: totalCredits,
      },
    ],
  };
}

/**
 * OpenCode Go 订阅用量。
 *
 * 接口只回百分比和重置时间，没有金额字段：官方文档把三个池描述成额度金额，但响应里给不到，
 * 这里就按接口实际有的字段展示百分比，不拿文档数字反推金额。
 */
async function queryOpenCodeGo(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<VendorBalanceQueryResult> {
  const result = await requestJson(
    "https://opencode.ai/zen/go/v1/usage",
    apiKey,
    { method: "GET" },
    fetchImpl,
  );
  if (!result.ok) {
    return { error: result.error };
  }
  const usage = readRecord(result.body.usage);
  if (!usage) {
    return { error: "invalid-response" };
  }
  const now = Date.now();
  const windows: ProviderBalanceWindow[] = [];
  const entries = [
    ["5h", usage.rolling],
    ["weekly", usage.weekly],
    ["monthly", usage.monthly],
  ] as const;
  for (const [name, raw] of entries) {
    const window = readRecord(raw);
    const percent = window ? readAmount(window.percent) : null;
    if (percent === null) {
      continue;
    }
    const resetInSec = readResetInSeconds(window?.resetsAt, now);
    windows.push({
      name,
      usedPercent: clampPercent(percent),
      ...(resetInSec !== undefined ? { resetInSec } : {}),
    });
  }
  return windows.length > 0 ? { windows } : { error: "invalid-response" };
}

/**
 * Command Code 计划额度：先查组织 id，再查 credits。
 *
 * 月度池不是接口字段：接口给的是 5h/weekly 的 used/cap 与剩余月度积分，
 * 月度总额度按 (5h cap, weekly cap) 这组唯一键查档位表反推
 * （档位来自官方用量说明，每个套餐的这对 cap 都不重复）。
 * 未知套餐（含纯充值账户）不展示月度，避免把猜出来的数字当成事实。
 */
const COMMAND_CODE_MONTHLY_POOLS: ReadonlyArray<readonly [number, number, number]> = [
  [3, 6, 10], // Go
  [14, 35, 70], // GOAT
  [16, 40, 80], // Pro
  [45, 90, 150], // Max 10x
  [90, 180, 300], // Max 20x
  [12, 24, 40], // Team Pro
];

function readCommandCodeMonthlyCap(fiveHourCap: number, weeklyCap: number): number | null {
  const fiveHour = Math.round(fiveHourCap);
  const weekly = Math.round(weeklyCap);
  const matched = COMMAND_CODE_MONTHLY_POOLS.find(
    ([fiveHourKey, weeklyKey]) => fiveHourKey === fiveHour && weeklyKey === weekly,
  );
  return matched ? matched[2] : null;
}

async function queryCommandCode(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<VendorBalanceQueryResult> {
  const apiBase = "https://api.commandcode.ai";
  // whoami 只为拿组织 id。账号没有组织时该接口会失败，此时退回不带 orgId 的查询。
  let orgQuery = "";
  const whoami = await requestJson(`${apiBase}/alpha/whoami`, apiKey, { method: "GET" }, fetchImpl);
  if (whoami.ok) {
    const org = readRecord(whoami.body.org);
    const orgId = org && typeof org.id === "string" ? org.id.trim() : "";
    if (orgId) {
      orgQuery = `?orgId=${encodeURIComponent(orgId)}`;
    }
  }

  const result = await requestJson(
    `${apiBase}/alpha/billing/credits${orgQuery}`,
    apiKey,
    { method: "GET" },
    fetchImpl,
  );
  if (!result.ok) {
    return { error: result.error };
  }
  const limits = readRecord(result.body.windowLimits);
  if (!limits) {
    return { error: "invalid-response" };
  }
  const credits = readRecord(result.body.credits);
  const now = Date.now();
  const windows: ProviderBalanceWindow[] = [];
  let fiveHourCap: number | null = null;
  let weeklyCap: number | null = null;
  const entries = [
    ["5h", limits.fiveHour],
    ["weekly", limits.weekly],
  ] as const;
  for (const [name, raw] of entries) {
    const window = readRecord(raw);
    const used = window ? readAmount(window.used) : null;
    const cap = window ? readAmount(window.cap) : null;
    if (used === null || cap === null || cap <= 0) {
      continue;
    }
    if (name === "5h") {
      fiveHourCap = cap;
    } else {
      weeklyCap = cap;
    }
    const resetInSec = readResetInSeconds(window?.resetAt, now);
    windows.push({
      name,
      usedPercent: clampPercent((Math.max(0, used) / cap) * 100),
      ...(resetInSec !== undefined ? { resetInSec } : {}),
    });
  }

  const monthlyCredits = credits ? readAmount(credits.monthlyCredits) : null;
  if (fiveHourCap !== null && weeklyCap !== null && monthlyCredits !== null) {
    const monthlyCap = readCommandCodeMonthlyCap(fiveHourCap, weeklyCap);
    if (monthlyCap !== null && monthlyCap > 0) {
      windows.push({
        name: "monthly",
        usedPercent: clampPercent(((monthlyCap - monthlyCredits) / monthlyCap) * 100),
      });
    }
  }
  return windows.length > 0 ? { windows } : { error: "invalid-response" };
}

export async function queryVendorBalance(
  vendor: ProviderBalanceVendorId,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VendorBalanceQueryResult> {
  // 去掉粘贴时可能带入的空白与非 ASCII 脏字节，否则服务端会直接 401。
  const key = apiKey.replace(/[^\x21-\x7e]/g, "");
  if (!key) {
    return { error: "missing-api-key" };
  }
  switch (vendor) {
    case "deepseek":
      return await queryDeepSeek(key, fetchImpl);
    case "glm-cn":
    case "glm-global":
      return await queryGlm(key, vendor, fetchImpl);
    case "kimi-cn":
    case "kimi-global":
      return await queryKimi(key, vendor, fetchImpl);
    case "minimax-cn":
    case "minimax-global":
      return await queryMiniMax(key, vendor, fetchImpl);
    case "openrouter":
      return await queryOpenRouter(key, fetchImpl);
    case "opencode-go":
      return await queryOpenCodeGo(key, fetchImpl);
    case "commandcode":
      return await queryCommandCode(key, fetchImpl);
  }
}
