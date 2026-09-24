#!/usr/bin/env node
/**
 * 默认关闭项的回归检查。
 *
 * 本分支走「保留上游代码、只关开关」的路线：不删遥测实现，靠默认值让它们不启用。
 * 代价是上游同步可能悄悄让开关失效——采样器被移出总开关、默认值被改回 true、
 * 更新源被指回厂商域名。这里把这些不变量固化成断言，供 CI 与本地检查使用。
 *
 * 用法：node scripts/check-defaults-regression.mjs
 * 退出码：0 全部通过；1 有断言失败（会列出文件与原因）
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relativePath) {
  try {
    return readFileSync(join(repoRoot, relativePath), "utf8");
  } catch (error) {
    failures.push(`${relativePath}: 无法读取（${error.code ?? "unknown"}）`);
    return null;
  }
}

/** 断言文件中存在某片段。 */
function expectContains(relativePath, snippet, reason) {
  const content = read(relativePath);
  if (content === null) return;
  if (!content.includes(snippet)) {
    failures.push(`${relativePath}: 缺少「${snippet}」—— ${reason}`);
  }
}

/** 断言文件中不存在某片段。 */
function expectAbsent(relativePath, snippet, reason) {
  const content = read(relativePath);
  if (content === null) return;
  if (content.includes(snippet)) {
    failures.push(`${relativePath}: 仍包含「${snippet}」—— ${reason}`);
  }
}

/** 断言没有任何一行匹配该正则。 */
function expectNoLineMatching(relativePath, pattern, reason) {
  const content = read(relativePath);
  if (content === null) return;
  const matched = content
    .split("\n")
    .map((line, index) => [line, index + 1])
    .filter(([line]) => pattern.test(line));
  for (const [line, lineNumber] of matched) {
    failures.push(`${relativePath}:${lineNumber}: 「${line.trim()}」—— ${reason}`);
  }
}

// ── 遥测：默认关闭，且采样器必须落在总开关内 ────────────────────────────────

expectAbsent(
  "packages/shared/src/env.ts",
  "export const ZCODE_TELEMETRY_ENABLED: boolean = true;",
  "遥测总开关又被写死为 true，运维未配置端点时也会初始化上报",
);
expectContains(
  "packages/shared/src/env.ts",
  'process.env.ZCODE_TELEMETRY_ENABLED',
  "遥测总开关应读运行时环境变量，保持默认关闭、可显式开启",
);

// 总开关块内的调用缩进为 4 空格；逃逸到块外的会退回 2 空格缩进。
expectNoLineMatching(
  "packages/desktop/src/main/index.ts",
  /^ {2}(configureDesktop\w*Telemetry|registerDesktop\w+|registerRendererHeapSampleIpc)\s*\(/,
  "遥测采样器/注册调用逃逸在 ZCODE_TELEMETRY_ENABLED 块之外，会在端点为空的部署里常驻",
);

expectAbsent(
  "packages/desktop/src/main/appCrashCaptureBootstrap.ts",
  "initializeCrashCapture(logger, true)",
  "崩溃采集硬编码为「ARMS 已接管」，遥测关闭时会连本地采集一起丢掉",
);

expectContains(
  "apps/zcode-cli/packages/telemetry/src/bootstrap.ts",
  "isExplicitlyEnabled",
  "CLI 模型遥测应由「未设置即启用」改为「必须显式启用」",
);
expectAbsent(
  "apps/zcode-cli/packages/telemetry/src/bootstrap.ts",
  "isExplicitlyDisabled(env.ZCODE_MODEL_TELEMETRY_ENABLED)",
  "CLI 模型遥测又回到「未设置即启用」的语义",
);

// ── 厂商服务：策略存在且默认关闭 ────────────────────────────────────────────

const libfFeaturesPath = "packages/shared/src/libre-features.ts";
for (const key of [
  "officialAccountLogin",
  "conversationShare",
  "feedback",
  "codingPlanPurchase",
  "pluginMarketplaceRemoteSource",
]) {
  expectContains(libfFeaturesPath, key, "策略项缺失，对应的厂商服务会失去默认关闭的约束");
}
expectContains(
  "packages/ui/src/settings/VendorServicesSection.tsx",
  "LIBRE_VENDOR_SERVICES",
  "设置页的厂商服务开关应引用策略模块作为默认值",
);

// 官方账号登录默认关闭，且保留显式开启的逃生舱。
// 实现可以写死 false，也可以引用策略常量；两种都表示默认关闭，但绝不能是 enabled: true。
for (const path of [
  "packages/services/src/oauth/providers/zaiProviderConfig.ts",
  "packages/services/src/oauth/providers/bigmodelProviderConfig.ts",
]) {
  expectAbsent(path, "enabled: true", "官方账号登录重新变为默认开启");
  expectContains(
    path,
    "LIBRE_VENDOR_SERVICES.officialAccountLogin",
    "官方账号登录的默认值应来自分支策略，避免与 libre-features.ts 分叉",
  );
}

// ── 应用内更新：只检测自有 Release，不回流厂商 ──────────────────────────────

expectContains(
  "packages/desktop/src/main/githubReleaseUpdates.ts",
  "wenyinos/ZCode-Libre",
  "自有 Release 检测应指向本仓库",
);
expectContains(
  "packages/desktop/src/main/autoUpdater.ts",
  "LIBRE_VENDOR_SERVICES.selfHostedReleaseUpdates",
  "更新检查应保留自有 Release 分流，否则会回落到厂商 manifest",
);
// 启动检查必须排在「自有 Release 分流」之后，那样它才不会被执行；
// 直接断言"不存在"会误报，这里比较两者出现的位置。
{
  const content = read("packages/desktop/src/main/autoUpdater.ts");
  if (content !== null) {
    const guardIndex = content.indexOf("LIBRE_VENDOR_SERVICES.selfHostedReleaseUpdates");
    const startupIndex = content.indexOf('triggerCheckForUpdates("startup")');
    const pollIndex = content.indexOf("autoUpdatePollTimer = setInterval");
    if (guardIndex < 0) {
      failures.push("packages/desktop/src/main/autoUpdater.ts: 缺少自有 Release 分流判定");
    } else {
      if (startupIndex >= 0 && startupIndex < guardIndex) {
        failures.push(
          "packages/desktop/src/main/autoUpdater.ts: 启动检查排在自有 Release 分流之前，会向厂商 manifest 发请求",
        );
      }
      if (pollIndex >= 0 && pollIndex < guardIndex) {
        failures.push(
          "packages/desktop/src/main/autoUpdater.ts: 小时轮询排在自有 Release 分流之前，会向厂商 manifest 发请求",
        );
      }
    }
  }
}

// ── 登录门禁：不得把 providerFamilyDomain 重新加回 ──────────────────────────

expectNoLineMatching(
  "packages/ui/src/root/useProviderAvailabilityLoginEntryGuard.ts",
  /shouldOpenLoginEntry\s*=\s*.*providerFamilyDomain/,
  "登录门禁又依赖 providerFamilyDomain，只用 API Key 的用户会再次被登录页拦截",
);

// ── 品牌：远端请求不得回落到厂商域名 ────────────────────────────────────────

expectAbsent(
  "packages/desktop/scripts/desktop-product-identity.mjs",
  "dev.zcode.app",
  "应用标识回落到上游 appId",
);

if (failures.length > 0) {
  console.error("默认关闭项检查未通过：\n");
  for (const failure of failures) {
    console.error(`  ✗ ${failure}`);
  }
  console.error(
    `\n共 ${failures.length} 项。这些不变量是分支的核心行为，修复后再提交；\n` +
      `若上游确实改变了实现方式，请同步更新本脚本与 UPSTREAM.md 的登记。`,
  );
  process.exit(1);
}

console.log("默认关闭项检查通过：遥测、厂商服务、登录门禁与更新源均保持本分支约定。");
