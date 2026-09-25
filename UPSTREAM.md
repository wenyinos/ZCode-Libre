# 与上游同步

ZCode-Libre 是 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的分支。本文件记录本分支相对上游的**全部故意偏离**，以及同步上游更新的流程。改动集中在少数文件，目的是让 `git merge upstream/main` 的冲突可枚举、可预期。

## 远端

```bash
git remote -v
# origin    https://github.com/<你的账号>/ZCode-Libre   （本分支）
# upstream  https://github.com/zai-org/ZCode            （上游，只读用于同步）
```

若 upstream 不存在：

```bash
git remote add upstream https://github.com/zai-org/ZCode
```

## 同步流程

```bash
# --no-tags 是必须的：上游与本分支用同一套 v3.14.x tag 名，但指向不同提交。
# 带 tags 抓取会让上游的同名 tag 与本地已有 tag 撞名（git 不会覆盖已存在的 tag），
# 于是本地 v3.14.3 可能指向上游的 29628c9 而不是本分支的发布提交，
# 之后按 tag 生成 changelog、比对发布基线都会算错。
git fetch upstream --no-tags

# 1) 先审计：列出上游待合入提交，并标出动了本分支偏离文件的那些
pnpm audit:upstream               # 加 --strict 可在有高危提交时以退出码 1 结束

git merge upstream/main          # 或按需 git rebase upstream/main

# 2) 解决冲突（热点文件见下节）
#    注意 package.json 的 version：本分支只对齐上游的大版本线，patch 位自己走，
#    冲突时保留本分支的值，别接受上游的 patch 号：
node -p "require('./package.json').version"
# 3) 上游新文案仍写着 ZCode，用脚本补齐品牌名
python3 scripts/apply-brand-naming.py --check    # 列出遗留项，退出码 1 表示有遗留
python3 scripts/apply-brand-naming.py --write    # 补齐

# 4) 回归验证：默认关闭项是否仍成立
pnpm check:defaults              # 遥测、厂商服务、登录门禁、更新源
pnpm typecheck
pnpm lint
```

若上游更新了 `public/logo/` 之外的图标源或应用名，另需检查下节「品牌资源」与「产品身份」。

### 版本号：只对齐大版本线，patch 自己走

`package.json` 的 `version` 由本分支维护（用户 2026-09-24 明确要求）。规则：

- **`major.minor` 对齐上游的发布线**（当前 `3.14`）。上游升到 `3.15` 时才跟着换前两段。
- **`patch` 位是本分支自己的递增计数**，不跟随上游的 patch 号。本分支的补丁、品牌与默认关闭设置不与上游同步发布，跟上游 patch 号会让产物名与实际包含的改动对不上。
- 合并上游时若 `package.json` 的 `version` 冲突，**保留本分支的值**；合并后按上面的命令确认没被改回上游值。
- 必须是**标准 semver 三段式**。四段式（如 `3.14.3.1`）会让应用内更新检测失效：`packages/desktop/src/main/githubReleaseUpdates.ts` 用 `semver.coerce` 解析，`3.14.3.1` 被截断成 `3.14.3`，与上一版比较会判定为"已是最新"，连续的四段版本之间也无法排序。
- `version` 同时决定产物文件名（`ZCode-Libre-<version>-<平台>-<架构>.<ext>`），改它等于改发布产物命名，见下节「产品身份」。

## 偏离上游的改动清单

### 1. 产品身份（打包与系统集成）

| 文件 | 改动 |
| --- | --- |
| `packages/desktop/scripts/desktop-product-identity.mjs` | `appId` → `dev.zcode-libre.app`；`productName` → `ZCode-Libre`；`linuxExecutableName`/`linuxPackageName` → `zcode-libre`；Preview 身份同步加 `-libre`；开发态 AUMID → `dev.zcode-libre.app.development` |
| `packages/desktop/scripts/devElectronAppBundle.mjs` | 开发态 app name 与 bundle id 改用 ZCode-Libre |
| `packages/desktop/package.json` | `description`、`author`、`productName` 改用 ZCode-Libre |
| `packages/desktop/electron-builder.config.js` | `extraMetadata.homepage` 指向本仓库、`author`/`maintainer` 换为本分支；`WINDOWS_INSTALL_MANIFEST_NAME` → `.zcode-libre-install-manifest`；Windows 回退应用名 → `ZCode-Libre` |
| `packages/desktop/build/installer.nsh` | 安装/卸载日志文件名与 `ZCODE_INSTALL_MANIFEST_NAME` 默认值加 `-libre`；`DetailPrint` 前缀改为 `ZCode-Libre:` |
| `packages/desktop/src/main/desktopLinuxDeepLinkRegistration.ts` | `.desktop` 文件名 → `zcode-libre.desktop`；归属标记 → `Comment=ZCode-Libre`（**只清理本分支自己的条目，不触碰官方安装**）；默认 `productName`/`iconName` 跟进 |

### 2. 运行时身份与数据路径（**关键**）

`packages/desktop/src/main/desktopRuntimeEnv.ts` 中 `runtimeApplicationName` 同时决定三处：窗口标题、`app.setName` / `process.title`，以及 Electron `userData` 目录（`app.setPath("userData", join(appData, runtimeApplicationName))`）。

显示名按运行态取值：生产 `ZCode-Libre`、本地开发 `ZCode-Libre Dev`、Preview 身份 `ZCode-Libre Preview`；`userData` 目录同名（如 `~/.config/ZCode-Libre`、`~/Library/Application Support/ZCode-Libre`）。

**与上游共享的部分**：`.zcode` 数据根由 `packages/services/src/paths.ts` 决定，**未做改动**。两侧共用同一份会话库（`~/.zcode/cli/db/db.sqlite`）、设置（`~/.zcode/v2/setting.json`）、凭据与登录 token，因此装上本分支即可直接读到官方客户端的对话与模型设置。

**各自独立的部分**：Electron `userData` 目录下的 UI 偏好（`Local Storage/` 中的主题、语言、面板布局、字号、通知开关等）、内置浏览器与 Coding Plan 内嵌页在 `Partitions/*` 下的登录态、`remote-assets-cache/`。由此两个客户端**可以同时运行**（单实例锁按 `userData` 目录生效），也避免两边版本分叉后共用 Electron 缓存与存储格式。

两侧同时运行时，`.zcode` 层的 SQLite 会话库仍是共用的；代码已有写锁与重试提示（"等待其他 ZCode 或 CLI 进程"），不会静默损坏，但不宜高频交替写入。

若要改回与官方共用 `userData`，把 `runtimeUserDataPath` 的目录名改回上游命名（`ZCode` / `ZCode Dev` / `ZCode Preview`）即可，`.zcode` 数据根不受影响。

### 3. 用户可见文案

| 文件 | 改动 |
| --- | --- |
| `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts` | 文案中的 ZCode → ZCode-Libre |
| `apps/zcode-cli/packages/i18n/src/locales/{zh-CN,en-US}.ts` | 同上 |
| `packages/shared/src/desktopMenu.ts` | 关于/托盘菜单文案 |
| `packages/web/src/main.tsx` | `document.title` |
| `packages/web/src/share/ConversationShareLandingPage.tsx` | 分享落地页文案 |
| `packages/desktop/src/renderer/index.html`、`packages/web/index.html` | `<title>` 与内联 favicon |
| `packages/desktop/src/main/about.ts` | 关于窗应用名、标题、版权行（保留 Z.AI 原始版权，注明本分支） |
| `packages/desktop/src/host/browserControlMainBridge.ts` | 内置浏览器显示名 |
| `packages/shared/src/plugin-display-name.ts` | 插件名规范化表 |

前四类的批量改写由 `scripts/apply-brand-naming.py` 维护，同步上游后直接重跑。

### 4. 对外请求标识

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/zcode-source-headers.ts` | `User-Agent`、`X-Title` 改用 ZCode-Libre |
| `packages/shared/src/openrouter-attribution.ts` | `X-OpenRouter-Title` 改用 ZCode-Libre |
| `apps/zcode-cli/packages/bootstrap/src/model-config.ts` | CLI 的 `User-Agent`、`X-Title` |

`X-ZCode-App-Version` 等自定义头**名称**保持不变，它们是服务端可能读取的协议字段。

### 5. 品牌资源

| 路径 | 说明 |
| --- | --- |
| `public/logo/zcode-libre.svg` | 唯一源文件：圆形底 + 青蓝渐变三段式 Z |
| `scripts/generate-logo-assets.py` | 由源文件生成全部位图 |
| `public/logo/icons/`、`public/icon_512@2x.png`、`packages/desktop/build/`、`packages/web/public/favicon.ico` | 生成产物，不要手改 |

上游若替换图标源，按本分支标志重新生成，不要并入上游的 `icon.png` / `icon.icns` / `icon.ico` / `icons/`。

### 6. 本分支新增文件

`UPSTREAM.md`、`scripts/generate-logo-assets.py`、`scripts/apply-brand-naming.py`、`public/logo/zcode-libre.svg`、`packages/ui/src/assets/brand/zcode-libre-mark.svg`，以及重写后的 `README.md` / `README.en.md`。这些与上游无冲突，但 README 在内联 favicon 与徽标段落上可能产生冲突。

### 7. 默认关闭的遥测与厂商服务

路线是**默认关闭、不删代码**：上游的新功能代码照常合入，行为由少量开关与默认值决定。改动分散在多个包，因此策略集中登记在 `packages/shared/src/libre-features.ts`（唯一的策略真相源），各处只引用它。

**遥测（编译期，必须在启动早期生效，故不放在策略模块）**

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/env.ts` | `ZCODE_TELEMETRY_ENABLED` 由硬编码 `true` 改为读环境变量、默认关闭（`1/true/on/yes/enabled` 才开启） |
| `packages/desktop/src/main/index.ts` | 把原先逃逸在总开关之外的 `configureDesktopMcpTelemetry` / `registerDesktopStabilityMonitors` / `registerDesktopResourceTelemetry` / `registerRendererHeapSampleIpc` / `registerDesktopZCodeDataSizeTelemetry` / `registerDesktopNetworkTelemetry` 全部并入 `if (ZCODE_TELEMETRY_ENABLED && ZCODE_ARMS_RUM_ENDPOINT)` 块 |
| `packages/desktop/src/main/appCrashCaptureBootstrap.ts` | `initializeCrashCapture(logger, true)` 的硬编码 `true` 改为按实际遥测状态取值，遥测关闭时走纯本地 crashReporter（不上传） |
| `apps/zcode-cli/packages/telemetry/src/bootstrap.ts` | `isExplicitlyDisabled` 反转为 `isExplicitlyEnabled`：模型遥测由"未设置即启用"改为"必须显式启用" |

注意 `index.ts` 那处：上游把采样器注册放在总开关之外，其中 `desktopZCodeDataSizeTelemetry` 的 report 回调直接调用 `armsRum.sendCustom` 且没有初始化守卫，是本分支必须覆盖的点。上游若调整该块结构，同步时需重新确认所有 `register*` 调用都在开关内。

**厂商服务（运行期，统一引用策略模块）**

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/libre-features.ts`（新增） | 策略真相源：`officialAccountLogin` / `conversationShare` / `feedback` / `codingPlanPurchase` / `pluginMarketplaceRemoteSource` 默认全为 false，`selfHostedReleaseUpdates` 为 true |
| `packages/services/src/oauth/providers/{zai,bigmodel}ProviderConfig.ts` | OAuth provider 的 `enabled` 默认值改引用策略；仍可用 `ZAI_OAUTH_ENABLED` / `BIGMODEL_OAUTH_ENABLED` 覆盖开启 |
| `packages/shared/src/plugin-marketplaces.ts` | `DEFAULT_PLUGIN_MARKETPLACES` 默认不播种远端市场源；**`DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS` 未改动** |
| `packages/services/src/node.ts` | 会话分享复用 `createUnsupportedConversationShareService` |
| `packages/services/src/feedback/feedbackHttpClient.ts` | 在所有反馈请求的唯一出口 `request()` 处截断（附件先取凭证再直传 OSS，因此一并阻断） |
| `packages/ui/src/settings/CodingPlanUpgradeDialogProvider.tsx` | `openCodingPlanUpgrade` 统一守卫处早退 |

**刻意没有改的**：`DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS` 里是 browser-use、documents、pdf、spreadsheets 等**内置能力插件**，清空会让用户失去全部本地功能，因此保留；`computer-use` 本就默认关闭。官方 MCP 需要 z.ai 账号凭据，登录屏蔽后已自然失效，无需额外改动。

### 8. 屏蔽官方账号登录，改用 API Key

| 文件 | 改动 |
| --- | --- |
| `packages/ui/src/root/useProviderAvailabilityLoginEntryGuard.ts` | 门禁由 `!providerFamilyDomain \|\| (!user && !hasUsableProvider)` 改为 `!user && !hasUsableProvider`。**这是本分支最关键的一处产品行为修正**：上游在未设置 provider family domain 时无条件弹登录页，导致只用 API Key 的用户每次启动都被拦截 |
| `packages/ui/src/WelcomeScreen.tsx` | 登录页默认 `loginMode` 改为 `apiKey`；无可用 OAuth 渠道时不传 `onCancel` |
| `packages/ui/src/login/LoginApiKeyForm.tsx` | `onCancel` 改为可选，未传时不渲染返回按钮 |
| `packages/ui/src/i18n/locales/*` | `login.oauth.noProviders` 由"服务不可用，请稍后重试"改为引导使用 API Key；`login.description` 由"连接账号"改为"配置模型服务" |

模型接入路径未改动：`config/provider/zcode-builtin.json` 的 `zai-standard-api`（`https://api.z.ai/api/paas/v4`）与 `bigmodel-standard-api`（`https://open.bigmodel.cn/api/paas/v4`）是纯 API Key 直连。注意 `zai-api` / `bigmodel-api`（`zhipu-coding-plan-api-key` + anthropic 端点）会被 `official-coding-plan-gateway.ts` 改写到 zcode.z.ai 网关做权益校验，**不是直连**；如需完全绕开厂商网关，应引导用户使用 standard 模板。

### 9. UI 应用品牌位

`packages/ui/src/assets/brand/zcode-libre-mark.svg`（新增，透明底 + 渐变 Z，方形画布）替换三处**应用品牌位**：`App.tsx` 的 `appLogoUrl`、`WindowsTopLeftLogo.tsx`、`WorkspaceSidebar/WorkspaceSidebarCollapsedRail.tsx`（消费点 `DesktopTopOverlay.tsx`）。

**保留** `packages/ui/src/assets/provider-icons/logo-zai.svg` 及其在 `lib/oauthProviderIcon.tsx`、`settings/model-provider-section/ProviderLogo.tsx` 中的用法——那里代表 provider 品牌，不是应用自身标识。上游若更新该图标，直接并入即可。

### 10. 新增主题：紫夜（透明）

本分支新增一套用户可选主题 `zai-dusk`。色板取自 Zed 的 Nightfox 主题包中 `Duskfox - blurred` 变体：桌面端使用真透明背景（根背景 55%、侧栏 65%、结构面 72% 不透明），由 Electron 的 vibrancy / acrylic / 透明窗口透出桌面；Web 端因为无底层可透，用纯色覆盖。

| 文件 | 改动 |
| --- | --- |
| `packages/ui/src/styles.css` | 新增 `.theme-zai-dusk` 变量块；以及 `html[data-zcode-browser-theme-surface].theme-zai-dusk` 覆盖块，把背景类 token 在浏览器环境改为纯色 |
| `packages/ui/src/useTheme.ts` | `Theme` 类型、`resolveTheme`（dusk 属深色）、`applyTheme` 的 class 切换、`isTheme` 校验 |
| `packages/ui/src/settings/settingsPageConfig.ts` | `THEME_MODES` 增加一项（设置页外观选择器） |
| `packages/ui/src/WorkspaceSidebarFooter.tsx`、`WorkspaceSidebar.tsx`、`SettingsPage.tsx` | 菜单项与主题值校验 |
| `packages/web/src/webThemeSeed.ts`、`packages/web/src/main.tsx`、`packages/web/index.html` | Web 端主题种子类型、class 切换、启动壳深浅判定（漏掉会让首屏按浅色渲染并闪白底） |
| `packages/desktop/src/renderer/src/main.tsx`、`resource-manager.tsx` | 桌面启动期与资源管理器窗口的主题判定与 class 切换 |
| `packages/ui/src/openWorkspacePageThemeHero.tsx` | 新主题的 mesh 视觉参数 |
| `packages/ui/src/ToolCallBlocks/renderers/EditInlineDiffContent.tsx`、`components/ai-elements/{mermaid-block,message}.tsx` | 深色判断补上 dusk |
| `DESIGN.md` | Theme Modes 章节 |
| i18n（zh-CN / en-US） | `settings.themeMode.zai-dusk`、`sidebar.settings.theme.zai-dusk` |

同步注意：上游若新增主题枚举点（新的主题入口或独立窗口），需一并列出 `zai-dusk`。**凡是直接比较主题名来判断深浅色的代码都必须显式包含该值**；走 `resolveTheme()` 的无需改动。`openWorkspacePageThemeHero` 与 `codingPlanEmbeddedWebview` 用的是 `resolveTheme`，已自动兜底。

### 11. 应用内更新：检测自有 Release，不下载不安装

上游的更新清单来自厂商 manifest（`/api/v1/releases/electron/manifest`），给出的是官方 ZCode 版本；在应用内下载安装会把官方版本装回本分支，覆盖品牌与默认关闭设置，且本分支桌面产物未做代码签名，自动安装也会持续触发系统拦截。因此本分支的更新链路只做**检测**，由用户前往 Release 页面自行下载。

| 文件 | 改动 |
| --- | --- |
| `packages/desktop/src/main/githubReleaseUpdates.ts`（新增） | 查询 `wenyinos/ZCode-Libre` 的 GitHub Release，用 semver 比较版本；网络失败/限流/结构异常一律收敛为 `error`，无 Release 时按"已是最新"处理；`fetchImpl` 可注入便于测试 |
| `packages/desktop/src/main/autoUpdater.ts` | `checkForUpdateMenuClick` 在打包态检查前排分流到 `runSelfHostedReleaseCheck`；`autoInstallOnAppQuit` 在该模式下恒为 false；init 末尾跳过 electron-updater 的启动检查与轮询；菜单重放 `available` 时带上 `downloadUrl` |
| `packages/shared/src/update.ts` | `UpdateCheckResultPayload.available` 与 `UpdateStatePayload["update-available"]` 新增可选 `downloadUrl` |
| `packages/ui/src/UpdateStatusDialog{,Controller}.tsx` | 有 `downloadUrl` 时主按钮改为「前往下载」并 `openExternal`，隐藏无意义的自动下载开关；自动下载副作用不再触发 |

**保留未删**：`manifestUpdateProvider.ts` 与 electron-updater 的其余集成仍在（策略置 false 即可回退到上游行为）。

同步注意：
- 上游若改动 `initAutoUpdater` 的自动检查/轮询结构，需确认跳过分支仍在轮询启动之前，否则会重新向厂商发请求。
- `checkForUpdateMenuClick` 的分流必须留在 `canUseAutoUpdaterInCurrentRuntime()` 之后、各 `menuState` 分支之前。
- 该功能只在打包态生效（开发态走 `dev-skipped`），验证需要实际打包产物。

### 12. 新增功能：模型额度显示

用用户**已配置的 API Key** 查询各厂商余额与套餐余量，未配置凭证的厂商自动隐藏，不依赖账号体系也不需要额外开关。这一节是本分支新增、上游没有对应实现，同步时不会冲突，但要注意：

| 文件 | 说明 |
| --- | --- |
| `packages/shared/src/provider-balance.ts`（新增） | 额度快照类型 |
| `packages/services/src/provider-balance/vendorBalances.ts`（新增） | 8 个厂商端点的查询与解析，字段路径取自 DeepSeekBalanceMonitor 的实测结果 |
| `packages/services/src/provider-balance/providerBalanceService.ts`（新增） | 读取 `~/.zcode/v2/provider_config.json`，按 baseUrl 识别厂商并聚合 |
| `packages/services/src/provider-balance/providerBalance.ts`（新增） | 服务 descriptor |
| `packages/ui/src/settings/usage-stats/ProviderBalancePanel.tsx`（新增）、`hooks/useProviderBalance.ts`（新增） | 额度面板与数据 hook |
| `channels.ts` / `accessor.ts` / `index.ts` / `node.ts` / `remoteServiceAccess.ts` | 服务接线：通道、访问器字段、导出、注册、远程代理 |

同步注意：上游若调整 provider 配置的文件结构或 `decodeProviderConfigFile` 的返回形状，需同步 `resolveBalanceSources`；上游新增服务时，`IServiceAccessor` 与 `RemoteServiceAccess` 都要补齐字段，否则类型检查会报缺属性。

## 有意保持与上游一致

以下标识**不要改名**，它们是跨端契约，改动会破坏与既有服务端、协议及用户既有项目的兼容性：

- `zcode://` 协议 scheme（OAuth 回调 `zcode://oauth/callback` 已在服务端注册）
- `@zcode/*` workspace 包 scope
- `ZCODE_*` 环境变量前缀（对外文档与 CI 已依赖）
- `.zcode` 数据根目录，含用户项目里的 `.zcode/config.json`、`.zcode/agents`、`.zcode/workflows`
- `zcode` CLI 命令名与分发目录名
- `packages/shared/src/process-names.ts` 的 `ZCODE_PROCESS_PREFIX = "zcode"`（多处按 `zcode-host` / `zcode-agent` 前缀匹配进程）
- `packages/zcode-cua/broker-helper-constants.js` 的 helper 应用名（该包为占位实现，本构建不产出 Computer Use）
- `LICENSE` 与 `NOTICE.md` 中 Z.AI 的版权与许可声明

## 冲突热点

同步时冲突最可能出现在：

1. `packages/ui/src/i18n/locales/*.ts`、`apps/zcode-cli/packages/i18n/src/locales/*.ts` —— 上游几乎每次都会改文案，与品牌改写逐行冲突。**解决原则**：以上游结构和文案为准，只把其中的产品名改回 ZCode-Libre，然后跑一次脚本校平。
2. `packages/desktop/scripts/desktop-product-identity.mjs`、`electron-builder.config.js` —— 上游若新增打包字段，需判断是否也携带品牌名。
3. `README.md` / `README.en.md` —— 上游 README 结构变动较大时，直接保留本分支版本，仅按需吸收上游新增的命令说明。
4. `packages/desktop/src/main/desktopRuntimeEnv.ts` —— 上游若调整运行时身份解析，需保留「显示名取 ZCode-Libre、userData 目录取同名独立目录」这条不变量（`.zcode` 数据根共享由 `packages/services/src/paths.ts` 决定，不要改成独立）。
5. `packages/desktop/src/main/index.ts` 的遥测注册块 —— 上游若新增 `register*` / `configure*` 调用，必须确认它落在总开关内，否则又会出现"端点为空的部署仍在采样"的漏洞。
6. `packages/ui/src/root/useProviderAvailabilityLoginEntryGuard.ts` 的 `shouldOpenLoginEntry` —— 上游若把 `providerFamilyDomain` 重新加回判定，只用 API Key 的用户会再次被强制弹登录页。这是本分支最容易被上游改回的一处行为修正。
7. `packages/shared/src/plugin-marketplaces.ts` —— 只改了 `DEFAULT_PLUGIN_MARKETPLACES`；若上游改动 `DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS`（内置插件默认集合），正常并入即可，勿为"关闭厂商服务"而清空它。
8. `packages/services/src/oauth/providers/*ProviderConfig.ts` 的 `enabled` 默认值、`feedbackHttpClient.ts` 的 `request()` 早退、`node.ts` 的会话分享分支 —— 上游若重构这些入口，需确认策略判断仍在唯一收口点。

## 同步后自检

```bash
pnpm check:defaults                                    # 默认关闭项未被改回
python3 scripts/apply-brand-naming.py --check          # 品牌文案无遗留
grep -rn "dev.zcode.app" packages/desktop/scripts/     # 无残留上游 appId
grep -rn "initializeCrashCapture(logger, true)" packages/desktop/src/   # 无残留硬编码
grep -n "providerFamilyDomain ||" packages/ui/src/root/useProviderAvailabilityLoginEntryGuard.ts  # 门禁未被改回
git diff upstream/main --stat | tail -1                # 偏离规模是否符合预期
pnpm typecheck && pnpm lint
```

关键行为抽查（改动涉及产品路径，建议实机确认）：

```bash
pnpm dev:desktop
```

- 未配置任何模型时应进入登录页并**默认展示 API Key 表单**，不应出现 OAuth 渠道按钮。
- 填好 API Key 后重启，**不应再被登录页拦截**（这是第 8 节最重要的行为修正）。
- 应用左上角/侧栏收起态显示的是 ZCode-Libre 的渐变 Z，不是 z.ai 标志。
- 助手里不应出现"问题反馈/产品建议"；升级套餐入口点击无反应。
- 遥测默认关闭：不设 `ZCODE_TELEMETRY_ENABLED` 时，不应向 `zcode.z.ai` 或 ARMS 端点发出任何请求。
