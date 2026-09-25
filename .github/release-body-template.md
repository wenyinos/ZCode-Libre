## 下载 / Downloads

未签名构建，首次打开会被系统安全提示拦截；用下方 `checksums.txt` 核对 SHA256。
Unsigned builds — the first launch is blocked by Gatekeeper / SmartScreen. Verify against `checksums.txt`.

**macOS**（Apple Silicon / arm64）

下载 `.dmg`，把 ZCode-Libre 拖入「应用程序」。首次打开若被拦截：
`sudo xattr -rd com.apple.quarantine /Applications/ZCode-Libre.app`

**Windows**（x64）

下载 `.exe`，SmartScreen 提示时选「更多信息」→「仍要运行」。

**Linux**（x64 与 arm64 均可用）

按发行版选择系统包：包在对应发行版容器内构建，使用该发行版原生的打包后端。

| 发行版 / Distro | 包格式 |
|---|---|
| Debian / Ubuntu | `.deb`（`sudo apt install ./<file>.deb`） |
| Fedora / RHEL / openSUSE | `.rpm`（`sudo dnf install ./<file>.rpm`） |

架构按文件名后缀区分：`x86_64`/`amd64` 为 64 位 x86，`aarch64`/`arm64` 为 ARM64。

安装后从应用菜单启动；走终端时用完整路径 `/opt/ZCode-Libre/zcode-libre`
（包不提供 `/usr/bin` 入口）。本分支与官方 ZCode 共用 `.zcode` 数据根，
但使用独立的界面偏好目录，因此两者可以同时安装、同时运行。

{{CHANGELOG}}

## 关于这个版本 / About this build

- 遥测与厂商服务默认关闭，模型用你自己的 API Key 接入。
- 应用内更新只检测本仓库的 Release 并引导下载，不会自动安装，也不会被换回官方版本。
- 与上游的完整差异见 [UPSTREAM.md](https://github.com/wenyinos/ZCode-Libre/blob/main/UPSTREAM.md)。
