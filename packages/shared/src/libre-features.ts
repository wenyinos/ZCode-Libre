/**
 * ZCode-Libre 分支的厂商服务策略：默认关闭依赖厂商后端的服务。
 *
 * 集中定义的原因：这些开关散布在 UI、service、CLI 多个包中，若逐处硬编码默认值，
 * 跟随上游同步时必须在每个文件里辨认哪些是本分支的改动。集中到本文件后，同步时只需
 * 检查这里以及 UPSTREAM.md 登记的引用点。
 *
 * 遥测不在此处：它必须在编译期与进程启动早期就生效，运行时读取设置会有时序竞态，
 * 因此保留在 packages/shared/src/env.ts 的 ZCODE_TELEMETRY_ENABLED（已默认关闭）。
 *
 * 模型接入不受影响：用户通过设置页或登录页的 API Key 表单直接接入 GLM 等模型
 * （zai-standard-api / bigmodel-standard-api 模板直连 api.z.ai 与 open.bigmodel.cn），
 * 不依赖任何账号体系。
 */
export const LIBRE_VENDOR_SERVICES = {
  /**
   * 官方账号登录（z.ai / bigmodel OAuth）。关闭后渠道列表为空，模型改用 API Key 接入。
   * 自建部署可用 ZAI_OAUTH_ENABLED / BIGMODEL_OAUTH_ENABLED 覆盖。
   */
  officialAccountLogin: false,
  /** 会话分享：把对话打包上传到厂商的分享服务。 */
  conversationShare: false,
  /** 用户反馈：通过厂商接口提交工单与日志附件。 */
  feedback: false,
  /** Coding Plan 套餐购买与升级入口。 */
  codingPlanPurchase: false,
  /** 插件市场远端市场源：从厂商 CDN 拉取市场清单。内置插件不受影响。 */
  pluginMarketplaceRemoteSource: false,
  /**
   * 应用内更新改为检测自有 GitHub Release，并且只检测、不下载不安装：
   * 命中的是上游厂商 manifest 会把官方 ZCode 装回本分支，覆盖品牌与上述默认关闭设置，
   * 而本分支的桌面产物未做代码签名，应用内自动安装也会持续触发系统安全拦截。
   */
  selfHostedReleaseUpdates: true,
  /**
   * 社群入口：官方远端下发的 community_urls 指向厂商社群（飞书群 / 官方 Discord），
   * 本分支用户进去既拿不到对应支持，也会把本分支问题带进上游渠道。
   * 关闭后统一走 LIBRE_COMMUNITY_URL。属实现策略，不暴露给用户设置。
   */
  vendorCommunityLinks: false,
  /**
   * 官方账号派生凭据：官方客户端登录后写进共享 `.zcode` 的登录 JWT、OAuth token
   * 与账号级 api-key。本分支一并拒绝读取。
   *
   * 原因不是"少给功能"，而是这些凭据在本分支里注定半途而废：
   * 1) 官方开源版本身声明「不承诺提供官方产品的全部功能及活动政策」（NOTICE.md），
   *    用户借官方登录态进来，却拿不到自己在官方客户端里预期的那套套餐与活动；
   * 2) 登录 JWT 到期需要重新登录刷新，而本分支的登录入口是关的，会出现
   *    "能用一阵子、然后突然失效且无法自助恢复"的状态，比一开始就不能用更让人困惑。
   *
   * 用户要接入模型，请在「模型服务商」里填自己的 API Key。
   * 属实现策略，不暴露给用户设置。
   */
  officialAccountCredentials: false,
} as const;

/** 本分支自有社群入口：GitHub Discussions。 */
export const LIBRE_COMMUNITY_URL = "https://github.com/wenyinos/ZCode-Libre/discussions";

/**
 * 是否为官方账号派生凭据。
 *
 * 三类键都属于官方客户端登录的产物：登录 JWT、OAuth token 与用户信息、账号级凭据。
 * 注意 MCP 的 OAuth 键前缀是 `mcp:oauth:`，与这里的 `oauth:` 不冲突，不要写成包含匹配。
 */
export function isOfficialAccountCredentialKey(key: string): boolean {
  const normalized = key.trim();
  return (
    normalized === "zcodejwttoken" ||
    normalized.startsWith("oauth:") ||
    normalized.startsWith("account-provider:")
  );
}

/** 带用户开关的厂商服务。selfHostedReleaseUpdates 属实现策略，不暴露给用户。 */
export type VendorServiceId =
  | "officialAccountLogin"
  | "conversationShare"
  | "feedback"
  | "codingPlanPurchase"
  | "pluginMarketplaceRemoteSource";

/** 设置页可覆盖的厂商服务开关；留空沿用上面的分支默认值。 */
export interface VendorServiceSettingsOverride {
  vendorServiceSignInEnabled?: boolean;
  vendorServiceConversationShareEnabled?: boolean;
  vendorServiceFeedbackEnabled?: boolean;
  vendorServiceCodingPlanPurchaseEnabled?: boolean;
  vendorServicePluginMarketplaceEnabled?: boolean;
}

const SETTINGS_KEY_BY_SERVICE = {
  officialAccountLogin: "vendorServiceSignInEnabled",
  conversationShare: "vendorServiceConversationShareEnabled",
  feedback: "vendorServiceFeedbackEnabled",
  codingPlanPurchase: "vendorServiceCodingPlanPurchaseEnabled",
  pluginMarketplaceRemoteSource: "vendorServicePluginMarketplaceEnabled",
} as const satisfies Record<VendorServiceId, keyof VendorServiceSettingsOverride>;

/**
 * 解析厂商服务的有效开关：用户设置优先，未设置时回到分支默认值。
 *
 * 集中一个入口，避免各消费点各写一遍 `?? LIBRE_VENDOR_SERVICES.xxx`——
 * 漏写默认值就等于把服务重新打开，而这正是回归检查要防的问题。
 */
export function resolveVendorServiceEnabled(
  service: VendorServiceId,
  settings: VendorServiceSettingsOverride | null | undefined,
): boolean {
  const override = settings?.[SETTINGS_KEY_BY_SERVICE[service]];
  return typeof override === "boolean" ? override : LIBRE_VENDOR_SERVICES[service];
}

/**
 * 当前生效的厂商服务设置快照。
 *
 * 服务装配是同步的、设置读取是异步的，两者无法直接串联；这里维护进程内快照：
 * host 启动后异步刷新一次，各消费点同步读取。快照默认是 null，也就是
 * 「全部按策略默认（关闭）」——即使还没刷新，行为也已经是分支预期，不会误开服务。
 */
let vendorServiceSettingsSnapshot: VendorServiceSettingsOverride | null = null;

export function setVendorServiceSettingsSnapshot(
  settings: VendorServiceSettingsOverride | null,
): void {
  vendorServiceSettingsSnapshot = settings;
}

export function getVendorServiceSettingsSnapshot(): VendorServiceSettingsOverride | null {
  return vendorServiceSettingsSnapshot;
}

/** 消费点用这个同步入口，避免每个调用方各自解析默认值。 */
export function isVendorServiceEnabled(service: VendorServiceId): boolean {
  return resolveVendorServiceEnabled(service, vendorServiceSettingsSnapshot);
}
