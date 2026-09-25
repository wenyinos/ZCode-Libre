/**
 * 模型额度服务。
 *
 * 从用户已配置的 provider 中提取 API Key，按厂商查询余额或套餐余量。
 * 未配置凭证、凭证为空、或 baseUrl 识别不出厂商的 provider 一律跳过，
 * 所以界面上只会出现用户真正在用的厂商，不需要任何额外开关。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isApiKeyAccess } from "@zcode/provider";
import { PERSONAL_PROVIDER_CONFIG_FILE_NAME, decodeProviderConfigFile } from "@zcode/provider-node";
import type {
  ProviderBalanceEntry,
  ProviderBalanceSnapshot,
  ProviderBalanceVendorId,
} from "@zcode/shared";
import { getAppConfigDir } from "../paths.js";
import { queryVendorBalance, resolveBalanceVendor } from "./vendorBalances.js";

export interface ProviderBalanceService {
  getSnapshot(): Promise<ProviderBalanceSnapshot>;
}

export interface ProviderBalanceServiceOptions {
  /** 覆盖配置文件路径，主要供测试注入。 */
  readonly configFilePath?: string;
  readonly fetchImpl?: typeof fetch;
  readonly readFileImpl?: typeof readFile;
}

export const PROVIDER_BALANCE_VENDOR_LABELS: Record<ProviderBalanceVendorId, string> = {
  deepseek: "DeepSeek",
  "glm-cn": "GLM Coding (CN)",
  "glm-global": "GLM Coding (Global)",
  "kimi-cn": "Kimi (CN)",
  "kimi-global": "Kimi (Global)",
  "minimax-cn": "MiniMax (CN)",
  "minimax-global": "MiniMax (Global)",
  openrouter: "OpenRouter",
  "opencode-go": "OpenCode Go",
  commandcode: "Command Code",
};

interface ResolvedBalanceSource {
  providerId: string;
  providerName: string;
  apiKey: string;
  vendor: ProviderBalanceVendorId;
}

function resolveConfigFilePath(options: ProviderBalanceServiceOptions): string {
  const override = options.configFilePath?.trim();
  if (override) {
    return override;
  }
  const fromEnv = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE?.trim();
  return fromEnv || join(getAppConfigDir(), PERSONAL_PROVIDER_CONFIG_FILE_NAME);
}

/**
 * 解析出所有可查询额度的来源。
 * 配置文件缺失或损坏都按"没有配置 provider"处理，不抛错——额度展示不该影响主流程。
 */
export async function resolveBalanceSources(
  options: ProviderBalanceServiceOptions = {},
): Promise<ResolvedBalanceSource[]> {
  const read = options.readFileImpl ?? readFile;
  let content: string;
  try {
    content = await read(resolveConfigFilePath(options), "utf8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  let rules: ReturnType<typeof decodeProviderConfigFile>["providers"];
  try {
    rules = decodeProviderConfigFile(parsed).providers;
  } catch {
    return [];
  }

  const sources: ResolvedBalanceSource[] = [];
  for (const rule of rules.rules()) {
    const access = rule.config.access;
    if (!access || !isApiKeyAccess(access)) {
      continue;
    }
    const apiKey = access.apiKey?.trim();
    if (!apiKey) {
      continue;
    }
    const vendor = resolveBalanceVendorForRule(rule);
    if (!vendor) {
      continue;
    }
    sources.push({
      providerId: rule.providerId,
      providerName: rule.providerName?.trim() || PROVIDER_BALANCE_VENDOR_LABELS[vendor],
      apiKey,
      vendor,
    });
  }
  return sources;
}

/**
 * 识别一条 provider 规则对应的厂商。
 *
 * 模板型 provider（如内置的 opencode-go-*）规则里没有 baseUrl——地址在内置模板里，
 * 个人配置只记 templateId。这类只能靠模板 id 前缀识别；其余仍按 baseUrl 主机名判定。
 */
function resolveBalanceVendorForRule(rule: {
  templateId?: string | null;
  config: { api?: { baseUrl?: string | null } | null };
}): ProviderBalanceVendorId | null {
  const templateId = rule.templateId?.trim().toLowerCase() ?? "";
  // opencode-go-chat / -messages / -responses 三条模板同属 Go 产品线，共用同一个用量接口。
  if (templateId.startsWith("opencode-go")) {
    return "opencode-go";
  }
  return resolveBalanceVendor(rule.config.api?.baseUrl);
}

export function createProviderBalanceService(
  options: ProviderBalanceServiceOptions = {},
): ProviderBalanceService {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async getSnapshot(): Promise<ProviderBalanceSnapshot> {
      const sources = await resolveBalanceSources(options);
      const entries: ProviderBalanceEntry[] = await Promise.all(
        sources.map(async (source): Promise<ProviderBalanceEntry> => {
          const result = await queryVendorBalance(source.vendor, source.apiKey, fetchImpl);
          const base = {
            providerId: source.providerId,
            providerName: source.providerName,
            vendor: source.vendor,
          };
          if (result.error) {
            return { ...base, kind: "payg", error: result.error };
          }
          if (result.windows) {
            return { ...base, kind: "package", windows: result.windows };
          }
          return { ...base, kind: "payg", balances: result.balances ?? [] };
        }),
      );

      // 保持配置里的先后顺序，界面上同一个 provider 的额度位置稳定。
      const order = new Map(sources.map((source, index) => [source.providerId, index]));
      entries.sort(
        (left, right) => (order.get(left.providerId) ?? 0) - (order.get(right.providerId) ?? 0),
      );

      return { entries, fetchedAt: new Date().toISOString() };
    },
  };
}
