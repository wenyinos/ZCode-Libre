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
#    package.json 的 version 直接取上游的发布号（详见「版本号」一节）：
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

### 版本号：直接用上游版本号，自研增量在其上继续加

主人 2026-10-13 改定；旧的「只对齐 `major.minor`、`patch` 自己走」作废。

- `package.json` 的 `version` **等于本次同步的上游发布版本号**：同步上游 v3.16.2，本分支就发 `3.16.2`，不要再自造与上游对不上的号。
- 本分支自己的补丁 / 特性发布，在该号之上继续 `patch +1`（上游 `3.16.2` → 下一次自研发布 `3.16.3`）；等下一次同步上游新版本时重新对齐上游号，继续这个规则。
- 历史：`3.15.1` → 自研补丁 `3.15.2`、`3.15.3`；本次同步上游跃迁到 `3.16.2`，版本号随之对齐。
- 合并上游时 `package.json` 的 `version` 冲突：**取上游的值**（与旧规则相反）；合并后跑 `node -e "console.log(require('./package.json').version)"` 确认。
- 与上游同号意味着 **tag 名也同名**。抓取上游一律 `--no-tags`（见开头）；打本分支 tag 前先 `git tag -d <同名>` 删掉本地那条上游 tag（只删本地 ref，上游提交仍可由 `upstream/main` 可达），再把新 tag 推到 `origin`，绝不推 `upstream`。
- 必须是**标准 semver 三段式**。四段式（如 `3.14.3.1`）会让应用内更新检测失效：`packages/desktop/src/main/githubReleaseUpdates.ts` 用 `semver.coerce` 解析，`3.14.3.1` 被截断成 `3.14.3`，与上一版比较会判定为"已是最新"，连续的四段版本之间也无法排序。
- `version` 同时决定产物文件名（`ZCode-Libre-<version>-<平台>-<架构>.<ext>`、`ZCode-Libre-CLI-<version>.tar.gz`），改它等于改发布产物命名，见下节「产品身份」。

历史留痕：`v3.15.0` 是按旧规则发的（内容同步上游 v3.15.1 却打了 3.15.0），Release 页与产物名和上游对不上；该发布保留不动，自 `v3.15.1` 起改用本规则。

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

**共用的边界（2026-09-26 逐层核实，未改行为，只在 README 写明）**：

- **不同会话并行是安全的**：库跑在 WAL（实测 `journal_mode = wal`，且第二个进程 0ms 就能拿到写锁，说明运行时锁只在事务内短暂持有）；`tasksDatabase/startup.ts` 的 `acquire()` 有 1 小时等锁上限并上报 `waiting_for_lock`；自动化任务用原子 single-flight 认领（`automationRepo.ts` 的 `running 0→1` + `claimed_at` 过期回收僵尸认领）。
- **同一个会话没有跨客户端互斥**。`session_target` 的 `active_input_id` / `active_run_started_at` / `active_run_last_seen_at` 看着像锁，实际只是目标计时：`startSessionTargetRun` 是**无条件覆盖**（SQL 里没有 `active_run_started_at is null` 之类条件），心跳失败（标记被抢）只记 debug 日志。更要紧的是 `session-facade.ts` 的 `readTargetWithInterruptedRunRecovery`：它把"本进程没有活跃轮次 + 会话上有活跃标记"判定为**上次崩溃的残留**，进而调 `recoverInterruptedSessionTargetRun` 清空标记、按 last_seen 结算 `time_used_seconds`、把 goal 状态由 `active` 改 `paused`。两个客户端同时开同一会话时，后读的那个会把前一个正在跑的运行结清，而前者无感知（心跳静默失效）。
- **设置文件的写入没有跨进程锁**：`setting.json`（`settingService.ts`）与 `provider_config.json`（`file-config.adapter.ts`）只做原子替换，两边同时改会丢更新。对照：`credentials.json`、bots 的 config/state、provider provisioning 状态都用了 `withFileLock`。
- **迁移没有前向兼容守卫**（没有"遇到不认识的迁移就拒绝启动"）。先升级的一侧会把共享库迁到新结构，旧版本客户端遇到结构性迁移可能报错。当前两边版本线一致，且本分支未动存储层，所以暂时无风险。
- 相关死代码：`TaskListItem` 的 `isMobileActive`（「手机正在操作此任务」）唯一调用点硬编码 `false` —— 属于开源版被砍掉的手机网页远控那套 UI，不是可用功能。

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
| `packages/web/index.html` 内联 32×32 | 必须与 `public/logo/icons/32x32.png` 字节一致；`packages/web/public/favicon.ico` 必须与 `packages/desktop/build/icon.ico` 一致（上游 v3.15.1 的 `webRemoteControlBootstrapShell` 静态断言锁死这三处同源） |
| `packages/ui/src/assets/provider-icons/model-provider-zai-app.png` | **保持上游官方 Z.AI 图形**：上游把它与自家 App 图标做成同一份字节，本分支重新设计了带几何缺口的 App 图标后两者必须解耦，供应商标志不能画成分支自己的图标 |

上游若替换图标源，按本分支标志重新生成，不要并入上游的 `icon.png` / `icon.icns` / `icon.ico` / `icons/`。改标志（如 5f038f71 加几何缺口）时容易只重生成 `public/logo/icons/` 与 `packages/desktop/build/`，漏掉 web 的两处；漏了不会编译报错，只会在浏览器标签和网页 favicon 上继续显示旧标志。

### 6. 本分支新增文件

`UPSTREAM.md`、`scripts/generate-logo-assets.py`、`scripts/apply-brand-naming.py`、`public/logo/zcode-libre.svg`、`packages/ui/src/assets/brand/zcode-libre-mark.svg`，以及重写后的 `README.md` / `README.en.md`。这些与上游无冲突，但 README 在内联 favicon 与徽标段落上可能产生冲突。

### 7. 默认关闭的遥测与厂商服务

路线是**默认关闭、不删代码**：上游的新功能代码照常合入，行为由少量开关与默认值决定。改动分散在多个包，因此策略集中登记在 `packages/shared/src/libre-features.ts`（唯一的策略真相源），各处只引用它。

**遥测（编译期，必须在启动早期生效，故不放在策略模块）**

上游 v3.15.1 起把遥测端点改为**构建期注入**（`__ZCODE_ARMS_RUM_ENDPOINT__` 等 define，见 `scripts/build-time-config.mjs`；未注入即空、SDK 以 enable=false 初始化）。本分支保留运行时总开关 `ZCODE_TELEMETRY_ENABLED`，与构建期空端点构成双防线：即使自建构建注入了端点，默认仍不上报。

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/env.ts` | 保留 `ZCODE_TELEMETRY_ENABLED`（上游 v3.15.1 已删除该常量）：只有显式设为真值（`1/true/on/yes/enabled`）才启用；端点常量并入上游构建期注入机制。**`packages/shared/src/index.ts` 必须同时把它加进 env 导出表**——桌面 Main 的 `appCrashCaptureBootstrap.ts` 直接 import 它，而 `pnpm typecheck` 不覆盖 `packages/desktop/tsconfig.main.json`，漏导出只会在 `pnpm bootstrap` 的 tsup 阶段报 `No matching export in "../shared/src/index.ts"` |
| `packages/desktop/src/main/index.ts` | 把原先逃逸在总开关之外的 `configureDesktopMcpTelemetry` / `registerDesktopStabilityMonitors` / `registerDesktopResourceTelemetry` / `registerRendererHeapSampleIpc` / `registerDesktopZCodeDataSizeTelemetry` / `registerDesktopNetworkTelemetry` 全部并入 `if (ZCODE_TELEMETRY_ENABLED && ZCODE_ARMS_RUM_ENDPOINT)` 块 |
| `packages/desktop/src/main/appCrashCaptureBootstrap.ts` | `initializeCrashCapture(logger, true)` 的硬编码 `true` 改为按实际遥测状态取值，遥测关闭时走纯本地 crashReporter（不上传） |
| `apps/zcode-cli/packages/telemetry/src/bootstrap.ts` | `isExplicitlyDisabled` 反转为 `isExplicitlyEnabled`：模型遥测由"未设置即启用"改为"必须显式启用" |

注意 `index.ts` 那处：上游把采样器注册放在总开关之外，其中 `desktopZCodeDataSizeTelemetry` 的 report 回调直接调用 `armsRum.sendCustom` 且没有初始化守卫，是本分支必须覆盖的点。这 9 个 `configure*` / `register*` 装配调用由 `pnpm check:defaults` 用语法树逐个判断是否落在总开关块内（不依赖缩进），上游若调整该块结构，脚本会报出逃逸的调用与行号。

**同步注意：`@zcode/shared` 的 import 行最容易在合并时丢掉**（2026-10-18 实测踩过）。上游 v3.15.1 删除了 `ZCODE_TELEMETRY_ENABLED` 常量，冲突解决保留了本分支的总开关代码块、却丢掉了它的导入行，于是产物里 `ZCODE_TELEMETRY_ENABLED` / `ZCODE_ARMS_RUM_ENDPOINT` 变成**未定义的自由变量**（tsup/esbuild 不做类型检查，`pnpm typecheck` 又不覆盖 `packages/desktop/tsconfig.main.json`），启动执行到 `if (ZCODE_TELEMETRY_ENABLED && ZCODE_ARMS_RUM_ENDPOINT)` 抛 `ReferenceError`；`app.whenReady()` 的 async 链就此 reject，其后所有步骤（`await armsInitPromise`、强制升级闸、`ensurePrimaryWindow("app-ready")`）**全部不执行**，结果是**主窗口从未创建、应用只剩托盘，冷启动必须手动点托盘才出窗口**（Windows / Linux 均如此）。日志里的表征只有一条 `unhandledRejection: {}`——`packages/desktop/src/main/logger.ts` 用 `JSON.stringify` 格式化非字符串参数，Error 会序列化成 `{}`，真实信息被吞掉；排查同类问题时可临时改成打印 `reason instanceof Error ? reason.stack : util.inspect(reason)`。

`pnpm check:defaults` 现在会扫描 `packages/desktop/src/main/index.ts` 里「被使用但未出现在 `@zcode/shared` 导入块中」的 `ZCODE_*` 标识符（先剥注释与字符串字面量，避免把注释里提到的常量名当成使用）并直接报错。合并后若改动了该文件的导入清单，务必跑一次 `pnpm bootstrap` 并确认产物里不再出现原样的 `ZCODE_TELEMETRY_ENABLED`。

**刻意不改上游语义**：上游的设计就是「启动期出错就不创建主窗口」，这里只修真正的错误，不加 try/catch 去兜底建窗——否则真错误会被藏起来，故障从"看得见"变成"看不见"。

**厂商服务（运行期，统一引用策略模块）**

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/libre-features.ts`（新增） | 策略真相源：`officialAccountLogin` / `conversationShare` / `feedback` / `codingPlanPurchase` / `pluginMarketplaceRemoteSource` / `marketingTouch` / `officialClientConfig` / `officialClientScenes` 默认全为 false，`selfHostedReleaseUpdates` 为 true |
| `packages/services/src/oauth/providers/{zai,bigmodel}ProviderConfig.ts` | OAuth provider 的 `enabled` 默认值改引用策略；仍可用 `ZAI_OAUTH_ENABLED` / `BIGMODEL_OAUTH_ENABLED` 覆盖开启 |
| `packages/shared/src/plugin-marketplaces.ts` | `DEFAULT_PLUGIN_MARKETPLACES` 默认不播种远端市场源；**`DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS` 未改动**。上游 v3.15.1 在默认市场里新增了 Claude 官方目录（`anthropics/claude-plugins-official`），已并入策略开关的 true 分支，与 ZCode 官方 CDN 一起受 `pluginMarketplaceRemoteSource` 控制 |
| `packages/services/src/node.ts` | 会话分享复用 `createUnsupportedConversationShareService`；营销推送、客户端配置与客户端场景在策略关闭时注册空实现 |
| `packages/services/src/feedback/feedbackHttpClient.ts` | 在所有反馈请求的唯一出口 `request()` 处截断（附件先取凭证再直传 OSS，因此一并阻断） |
| `packages/ui/src/settings/CodingPlanUpgradeDialogProvider.tsx` | `openCodingPlanUpgrade` 统一守卫处早退 |
| `packages/services/src/marketing-touch/marketingTouchService.ts` | `createDisabledMarketingTouchService` 返回空快照，不请求 `/api/v1/marketing/touch`、不上报 `/action`；Renderer 的 `MarketingTouchProvider` 同时不创建 runtime（不轮询、不渲染 Banner/弹窗） |
| `packages/desktop/src/main/singleFeatureRollout.ts` + `desktopContextPromptRollout.ts` + `rendererActionTraceRollout.ts` | 新增 `enabled` 入口；`officialClientConfig` 关闭时 `refresh` / `awaitFirstDecision` 直接返回默认快照，不建计时器，也不请求 `/api/v1/client/configs` |
| `packages/services/src/client-config/clientConfigService.ts` | `createDisabledClientConfigService` 返回空快照；插件商店排序、漏洞报告链接与插件推荐不再读取上游公开配置 |
| `packages/services/src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.ts` | `getClientConfigs()` 在策略关闭时返回空配置；套餐列表、StartPlanCard、闲时任务与动态工作流灰度不再请求 `/api/v1/client/configs` |
| `packages/services/src/client-scenes/clientScenesService.ts` | `createDisabledClientScenesService` 返回空列表，不请求 `/api/v1/client/scenes`；草稿建议提示与自动化模板保持为空 |

**刻意没有改的**：`DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS` 里是 browser-use、documents、pdf、spreadsheets 等**内置能力插件**，清空会让用户失去全部本地功能，因此保留；`computer-use` 本就默认关闭。

**已知无效项（保留现状，2026-10-21 记录）**：内置集合里的 `image-search@zcode-plugins-official` 是**依赖厂商身份的官方 MCP**——它需要宿主解析出 z.ai 账号身份头，而本分支在存储层拦截了官方账号凭据，解析必然失败（日志表现为 `官方 MCP 身份头不可用 {reason:"official_auth_unavailable"}`，随后回退匿名并被服务端拒绝）。该插件仍保持默认启用、不做特殊处理：清空或单独关闭它会把「内置插件默认集合」与上游 `official-plugin-definitions.ts` 的 `defaultEnabled` 断言关系弄乱，收益也只是少几条日志。**不要**为消除这条日志把它从 `DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS` 里删掉（`check:defaults` 与 bootstrap 单测都会对照该集合）。

**插件市场的口径**（便于排查"市场为什么像开着"）：商店里默认出现的条目都是**随应用打包的内置插件**（`official-plugin-definitions.ts` 的 seed），插件 ID 的 `@zcode-plugins-official` 只是命名空间后缀，不表示从远端拉过清单；`DEFAULT_PLUGIN_MARKETPLACES` 被 `pluginMarketplaceRemoteSource`（默认 false）置空，因此**不会播种任何远端市场源**，日志里也不会有 `marketplace.json` 请求。面向用户的"添加市场"是另一条路径（`addPluginMarketplace`，用户手填源地址），不受该策略开关约束——策略只控制默认播种。

这些默认值由 `pnpm check:defaults` 逐项断言：脚本用语法树读出 `LIBRE_VENDOR_SERVICES` 的字面量值逐一比对，只查键名存在的话，把 false 改回 true 也能"通过"。新增策略项必须在脚本里登记期望值，否则检查失败——避免新开关悄悄逃过「默认关闭」的约束。

### 8. 屏蔽官方账号登录，改用 API Key

| 文件 | 改动 |
| --- | --- |
| `packages/ui/src/root/useProviderAvailabilityLoginEntryGuard.ts` | 门禁由 `!providerFamilyDomain \|\| (!user && !hasUsableProvider)` 改为 `!user && !hasUsableProvider`。**这是本分支最关键的一处产品行为修正**：上游在未设置 provider family domain 时无条件弹登录页，导致只用 API Key 的用户每次启动都被拦截 |
| `packages/ui/src/WelcomeScreen.tsx` | 登录页 `loginMode` 初始值取 `LIBRE_VENDOR_SERVICES.officialAccountLogin ? "providers" : "apiKey"`（与 `resetApiKeyForm` 同一判据，策略关闭时默认 API Key 表单）；失败态由 `status === "error" \|\| oauthError` 的告警块独占，不给 apiKey 表单加同一门禁；无可用 OAuth 渠道时不传 `onCancel` |
| `packages/ui/src/login/LoginApiKeyForm.tsx` | `onCancel` 改为可选，未传时不渲染返回按钮 |
| `packages/ui/src/i18n/locales/*` | `login.oauth.noProviders` 由"服务不可用，请稍后重试"改为引导使用 API Key；`login.description` 由"连接账号"改为"配置模型服务" |

模型接入路径未改动：`config/provider/zcode-builtin.json` 的 `zai-standard-api`（`https://api.z.ai/api/paas/v4`）与 `bigmodel-standard-api`（`https://open.bigmodel.cn/api/paas/v4`）是纯 API Key 直连。注意 `zai-api` / `bigmodel-api`（`zhipu-coding-plan-api-key` + anthropic 端点）会被 `official-coding-plan-gateway.ts` 改写到 zcode.z.ai 网关做权益校验，**不是直连**；如需完全绕开厂商网关，应引导用户使用 standard 模板。

### 8b. 官方账号派生凭据在存储层就被拒绝读取

只关登录入口不够：官方客户端登录后会把登录 JWT、OAuth token 与账号级密钥写进**共享的** `.zcode`，而 Coding Plan 可用性与账号 provider 这两条链路是直读凭据库的（`codingPlanProviderAvailability.ts` 的 `loadZaiProviderConnectionZcodeJwtToken`、`bigmodelStartPlanZcodeJwt.ts`），不经过 OAuth 服务。结果是本分支会"借"官方登录态跑套餐，而这是错的：上游开源版自己声明「不承诺提供官方产品的全部功能及活动政策」（`NOTICE.md`），用户拿不到在官方客户端里预期的东西；且 JWT 到期需重新登录刷新，本分支登录入口关着，会出现"能用一阵子、然后失效且无法自助恢复"。

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/libre-features.ts` | 策略项 `officialAccountCredentials: false` + `isOfficialAccountCredentialKey()`，判定三类键：`zcodejwttoken`、`oauth:` 前缀、`account-provider:` 前缀 |
| `packages/services/src/credential/credentialService.ts` | `load()` 命中上述键时直接返回 null |
| `apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts` | `load()` 与 `loadMany()` 同样返回 null |

拦截放在**存储层**而不是各消费点：这样上游新增读取方也自动被覆盖，不会漏。**注意前缀不要写成包含匹配**——MCP 的 OAuth 键是 `mcp:oauth:<hash>`，用 includes("oauth:") 会误伤 MCP。

不影响的键：用户自己填的 provider apiKey（存在 provider 配置里，不在凭据库）、`bot:*`、`web-remote-control:*`。要恢复官方登录能力，把 `officialAccountCredentials` 置为 true 即可。

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
| `packages/shared/src/web-remote-control.ts`、`packages/web/src/webRemoteControlThemeSeed.ts` | Web 远控主题种子链路（上游 v3.15.1 由本分支旧文件 `webThemeSeed.ts` 重构而来）：`WebRemoteControlThemeSeed` 类型与 `isWebRemoteControlThemeSeed` 校验都必须含 `zai-dusk` |
| `packages/ui/src/WebRemoteControlThemeMenu.tsx` | 手机端主题菜单枚举（上游 v3.15.1 新增）：`MOBILE_THEME_OPTIONS` 需列出 `zai-dusk` |
| `packages/web/src/main.tsx`、`packages/web/index.html` | Web 端 class 切换、启动壳深浅判定（漏掉会让首屏按浅色渲染并闪白底） |
| `packages/desktop/src/renderer/src/main.tsx`、`resource-manager.tsx` | 桌面启动期与资源管理器窗口的主题判定与 class 切换 |
| `packages/ui/src/openWorkspacePageThemeHero.tsx` | 新主题的 mesh 视觉参数 |
| `packages/ui/src/ToolCallBlocks/renderers/EditInlineDiffContent.tsx`、`components/ai-elements/{mermaid-block,message}.tsx` | 深色判断补上 dusk |
| `DESIGN.md` | Theme Modes 章节 |
| i18n（zh-CN / en-US） | `settings.themeMode.zai-dusk`、`sidebar.settings.theme.zai-dusk` |

同步注意：上游若新增主题枚举点（新的主题入口或独立窗口），需一并列出 `zai-dusk`。**凡是直接比较主题名来判断深浅色的代码都必须显式包含该值**；走 `resolveTheme()` 的无需改动。`openWorkspacePageThemeHero` 与 `codingPlanEmbeddedWebview` 用的是 `resolveTheme`，已自动兜底。

另一类隐性枚举点在上游的静态断言里：`packages/ui/test/interactionThemeTokens.test.ts` 与 `packages/ui/test/modelTrajectoryPaneParts.test.ts` 直接数 `styles.css` 里每个主题 token 的出现次数，本分支多一套主题后这些计数从 4 变 5。上游新增同类"按主题数覆盖面"的测试时，改断言而不是少写一套色板。

### 11. 应用内更新：检测自有 Release，不下载不安装

上游的更新清单来自厂商 manifest（`/api/v1/releases/electron/manifest`），给出的是官方 ZCode 版本；在应用内下载安装会把官方版本装回本分支，覆盖品牌与默认关闭设置，且本分支桌面产物未做代码签名，自动安装也会持续触发系统拦截。因此本分支的更新链路只做**检测**，由用户前往 Release 页面自行下载。

| 文件 | 改动 |
| --- | --- |
| `packages/desktop/src/main/githubReleaseUpdates.ts`（新增） | 查询 `wenyinos/ZCode-Libre` 的 GitHub Release，用 semver 比较版本；网络失败/限流/结构异常一律收敛为 `error`，无 Release 时按"已是最新"处理；`fetchImpl` 可注入便于测试 |
| `packages/desktop/src/main/autoUpdater.ts` | `checkForUpdateMenuClick` 在打包态检查前排分流到 `runSelfHostedReleaseCheck`；`autoInstallOnAppQuit` 保持 false（上游 v3.15.1 起本就全平台 false，与本分支语义重合）；init 末尾跳过 electron-updater 的启动检查与轮询 |
| `packages/shared/src/update.ts` | `UpdateCheckResultPayload.available` 与 `UpdateStatePayload["update-available"]` 新增可选 `downloadUrl` |
| `packages/ui/src/UpdateStatusDialog{,Controller}.tsx` | 有 `downloadUrl` 时主按钮改为「前往下载」并 `openExternal`，隐藏无意义的自动下载开关；自动下载副作用不再触发 |
| `packages/desktop/src/main/index.ts` | `initAutoUpdater` 的 `enabled` 条件改为 `production && (ZCODE_AUTO_UPDATE_ENABLED \|\| LIBRE_VENDOR_SERVICES.selfHostedReleaseUpdates)`：自有检测不受厂商构建期开关约束 |
| `docs/desktop/build-time-optional-capabilities.md` | 校正自动更新一节：关闭 `ZCODE_AUTO_UPDATE` 只关厂商链路，自有 Release 检测仍可用 |
| `packages/desktop/test/autoUpdaterSelfHostedManualCheck.test.ts`（新增） | 回归用例：`enabled: false`（构建期未启用）时手动检查仍走自有 Release 检测；自有检查后不装厂商轮询表（越过轮询间隔也不打厂商 manifest）；切换 preview 开关不打厂商 manifest |

**保留未删**：`manifestUpdateProvider.ts` 与 electron-updater 的其余集成仍在（策略置 false 即可回退到上游行为）。

启动强制升级 gate 也走同一策略：`/api/v1/client/configs` 的 `minimalVersion` 在 `LIBRE_VENDOR_SERVICES.officialClientConfig` 关闭时整段跳过（`index.ts` 的 `skipOfficialForceUpdate`）。上游会把官方版本当成必须升级项，沿用会阻止主窗口创建并引导安装官方版本，与“只检测自有 Release”直接冲突；自建构建要恢复上游行为时把该策略置 true。同一策略还关闭 `desktopContextPrompt` / `rendererActionTrace` 两个灰度，它们与强更共用 `/api/v1/client/configs`，关闭后不建计时器、不发请求。

同步注意：
- 上游若改动 `initAutoUpdater` 的自动检查/轮询结构，需确认跳过分支仍在轮询启动之前，否则会重新向厂商发请求。
- **厂商 manifest 通道的所有入口都必须过 `isVendorManifestUpdateEnabled()` 门禁**，不能只挡 init 末尾的启动检查与首次轮询：轮询表由 `setAutoUpdaterMenuState` 装配，而自有 Release 检查自身也会触发状态变化，一旦装表就会按厂商 manifest 轮询、把官方版本当成可用更新**自动弹窗**（2026-10-17 实测：点一次"检查更新"后 15 分钟弹出官方 3.15.3，界面提示有官方新版）。当前门禁覆盖三处：`ensureAutoUpdatePollInterval()`（不装表并清掉已装表）、`triggerCheckForUpdates()`（启动/轮询/下载复查的共用入口）、`refreshAutoUpdaterReleaseChannel()`（切换 preview 开关）。门禁由 `pnpm check:defaults` 静态断言，回归用例在 `autoUpdaterSelfHostedManualCheck.test.ts`（必须用 `enabled: true` 复现，`enabled: false` 会在 init 顶部直接 return 而不装 `recheckAfterDownload`，测不出问题）。
- `checkForUpdateMenuClick` 的分流顺序：`canUseAutoUpdaterInCurrentRuntime()` → 自有 Release 分流 → `autoUpdaterDisabledForProductFlavor` 闸 → 各 `menuState` 分支。自有分流必须排在 flavor 闸**之前**——`runSelfHostedReleaseCheck` 不经过 electron-updater，而 flavor 闸保护的是「未初始化的 updater 不触碰厂商占位 feed」这条厂商链路。上游 v3.15.1 起 `enabled` 还叠加了构建期开关 `ZCODE_AUTO_UPDATE_ENABLED`（公开仓库与 CI 都不注入 → false），若 flavor 闸先判，打包后的手动检查恒为 dev-skipped，界面提示「开发环境不检查更新」，自有更新链路整条失效（2026-10-13 实测踩过）。分流顺序由 `pnpm check:defaults` 静态断言。
- `index.ts` 里 `initAutoUpdater` 的启用条件也必须并上自有分支：`ZCODE_PRODUCT_FLAVOR === "production" && (ZCODE_AUTO_UPDATE_ENABLED || LIBRE_VENDOR_SERVICES.selfHostedReleaseUpdates)`，否则公开仓库构建的 `enabled` 为 false，同样触发上面的 flavor 闸。
- 注意 `initAutoUpdater({ enabled: false })` 会在函数**顶部**直接 return（不注册 IPC、不赋值 `recheckAfterDownload`），而 `enabled: true` 才会走完 init；判断"某条更新链路是否可达"时别把这两种状态混为一谈。
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
| `packages/web/src/main.tsx` | Web 远控端的服务占位表需补 `providerBalanceService`（`createUnsupportedHomeOnlyService`）：远控端无本地数据根，额度面板在该端不可用；漏补会让 `IServiceAccessor` 类型检查失败 |

同步注意：上游若调整 provider 配置的文件结构或 `decodeProviderConfigFile` 的返回形状，需同步 `resolveBalanceSources`；上游新增服务时，`IServiceAccessor` 与 `RemoteServiceAccess` 都要补齐字段，否则类型检查会报缺属性。

### 13. 命令行版独立发行（TUI + Web）

与桌面版同一版本号、独立发布，覆盖 macOS arm64 与 Linux x64/arm64 三个平台。复用上游已有的 `pnpm build:zcode` 产物（tar.gz 内含 web/、server/、agent/、TUI 运行时与 node_modules；`bin/zcode.mjs` 是无参数→TUI、`--web`→Web、其余参数交给 Agent 的三态入口），只做了三处改动：

| 文件 | 改动 |
| --- | --- |
| `scripts/zcode-distribution/assets.mjs` | 新增 `cliReleaseTargets`（darwin-arm64 / linux-x64 / linux-arm64）：TUI 运行时资产与 node-pty prebuild 只打包这三个平台的原生件；上游的 SEA 目标矩阵（6 平台）保持不动 |
| `scripts/zcode-distribution/installer.mjs` | install.sh 支持 `--tarball <本地包>` 离线安装（国内网络不便下载时的推荐方式，解压在安装目录内完成、不落 /tmp），在线安装降为备选；三平台之外提前失败并提示 Node 主版本；在线下载优先用 `latest.json` 的 `tarballUrl`（GitHub Release 的资产是扁平地址，与自建 CDN 的 `releases/<version>/` 布局不同），缺省时回落旧拼法 |
| `scripts/build-zcode.mjs` | 新增 `--tarball-url`（也可经 `ZCODE_DIST_TARBALL_URL` 提供），写入 `latest.json` |

发布链路由**独立**的 `.github/workflows/release-cli.yml` 负责，不与桌面 Release 混在一起：在 Linux runner 上即可打出 macOS/Linux 通用包（pnpm `supportedArchitectures` 会安装各平台可选依赖、node-pty prebuild 随包携带），必须传 `ZCODE_ENV=production`，否则内置 provider 配置会取测试环境。产物 `ZCode-Libre-CLI-<版本>.tar.gz` 与 `sha256.txt`、`latest.json`、`install.sh` 一起发布；版本号取根 `package.json`，与桌面版对齐。

CLI 内部显示的 `@zcode/cli` 版本（`zcode doctor` 里的 `0.16.9`）是上游自己的版本号，不随本分支版本线变化。

同步注意：上游若调整 `stageTuiRuntime`、node-pty prebuild 处理或 `install.sh` 模板，需保留「只覆盖三个平台」与「`tarballUrl` 优先」这两条。

### 14. 项目站点改用 Actions 发布

上游把完整文档语料（规格 md、打包的 knip 文档站含 `.astro` / `.mdx`）也放在 `docs/` 下；本分支的 Pages 站点恰好也在 `docs/`（`index.html` + `promo/`）。走「从分支发布 `/docs`」时，Jekyll 会递归解析整个目录，撞上 `.astro` 的非法 YAML front matter 直接失败：`Invalid YAML front matter in docs/knip/docs/src/components/Footer.astro`。

因此改用 `.github/workflows/pages.yml` 显式上传这两项，仓库 Pages 的 `build_type` 设为 `workflow`。合并前 `docs/` 只有 4 个文件，合并后 2200+；站点内容不得改回依赖 Jekyll 扫描 `docs/`。

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
9. 上游新增/重写的测试 —— 这些文件不冲突但会失败，`pnpm verify:pre-push` 会拦住推送。失败原因只有三类，按类处理：
   - **品牌口径**：断言写死了上游文案、应用名、`appId`、`.desktop` 文件名、User-Agent 等 → 改断言为分支值（`pnpm test:unit` 里 `about`、`desktopProductIdentity`、`zcodeSourceHeaders`、各 i18n 快照都属这类）。
   - **策略开关**：上游用例锁的是厂商服务开启时的行为 → 在该测试文件里 mock 策略，别改生产默认值。经包入口读开关的用 `vi.mock("@zcode/shared", importOriginal)` 覆盖 `LIBRE_VENDOR_SERVICES`；走运行期快照的用 `setVendorServiceSettingsSnapshot()`；若生产代码用**相对路径**直接 import `./libre-features.js`（如 `remoteAppConfig`、`communityUrl`、`helpAppConfig`），包入口 mock 拦不住，必须 mock 解析后的相对路径。
   - **同源资产与枚举数**：主题覆盖数、`styles.css` token 计数、内联图标字节一致 —— 按分支实际补齐（多一套主题、重新生成图标），不要放宽断言。
10. `packages/web-share/vite.config.ts` 的 `resolve.alias` —— 上游 v3.15.1 新增这个包，别名写成对象、`"@zcode/shared": ".../src/index.ts"`。Vite 的字符串别名按「全等或 `find + /` 前缀」匹配，所以上游新增的 `@zcode/shared/mcp-apps`、`/zcode-protocol-v4`、`/config-schema`、`/model-config` 会被拼成 `src/index.ts/mcp-apps`，`pnpm build:bootstrap` 直接 ENOTDIR 失败，六个桌面打包 job 全红。本分支已改成数组形式，先用正则把子路径映射到 `packages/shared/src/`，再留根入口。**上游同步会把它改回去**，合并后必须本地跑一次 `pnpm run build:bootstrap` 才能发现。
11. `.gitattributes` 对 Gen UI 离线快照的 `-text` 规则 —— `apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets/**` 里的文件由 `packages/desktop/scripts/gen-ui-runtime-assets.mjs` 在构建期逐个校验 sha256。Windows runner 的 `core.autocrlf=true` 会把 LF 换成 CRLF，哈希随之漂移，`Build Windows-x64` 在「准备构建资源」就失败。上游没有这条规则（它的 CI 不打 Windows 包），同步时容易被冲掉；验证方法：`git -c core.autocrlf=true checkout-index -f --prefix=/tmp/probe/ -- <快照文件>` 后比对 sha256 与工作区一致。

12. `docs/` —— 上游把规格语料与打包的 knip 文档站（含 9 个 `.astro` + 11 个 `.mdx`）放进 `docs/`，正好是本分支 Pages 的源目录，合并后 Pages 构建会因 Jekyll 解析 `.astro` 而失败（详见偏离清单第 14 条）。本分支已改用 Actions 发布：同步时**不要**删 `docs/index.html` 与 `docs/promo/`，也不要把 Pages 换回 legacy 的「从分支发布」。
13. `packages/desktop/src/main/index.ts` 的 `@zcode/shared` 导入清单 —— 上游删除常量时，冲突解决会保留本分支的使用处却丢掉导入行，产物里成为未定义的自由变量，**启动期 ReferenceError 导致主窗口不再创建、应用只剩托盘**（2026-10-18 实测，详见偏离清单第 7 节末段）。合并后必须跑 `pnpm check:defaults`（已加该文件的导入完整性断言）并确认产物里不出现原样的 `ZCODE_TELEMETRY_ENABLED`。

## v3.16.2 同步记录（2026-10-20）

上游两个 `chore: sync ZCode source` 提交（`0a1fc56d`、`3c5b2276`），4579 文件、+365k/−125k，主题是远程连接 / source server 与工作区外壳重构。冲突 42 个文件，以下是本次新增的同步注意点：

- **`packages/shared` 的测试常量搬到了 `@zcode/shared/test-ids` 子路径**：`TID_*` 现在从 `@zcode/shared/test-ids` 导入，而 `DesktopCommandIds`、`LIBRE_VENDOR_SERVICES`、`ZAI_PROVIDER_ID`、`OAuthProviderMeta` 等仍来自 `@zcode/shared`。合并导入块时容易把两组混在一行，导致值导入自 test-ids 而运行时报错或 lint 重复声明。
- **`WorkspaceSidebar` 被整体重写**：`packages/ui/src/WorkspaceSidebar.tsx` 现在只是 `project-sidebar/index.js` 的再导出，旧实现与 `WorkspaceSidebar/WorkspaceSidebarCollapsedRail.tsx` 已被上游删除（本分支已接受删除）。侧边栏相关改动要落到 `packages/ui/src/project-sidebar/`。
- **上游自己也修了 web-share 别名**，但用的是「根入口精确匹配」；本分支保留正则子路径写法（`/^@zcode\/shared\/(.*)$/` → `packages/shared/src/$1`），因为它同时覆盖子路径导入，已在本地 `pnpm --filter @zcode/web-share build` 验证。合并时别被上游版本覆盖。
- **`prepare` 脚本新增 `pnpm build:cua`**：`pnpm install` 现在会额外构建 CUA（`packages/zcode-cua`，tsc --noEmit）。CI 的 `pnpm install --frozen-lockfile` 会跟着执行，安装时间变长属正常。
- **两个 relay 传输退避测试对运行时版本敏感**：`packages/desktop/test/webRemoteControlTransport.test.ts` 与 `packages/web/test/webRemoteControlTransportV2.test.ts` 与上游逐字节一致，但在 Node **24.18.0** 下有 2 个退避用例失败（仓库 `mise.toml` 锁定 **24.14.0**）。这两条属环境差异，不要在测试里放宽时限；按 `mise.toml` 用 24.14.0 复跑。
- **上游的 affected 测试脚本以 `origin/staging` 作首次推送基线**（`scripts/affected-unit-tests/scope.mjs` 的 `firstPushBase`，缺失时故意报错）。本分支没有 `staging` 分支，首次推 tag 时 pre-push 会因此失败；已改为按 `origin/staging` → `origin/main` 顺序回落，两者都缺失才报错。同步时若上游再改这段，注意保留下沉回落。
- 上游删除了 4 个 UI 测试（`interactionThemeTokens`、`modelConfigHelpCopy`、`onboardingWelcomeI18n`、`shared/test/pluginMarketplaces`）且无替代；本分支已接受删除，紫夜主题的覆盖改由 `styles.css` 相关断言与 `useTheme` 测试承担。

## 同步后自检

```bash
pnpm check:defaults                                    # 默认关闭项未被改回
python3 scripts/apply-brand-naming.py --check          # 品牌文案无遗留
grep -rn "dev.zcode.app" packages/desktop/scripts/     # 无残留上游 appId
grep -rn "initializeCrashCapture(logger, true)" packages/desktop/src/   # 无残留硬编码
grep -n "providerFamilyDomain ||" packages/ui/src/root/useProviderAvailabilityLoginEntryGuard.ts  # 门禁未被改回
git diff upstream/main --stat | tail -1                # 偏离规模是否符合预期
pnpm typecheck && pnpm lint
pnpm run test:unit:affected                            # 推送钩子用的就是这条；全量核对再跑 pnpm test:unit
pnpm run build:bootstrap                               # 桌面 Main 由 tsup 从源码打包，typecheck 不覆盖 tsconfig.main.json
ls docs/index.html docs/promo/                         # 站点文件仍在；Pages 由 .github/workflows/pages.yml 发布，不再走 Jekyll
grep -c "ZCODE_TELEMETRY_ENABLED&&" packages/desktop/out/main/index.js  # 应为 0；非 0 说明 index.ts 丢了导入，启动会 ReferenceError 且不建主窗口
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
