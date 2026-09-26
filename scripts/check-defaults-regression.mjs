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
import ts from "typescript";

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

// ── 厂商服务：策略默认值必须逐项断言 ────────────────────────────────────────
//
// 只断言「键名存在」守不住这条不变量：把 false 改成 true 同样能通过，而「厂商服务与
// 官方账号派生凭据默认关闭」正是本分支的核心行为。这里用语法树读出对象字面量的字面量
// 值逐项比对，并把未登记的新增策略项视为失败——否则新增的开关会悄悄逃过约束。

const libfFeaturesPath = "packages/shared/src/libre-features.ts";

/** 期望的默认值；键集合同时是「已登记」的边界，新增策略项必须出现在这里。 */
const LIBRE_VENDOR_SERVICE_DEFAULTS = {
  officialAccountLogin: false,
  conversationShare: false,
  feedback: false,
  codingPlanPurchase: false,
  pluginMarketplaceRemoteSource: false,
  selfHostedReleaseUpdates: true,
  vendorCommunityLinks: false,
  officialAccountCredentials: false,
};

/** 剥掉 `as const` / 括号等包装，取到真正的表达式。 */
function unwrapExpression(node) {
  let current = node;
  while (
    current !== undefined &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

/** 读出对象字面量各属性的字面量值；布尔按布尔返回，其余取源码文本。 */
function readObjectLiteralValues(sourceText, variableName) {
  const sourceFile = ts.createSourceFile(variableName, sourceText, ts.ScriptTarget.Latest, true);
  let literal = null;
  const findLiteral = (node) => {
    if (
      literal === null &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (initializer !== undefined && ts.isObjectLiteralExpression(initializer)) {
        literal = initializer;
      }
    }
    ts.forEachChild(node, findLiteral);
  };
  findLiteral(sourceFile);
  if (literal === null) return null;
  const values = new Map();
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name.getText(sourceFile);
    const initializer = property.initializer;
    if (initializer.kind === ts.SyntaxKind.TrueKeyword) values.set(key, true);
    else if (initializer.kind === ts.SyntaxKind.FalseKeyword) values.set(key, false);
    else values.set(key, initializer.getText(sourceFile));
  }
  return values;
}

{
  const content = read(libfFeaturesPath);
  if (content !== null) {
    const defaults = readObjectLiteralValues(content, "LIBRE_VENDOR_SERVICES");
    if (defaults === null) {
      failures.push(
        `${libfFeaturesPath}: 找不到 LIBRE_VENDOR_SERVICES 对象字面量 —— 策略总表被改写或改名，请同步更新本脚本与 UPSTREAM.md`,
      );
    } else {
      for (const [key, expected] of Object.entries(LIBRE_VENDOR_SERVICE_DEFAULTS)) {
        const actual = defaults.get(key);
        if (!defaults.has(key)) {
          failures.push(`${libfFeaturesPath}: 缺少策略项 ${key} —— 对应的服务或凭据门禁会失去依据`);
        } else if (actual !== expected) {
          failures.push(
            `${libfFeaturesPath}: ${key} 的默认值是 ${String(actual)}，本分支要求 ${String(expected)} ——「默认关闭」是分支核心行为，不要改回`,
          );
        }
      }
      for (const key of defaults.keys()) {
        if (!Object.hasOwn(LIBRE_VENDOR_SERVICE_DEFAULTS, key)) {
          failures.push(
            `${libfFeaturesPath}: 新增策略项 ${key} 未登记 —— 请在 check-defaults-regression.mjs 里声明它的期望默认值`,
          );
        }
      }
    }
  }
}
expectContains(
  "packages/ui/src/settings/VendorServicesSection.tsx",
  "LIBRE_VENDOR_SERVICES",
  "设置页的厂商服务开关应引用策略模块作为默认值",
);

// 反馈入口必须逐处门禁：漏掉任何一处，关闭状态下仍会露出一个注定失败的按钮，
// 而它提交的目标是厂商工单系统。
for (const path of [
  "packages/ui/src/WorkspaceHelpMenuButton.tsx",
  "packages/ui/src/ChatErrorBanner.tsx",
  "packages/ui/src/quickpick/quickPickCommands.ts",
]) {
  expectContains(
    path,
    "LIBRE_VENDOR_SERVICES.feedback",
    "反馈入口应受策略门禁，否则默认关闭状态下仍会暴露厂商反馈入口",
  );
}

// 社群入口只认本分支自有地址，不再接受厂商远端下发的 community_urls。
// 只断言门禁存在：上游的远端优先分支按设计保留在开关之后，默认走不到。
expectContains(
  "packages/shared/src/remoteAppConfig.ts",
  "LIBRE_COMMUNITY_URL",
  "社群入口应固定指向本分支自有入口，避免被厂商远端配置覆盖",
);
expectContains(
  "packages/shared/src/remoteAppConfig.ts",
  "LIBRE_VENDOR_SERVICES.vendorCommunityLinks",
  "社群入口解析缺少分支策略门禁，厂商远端配置会重新生效",
);

// 「紫夜」主题在桌面 Linux 必须走纯色：Electron 在原生 Wayland 下拿不到带 alpha 的窗口
// surface，半透明 token 会被合成器压成实心深紫，透明只在 macOS/Windows 成立。
expectContains(
  "packages/ui/src/styles.css",
  "html.platform-linux-desktop.theme-zai-dusk",
  "桌面 Linux 的纯色回退丢失，紫夜主题会重新变成拿不到透明的半透明配色",
);

// 官方账号登录默认关闭：渠道列表在服务端被过滤成空，UI 侧还留着入口的话，
// 点开只会落到「没有可用登录提供方」的空页面，模型改用 API Key 接入。
for (const [path, reason] of [
  [
    "packages/ui/src/quickpick/quickPickCommands.ts",
    "命令面板的「登录」命令应受策略门禁，否则默认关闭时会露出一个打不开的空页面",
  ],
  [
    "packages/ui/src/WelcomeScreen.tsx",
    "登录面板应受策略门禁，否则可能被切到没有可用渠道的官方登录视图",
  ],
  [
    "packages/ui/src/Root.tsx",
    "账号菜单的「登录」入口应受策略门禁，否则默认关闭时仍会露出官方账号入口",
  ],
]) {
  expectContains(path, "LIBRE_VENDOR_SERVICES.officialAccountLogin", reason);
}

// 官方账号派生凭据必须在存储层就被挡住。只关登录入口不够：官方客户端把登录 JWT
// 与账号级 api-key 写进共享的 .zcode，不拦存储层的话本分支仍会借官方登录态跑套餐，
// 而开源版不承诺官方产品的功能与活动政策，且 JWT 到期这里无法自助刷新。
// 策略项本身的存在与默认值由上面的 LIBRE_VENDOR_SERVICE_DEFAULTS 断言覆盖。
for (const [path, reason] of [
  [
    "packages/services/src/credential/credentialService.ts",
    "Services 侧凭据存储未拦截官方账号派生凭据",
  ],
  [
    "apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts",
    "CLI 侧凭据存储未拦截官方账号派生凭据",
  ],
]) {
  expectContains(path, "isOfficialAccountCredentialKey", reason);
}

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
