/**
 * 模型额度快照。
 *
 * 由用户已配置的 API Key 直接向各厂商查询余额或套餐余量，不经过厂商账号体系，
 * 也不需要额外开启任何开关：读取的是「设置 → 模型服务商」里已经填好的凭证。
 * 未配置凭证的厂商不会出现在结果中。
 */

/** 已支持的厂商。同一个厂商的境内/境外站点是两个独立端点。 */
export type ProviderBalanceVendorId =
  | "deepseek"
  | "glm-cn"
  | "glm-global"
  | "kimi-cn"
  | "kimi-global"
  | "minimax-cn"
  | "minimax-global"
  | "openrouter"
  | "opencode-go"
  | "commandcode"
  | "stepfun-cn"
  | "stepfun-global";

/** payg 为按量付费余额，package 为套餐额度窗口。 */
export type ProviderBalanceKind = "payg" | "package";

export type ProviderBalanceWindowName = "5h" | "weekly" | "monthly";

export interface ProviderBalanceAmount {
  currency: string;
  /** 总可用余额。 */
  total: number;
  /** 其中的赠送额度。 */
  granted?: number;
  /** 其中的充值额度。 */
  toppedUp?: number;
}

export interface ProviderBalanceWindow {
  name: ProviderBalanceWindowName;
  /** 已用百分比，0-100；由各厂商的「剩余」口径统一换算而来。 */
  usedPercent: number;
  /** 距窗口重置的秒数。 */
  resetInSec?: number;
}

export interface ProviderBalanceEntry {
  /** 本地 provider id，用于定位这条额度来自哪个配置项。 */
  providerId: string;
  /** 界面上展示的 provider 名称。 */
  providerName: string;
  vendor: ProviderBalanceVendorId;
  kind: ProviderBalanceKind;
  /** 按量付费厂商的余额，可能多币种。 */
  balances?: ProviderBalanceAmount[];
  /** 套餐厂商的额度窗口；未上报的窗口不出现。 */
  windows?: ProviderBalanceWindow[];
  /** 查询失败时的可读原因；成功时不出现。 */
  error?: string;
}

export interface ProviderBalanceSnapshot {
  entries: ProviderBalanceEntry[];
  /** 本次查询时间（ISO 字符串），供界面展示"更新于"。 */
  fetchedAt: string;
}
