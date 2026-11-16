# 局域网 / 虚拟局域网手机远控（Local LAN Remote）

> 状态：设计稿，未实现。实现前需按本文完成 P0/P1 验收。
>
> 关联：[Web 远控架构](./web-remote-control-architecture.md)、[Relay V2 配对](./relay-v2-pairing.md)、[任务实时同步](./task-realtime-sync.md)。

## 结论

本方案让手机在**不登录官方账号、不经过云端 relay** 的情况下连接桌面：

1. 桌面 main 内置一个本地 relay，实现 Relay V2 的 HTTP/WS 子集并同源托管 `/remote/v4` 静态页面。
2. 手机访问 `http://<桌面可达 IP>:<端口>/remote/v4`，页面按同源推导出 token 与 `ws2` 地址，现有 transport、分片、ACK、bridge、replayable 恢复全部复用。
3. 鉴权用**一次性配对码**替代官方 JWT；桌面与手机都不再读取官方凭据。
4. 服务监听 `0.0.0.0`，**一次监听覆盖所有 IPv4 网卡**（Wi-Fi、有线、ZeroTier 等），无需逐网卡映射；二维码只携带一个选定地址，需要时切换。

ZeroTier 场景属于同一方案：手机与桌面加入同一虚拟网络后 IP 直达，跨物理网络访问不依赖公网端口映射。

## 背景与约束

当前远控链路对官方账号有三处硬依赖：

| 环节     | 依赖                                                      | 位置                                                                           |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 桌面启动 | `getLogin()` 读取官方凭据里的 JWT，缺失即 `auth-required` | `packages/desktop/src/main/index.ts:1032-1034`                                 |
| 手机门禁 | 页面读取同源 localStorage JWT，缺失即登录页               | `packages/web/src/web-remote-control/app/webRemoteControlEntry.ts:154,244,308` |
| relay    | 设备注册、token、`ws2` 全在云端                           | `packages/shared/src/web-remote-relay/contract.ts`                             |

本分支已屏蔽官方账号登录，因此上述链路在未登录状态下不可用。本方案只替换鉴权与地址来源，不改变任务、会话、流和队列的所有权。

已验证的事实（2026-11-15，loopback）：

- 用仓库源码可独立构建 `/remote/v4` 静态包：`vite build --base=/remote/v4/` + `VITE_WEB_REMOTE_CONTROL_ROUTE_PATH=/remote/v4`，约 21 秒。
- 本地静态服务器托管后，Chrome 与 iPhone 14 视口均正常渲染；62 个资源请求全部命中本地，零外部请求、零 404。
- 无 JWT 时页面在登录门禁停止，**不发出任何 `/api/v1/remote/*` 请求**。
- `VITE_ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL` 只有声明（`packages/web/src/env.d.ts:19`），`main.tsx:827-829` 未读取；页面 relay 地址始终由 `window.location.origin` 推导。因此本方案必须同源托管，不能靠构建期变量指向其他 relay。

## 非目标

- 不替代云端 Relay V2；云端模式行为、二维码与会话语义保持不变。
- 不新增 Agent runtime、Local Host、Remote Host 或 SSH/WSL/Docker session；手机仍 attach 到桌面窗口已有 Host。
- 不修改 `rpc-frame` / `rpc-frame-ack` 的分片、ACK、流控与 45 秒期限。
- 不修改 `desktop-continuous` 与 `web-remote-replayable` 的 owner、snapshot/gap 边界。
- 第一版不支持 IPv6、mDNS 主机名发现和多手机并行控制。

## 术语

| 术语          | 含义                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| Local Relay   | 桌面 main 内的本地 HTTP/WS 服务，实现 Relay V2 子集                     |
| Local Mode    | 本分支唯一的远控模式；始终启用，不读取官方凭据、不保留云端入口 |
| Pairing Code  | 桌面每次 relay 启动随机生成的 6 位数字；刷新二维码会轮换，旧码立即失效      |
| Session Token | 配对成功后签发的本地 opaque token，用于重连时换取一次性 relay token     |
| LAN Address   | 桌面枚举出的、手机可达的 IPv4 地址，二维码只携带其中一个                |
| Local Origin  | `http://<LAN Address>:<port>`，同时是静态页面、token 与 `ws2` 的 origin |

## 架构

```text
手机浏览器 / Android WebView
  http://<LAN Address>:<port>/remote/v4      ← 同源静态页面
        │
        ├─ POST /api/v1/remote/token          ← 配对码或 Session Token 换一次性 token
        ├─ GET  /api/v1/remote/device         ← 单条本机设备记录（可选）
        └─ WS   /api/v1/remote/ws2?token&mid  ← Relay V2 消息子集
                 │
                 ▼
        Desktop main · Local Relay
          ├─ 配对状态机（device/terminal 双端、一次性 token、心跳）
          └─ 静态托管 /remote/v4/*
                 │
                 ▼
        workspace-bridge-open → 新 MessagePort attachment
                 │
                 ▼
        目标窗口唯一 Window Host（local/remote workspace scope）
                 │
                 ▼
        同一 CLI runtime / task owner / CommandInbox
```

与云端 relay 的差异：

| 项       | 云端 Relay V2         | Local Relay                               |
| -------- | --------------------- | ----------------------------------------- |
| 鉴权     | 官方 JWT              | 一次性配对码 → 本地 Session Token         |
| 设备身份 | 云端分配 `device_sid` | 桌面本地生成并持久化 `device_sid`         |
| 设备列表 | 账号下所有设备        | 只有本机一条记录                          |
| 多设备   | 支持                  | 第一版单桌面、单手机                      |
| 传输     | 公网 WSS              | 局域网/虚拟局域网 WS（ZeroTier 自带加密） |
| 业务消息 | 相同                  | 相同                                      |

## 地址与多网卡

### 监听

- 默认监听 `0.0.0.0:<port>`，一次覆盖全部 IPv4 网卡，包括 Wi-Fi、有线与 ZeroTier 虚拟网卡。
- **不需要逐网卡映射或逐个地址监听**；`0.0.0.0` 会让每个网卡的地址都能访问同一端口。
- 第一版不监听 IPv6。ZeroTier 网络默认也分配 IPv4，不影响使用。
- 端口固定为 `47821`。端口被占用时启动失败并明确报错，不自动切换端口，避免二维码、收藏链接与实际监听端口不一致。

### 网卡枚举与分类

使用 `os.networkInterfaces()` 枚举，过滤 `internal`、loopback、link-local 与未启用接口。按以下顺序分类：

| 类别       | 判定                                                     | 示例                             |
| ---------- | -------------------------------------------------------- | -------------------------------- |
| `physical` | 接口名非虚拟前缀，地址为 RFC1918                         | `wlp0s20f3` 的 `192.168.8.110`   |
| `zerotier` | 接口名以 `zt` 开头，或系统路由表中存在 ZeroTier 管理路由 | `ztwdjpjed2` 的 `192.168.192.10` |
| `virtual`  | `docker*`、`veth*`、`vmnet*`、`tailscale*`、`tun*` 等    | 容器或 VPN 地址                  |
| `public`   | 非私有地址                                               | 公网 IPv4                        |

### 地址选择

- 桌面远控对话框列出全部候选地址，标注类别与接口名；二维码只携带当前选中的一个。
- 默认选择顺序：用户上次显式选择 > `physical` > `zerotier` > `virtual`；`public` 默认不选，只有在用户显式开启并确认风险后才允许。
- 用户切换地址后重新生成二维码与连接链接；已建立的手机连接不受影响，直到断线重连。
- 地址变化（Wi-Fi 切换、ZeroTier 重新加入网络）时刷新候选列表；当前选中地址失效则自动回退到优先级最高的可用地址，并提示重新扫码。
- 第一版统一使用 IPv4 字面量，不做主机名解析。

### 来源准入

即使监听 `0.0.0.0`，HTTP 与 WS 层仍按来源地址过滤：

- 只接受 RFC1918（`10/8`、`172.16/12`、`192.168/16`）、`100.64/10`（CGNAT/VPN）与 loopback 来源。
- 其他来源直接返回 `403`，不进入配对流程，不记录凭据。
- 该过滤是纵深防御，不替代配对码；ZeroTier 的 `192.168.192.0/24` 天然落在允许范围内。

## 鉴权模型

### 配对码

- 每次启动局域网远控时生成 6 位数字配对码，默认 5 分钟有效，最多使用一次。
- 二维码参数：`pair=<code>`；`sid`/`mid`/`name`/`app_version` 沿用现有格式。
- 配对成功后立即作废；重复使用返回 `AUTH_FAILED`。
- 同一来源连续 5 次失败后暂停该来源 60 秒；错误响应不区分“码错误”和“码过期”。

### 桌面身份

- 本地模式下 `getLogin()` 返回 `{ userId: "local:<machineId>", jwt: <local relay 内部 token> }`，不再读取官方凭据服务。
- `machineId` 复用现有 `deviceMid`，保证同一台机器跨重启稳定。
- `device_sid` 由本地 relay 生成并持久化；`userId` 变化（例如 machineId 重置）时重新生成。

### 手机会话

```text
首次配对：pair code ──POST /token {role:"terminal", pairCode}──> sessionToken + 一次性 token
重连：    sessionToken ──POST /token {role:"terminal"}────────> 新一次性 token
```

- `sessionToken` 保存在手机 localStorage，按 `localOrigin + device_sid` 隔离。
- 一次性 relay token 沿用 V2 语义：60 秒有效、WS Upgrade 前原子消费、失败不恢复。
- 停止远控、关闭窗口、应用退出、用户点击“断开手机”都会清空配对码与全部 `sessionToken`。
- 手机侧清除站点数据或更换浏览器后需要重新扫码配对。

## 协议契约

Local Relay 只实现手机与桌面都需要的子集，消息 schema 直接复用 `@zcode/shared/web-remote-relay` 的解析器。

### HTTP

| 方法与路径                          | 请求                                                                                | 成功响应                           |
| ----------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| `POST /api/v1/remote/token`         | `{role:"device"\|"terminal", pairCode?}`，或 `Authorization: Bearer <sessionToken>` | `{token, expires_in}`              |
| `GET /api/v1/remote/device`         | 无                                                                                  | 本机一条设备记录                   |
| `POST /api/v1/remote/device`        | `{device_mid}`                                                                      | 本机设备记录（幂等，返回同一 SID） |
| `POST /api/v1/remote/device/delete` | `{device_sid}`                                                                      | `null`                             |

响应信封沿用 `{code, msg, data}`；未知字段忽略。

### WebSocket

入口 `/api/v1/remote/ws2?token=...`，行为与 V2 一致：

- `auth_init {device_sid, meta, client_ts}`
- `pair_status_query {client_ts}`
- `data {payload, client_ts}` 透明转发
- `auth_ack`, `pair_status_ack`, `data`, `error`
- `pair_status` 仅 `waiting | matched`
- 错误码沿用 `AUTH_FAILED | WRONG_PARAM | KICKED | INTERNAL | DEVICE_OFFLINE`
- 单消息上限 1 MiB；心跳 5 秒 ±1 秒，ACK watchdog 15 秒

### 配对状态机

- 同一 `device_sid` 下只允许一个 terminal owner；第二个 terminal 认证成功时替换旧 owner，并向旧连接发送 `KICKED`。
- device 断开时向 terminal 发送 `DEVICE_OFFLINE` 后关闭；terminal 断开只把 device 置回 `waiting`。
- 桌面 main 是 device 端唯一 owner；本地 relay 不解释 `data.payload` 内的 task/session/workspace 语义。

## 桌面侧改动

### 新模块

`packages/desktop/src/main/webRemoteControlLocalRelay.ts`：

- 基于 `node:http` + `ws`（desktop 已有依赖）实现 HTTP、WS、静态文件与来源过滤。
- 配对状态机从 `packages/shared/test/fixtures/fake-relay-v2.ts` 提取为生产模块（建议落在 `packages/desktop/src/main/webRemoteControlLocalRelayPairing.ts`），测试 fixture 之后改为复用同一实现，避免两份逻辑漂移。
- 静态资源根目录来自 `resources/remote/v4`；开发模式下可用环境变量覆盖为本地构建目录。

### 接线

`packages/desktop/src/main/webRemoteControlManager.ts` 与 `index.ts`：

- 新增设置项：
  - `webRemoteControlLocalMode: boolean`
  - `webRemoteControlLocalPreferredAddress?: string`（形如 `192.168.8.110`）
  - `webRemoteControlLocalPort?: number`
- 本地模式启动顺序：

```text
读取设置 → 枚举地址 → 启动 Local Relay → 生成配对码
  → getEndpointUrls 返回 { origin: localOrigin, relayWsUrl, remoteUrl }
  → getLogin 返回本地身份
  → 复用现有 device 注册/transport/二维码流程
```

- 二维码 base URL 为 `http://<LAN Address>:<port>/remote/v4`，并带 `pair=<code>`。
- 停止远控、窗口销毁、应用退出时关闭 Local Relay 并清空配对码；`auth-required` 不再出现。
- 云端模式完全保留：设置关闭时走现有 `getEndpointUrls` / `getLogin`。

### 状态所有权

| 状态                                 | 所有者                                  |
| ------------------------------------ | --------------------------------------- |
| 配对码、sessionToken、失败计数       | Local Relay（内存，不落盘）             |
| `device_sid`、`machineId`            | 桌面 main 的设置/身份存储               |
| 监听端口、当前 LAN Address、候选网卡 | 桌面 main 的窗口远控 runtime            |
| 手机选中 workspace/task              | 手机页面；仅通过 `mobileViewState` 上报 |
| task/session/stream/queue            | Window Host / CLI runtime（不变）       |

## 手机侧改动

`packages/web/src/web-remote-control/app/webRemoteControlEntry.ts` 增加本地配对分支：

1. URL 带 `pair=` 或页面位于私有地址时进入本地模式；`packages/web/src/main.tsx` 给 entry 注入内存 auth 哨兵跳过 OAuth 登录门禁（`getZCodeJwtToken` 返回 `"local-remote"`，不写 `oauth:browser_session`、不写 localStorage），token 请求走配对码/`sessionToken`。
2. 当前直接自动配对；独立的配对确认页尚未实现。
3. token 请求体携带 `pairCode`；配对成功后把 `sessionToken` 写入同源 localStorage。
4. 后续 bootstrap、版本校验、workspace 选择、bridge、replayable 恢复完全复用现有实现。
5. 重连时优先使用 `sessionToken` 换一次性 token；`401` 或 `AUTH_FAILED` 时回到配对页，提示重新扫码。
6. 本地模式由 URL 参数显式标记，云端页面行为不变；不新增全局登录态分支。

### 不需要改动的部分

- `webRemoteControlTransport.ts`：仍使用 `relayWsUrl` 与 `getToken`。
- `rpc-frame` 分片、ACK、流控与 bridge 建立。
- `packages/desktop/src/main/webRemoteControlSharedHostAttachments.ts`。
- Host 的 `web-remote-replayable` 注入与 owned subscription。

## 失败与恢复

| 场景             | 行为                                                              |
| ---------------- | ----------------------------------------------------------------- |
| 手机断线         | 现有 transport 退避；用 `sessionToken` 重新换 token，不重新配对   |
| 配对码过期       | 手机提示重新扫码；桌面可生成新码                                  |
| 桌面重启         | 配对码与 sessionToken 全部失效，需重新扫码                        |
| 地址变化         | 旧链接不可达；桌面刷新候选地址并提示重新扫码                      |
| Local Relay 停止 | WS 关闭，手机进入连接失败页；不自动回退到云端模式                 |
| 端口被占用       | 启动失败并保留设置，提示释放 `47821` 后重试                       |
| 两个手机同时连接 | 第二个 terminal 替换第一个，第一个收到 `KICKED`                   |
| 桌面退出         | attachment 释放，PTY 按既有 owner 规则回收；本地 relay 随进程退出 |

## 安全边界

- 能访问 Local Relay 且拿到配对码的人即拥有桌面 Agent 的命令执行能力。配对码每次 relay 启动随机生成，并在远控生命周期内有效、可重复配对（第二台手机替换第一台）；点击「刷新二维码」会轮换配对码、撤销全部手机 sessionToken 并断开已配对连接；停止远控时同样撤销。连续失败按来源暂停。
- 系统防火墙不由应用检测、修改或放行（安装包脚本也不碰）；远控对话框在「等待手机连接」处提供「防火墙设置说明」链接，按当前平台展示可手动执行的命令（Linux firewalld/ufw、macOS socketfilterfw、Windows netsh）。
- 默认不把 `public` 地址写入二维码；选择公网地址需要显式确认。
- 只接受私有/CGNAT 来源；非允许来源返回 `403`。
- 日志不记录配对码、sessionToken、完整二维码 URL；只记录地址类别、端口和失败计数。
- 停止远控必须立即撤销 token 并关闭 WS；不能只关闭页面。
- ZeroTier 传输本身有端到端加密，但 HTTP 页面仍不是 secure context；不要依赖 `navigator.locks`、Service Worker、`crypto.randomUUID` 等 API。

## 验收场景

| 编号   | 场景                           | 预期                                                |
| ------ | ------------------------------ | --------------------------------------------------- |
| LLR-01 | 同一 Wi-Fi 下手机扫码          | 配对成功，能浏览工作区并打开任务                    |
| LLR-02 | 手机与桌面仅通过 ZeroTier 可达 | 用 ZeroTier 地址扫码成功，业务行为与 LLR-01 一致    |
| LLR-03 | 同时存在 Wi-Fi 与 ZeroTier     | 对话框列出两个地址；切换后二维码与链接变化          |
| LLR-04 | 错误配对码连续 5 次            | 第 5 次后该来源暂停 60 秒，正确码在暂停期内也被拒绝 |
| LLR-05 | 同一配对码配对第二台手机       | 第二次成功并签发独立 sessionToken；停止远控后两个 token 均失效 |
| LLR-06 | 停止远控后使用旧 sessionToken  | token 接口返回 `AUTH_FAILED`，WS 被拒绝             |
| LLR-07 | 手机断线 10 秒后恢复           | 不重新配对，bridge 重建后 snapshot/gap 恢复         |
| LLR-08 | 桌面重启                       | 旧二维码与 sessionToken 失效，新配对码可重新扫码    |
| LLR-09 | 两台手机先后连接               | 第一台收到 `KICKED`，第二台正常                     |
| LLR-10 | 非私有来源请求 token           | `403`，配对码不被消耗                               |
| LLR-11 | 端口 47821 被占用              | 启动失败并提示释放端口，不生成二维码                |
| LLR-12 | 关闭本地模式                   | 恢复云端 Relay V2 行为，无本地监听                  |

## 分阶段实施

| 阶段 | 内容                                              | 退出条件                  | 状态 |
| ---- | ------------------------------------------------- | ------------------------- | ---- |
| P0   | Local Relay + 静态托管 + 固定配对码，仅 loopback  | LLR-01 的本地等价用例通过 | 完成（2026-11-15） |
| P1   | 配对码、来源过滤、token 撤销、single terminal     | LLR-04/05/06/09/10 通过   | 完成（2026-11-15） |
| P2   | 多网卡地址选择、ZeroTier、地址变化处理            | LLR-02/03/11 通过         | 部分完成（2026-11-15） |
| P3   | 静态资源打包进桌面、设置 UI、真机验收、文档与测试 | 全部用例通过              | 完成（2026-11-15，真机待验收） |

### 实施记录

P0（2026-11-15）：完成本地 relay、桌面接线与真实桌面验证（配对、bootstrap、bridge、打开任务、iPhone 视口渲染）。

P1（2026-11-15）：

- 配对码一次消费；成功后签发 `sessionToken`，刷新与断线重连不再消费配对码。
- token 接口只接受有效配对码或有效 `sessionToken`；连续 5 次错误按来源暂停 60 秒（锁定期内正确码同样拒绝）。
- `revokeAll()`：停止远控时撤销全部 token、配对状态与已配对连接，同时重置配对码；relay 保持监听。
- 手机端新增 `webRemoteControlLocalToken.ts`（识别 `pair` 参数或私有地址），token 客户端在本地模式下优先 `sessionToken`、其次配对码，并保存响应中的 `sessionToken`。
- 回归测试 `packages/desktop/test/webRemoteControlLocalRelay.test.ts`：配对码一次性、sessionToken 换 token、5 次失败锁定、`revokeAll`、第二台手机 KICKED。
- 已实测：手机首次配对、刷新重连、停止后旧 sessionToken 返回 401、停止后配对码可重新使用、第 6 次错误请求返回 429。

P1 未覆盖：非私有来源的真实拒绝（需要外部主机模拟）、双手机替换的浏览器验收；P2 再补。

P2（2026-11-15，部分完成）：

- 地址枚举与分类：`listWebRemoteControlLocalAddresses()` 返回全部 IPv4，按 `physical > zerotier > virtual > public` 排序；`classifyWebRemoteControlLocalAddress()` 识别 `zt*`/`zerotier*`、`docker*`/`veth*`/`br-*`/`vmnet*`/`tailscale*`/`tun*` 等虚拟网卡。
- 首选地址：`createWebRemoteControlLocalRelay({ preferredAddress })`；env `ZCODE_WEB_REMOTE_CONTROL_LOCAL_ADDRESS` 可选择二维码地址，缺失时按优先级自动选择，公网地址默认不选。
- 已验证：本机同时有 Wi-Fi（`192.168.8.110`）与 ZeroTier（`192.168.192.10`）时，指定 ZeroTier 地址后二维码与手机连接均使用该地址，配对和 bridge 正常。
- 未完成：远控对话框内的地址选择 UI、运行中地址变化（ZeroTier 掉线/切换）的自动刷新与提示；按计划留到 P3。

P3（2026-11-15，完成，真机待验收）：

- `deviceSid` 持久化：设置新增 `webRemoteControlLocalDeviceSid`；首次启动生成后写入设置，之后 relay 复用同一 SID，桌面重启不会让手机旧链接失效。relay 选项新增 `deviceSid`。
- 静态资源打包：`node scripts/build-remote-v4-assets.mjs` 构建 `/remote/v4` 到 `packages/desktop/bundled-resources/remote/v4`，`prepare:runtime-assets` 自动执行，electron-builder 以 `extraResources` 发布到 `resources/remote/v4`；开发态读取 `app.getAppPath()/bundled-resources/remote/v4`，打包态读取 `process.resourcesPath/remote/v4`，不再要求手动设置 assets 目录。
- 设置 UI：设置页「数据与统计」新增「局域网远控」分区（`LocalRemoteSettingsSection`）：二维码地址选择（`webRemoteControlLocalPreferredAddress`）、relay 状态与配对码展示；没有启用开关，本地 relay 始终启用。远控本身仍从主界面「移动端远程控制」对话框启动。
- 平台接口：`getWebRemoteControlLocalState` / `setWebRemoteControlLocalAddress` 经 `IPlatformService`、preload、IPC 与 renderer 适配层接通；Web 端保留空实现。
- 已验证：本地 relay 在首次启动远控时监听 47821；地址切到 ZeroTier 后对话框二维码变为 `192.168.192.10`；手机连接配对、bridge active；停止远控后 relay 撤销配对状态。
- 回归测试增加「复用已持久化 deviceSid」用例；设置分区顺序断言同步更新。
- 未完成：真实手机与预览版安装包验收（需要用户在现场执行 LLR-01/02/09）。

收尾（2026-11-15）：

- 配对码改为每次 relay 启动随机生成 6 位数字；对话框新增「刷新二维码」，轮换配对码、撤销手机 sessionToken 并重启远控 runtime。
- 防火墙不再检测：应用不调用 `firewall-cmd`/`ufw`，只在对话框「等待手机连接」处提供说明链接，按平台展示手动命令。
- 二维码地址失效（如 ZeroTier 掉线）时返回 `addressUnavailable`，对话框提示重新选择地址。
- 手机端 sessionToken 被撤销后 401 会清除本地 sessionToken，并显示「配对已失效，请重新扫码」，不再落到官方登录页。

验收状态（2026-11-16）：

- `pnpm verify:pre-push` 通过：工作区、Lint、文档短语、schema、架构检查均 OK；`test:engineering:affected` 因选中全量（207/207）被脚本主动跳过，未实际执行；单独运行 relay 与设置分区用例共 16 项通过。
- 真机：Wi-Fi 扫码连接已确认可用；ZeroTier、双手机替换、桌面重启三场景按用户要求不再测试。
- 打包态：本地 `electron-builder --linux dir` 未完成。依次受 `packages/desktop/package.json` 缺 `version`、`cpu-features` native 重建失败（Electron 44 头文件与 `-Werror` 冲突）、打包工具二进制下载超时阻塞；`dist` 未生成。`resources/remote/v4` 的打包集成需由 CI/发布流水线验证。
- 发布：随 `v3.18.3` 发布（桌面六目标 + CLI）。首次构建因 `packages/desktop/package.json` 缺少 `prepare:remote-v4` 脚本失败；修复后重发同版本。

## 已确认决策

1. **端口**：固定 `47821`，被占用时明确失败，不自动换端口。
2. **静态资源**：生产版打包进桌面包（`resources/remote/v4`）；开发与 PoC 阶段允许用环境变量指向本地构建目录。
3. **传输加密**：直接使用 HTTP/WS，不引入 TLS。ZeroTier 自带链路加密；局域网按可信网络处理。
4. **并发**：同一时间只允许一台手机；第二台连接替换第一台，不做并行控制。

## 未决问题

（当前无阻塞项；真机验收见验收场景。）
