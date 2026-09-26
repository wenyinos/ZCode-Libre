# ZCode-Libre

<div align="center">
  <img src="public/logo/zcode-libre.svg" alt="ZCode-Libre" width="128" height="128" />
</div>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>
<p align="center">
  <a href="https://wenyinos.github.io/ZCode-Libre/">Website</a> ·
  <a href="https://github.com/wenyinos/ZCode-Libre/releases">Download</a> ·
  <a href="https://github.com/wenyinos/ZCode-Libre/discussions">Discussions</a>
</p>

ZCode-Libre is an AI coding workspace with desktop, browser, and terminal interfaces. This repository contains the clients, backend services, shared UI, and Agent CLI and runtime source code.

ZCode-Libre is a community fork of [ZCode](https://github.com/zai-org/ZCode), following the same pattern as Chrome → Chromium and VS Code → VSCodium: it keeps the upstream feature set and full commit history while shipping under its own product identity and release channel, so it can be audited, distributed, and localized independently.

<div align="center">
  <a href="docs/promo/intro-poster.png">
    <img src="docs/promo/intro-poster-preview.png" alt="ZCode-Libre project overview" width="520" />
  </a>
  <br />
  <a href="https://wenyinos.github.io/ZCode-Libre/">wenyinos.github.io/ZCode-Libre</a>
</div>

## Differences from upstream

| Area            | Upstream ZCode          | ZCode-Libre                              |
| --------------- | ----------------------- | ---------------------------------------- |
| Product name    | ZCode                   | ZCode-Libre                              |
| Application ID  | `dev.zcode.app`         | `dev.zcode-libre.app`                    |
| Application icon| Rounded square, white Z | Circle, teal-to-indigo gradient Z        |
| Distribution    | Upstream official releases | Built and shipped from this repository |
| Sessions & settings | —                   | Shared with upstream                     |
| UI preferences  | `ZCode` data directory  | `ZCode-Libre` data directory (separate)  |

**Sessions and settings are shared with upstream.** Session history, model settings, and your model provider credentials live in the `.zcode` data root (`~/.zcode/cli/db/db.sqlite`, `~/.zcode/v2/setting.json`), so the two are fully interchangeable: installing this fork reads the official client's conversations and configuration directly — no data migration or re-login. (The one exception is official account credentials — see the next point.)

**UI preferences are independent.** The Electron user data directory is `ZCode-Libre`, so theme, locale, panel layout, and the sign-in state of the embedded browser and Coding Plan webviews stay separate. The two clients can therefore **run at the same time**, and they never share Electron caches across diverging versions.

**Official accounts and subscriptions are not used.** This fork offers no official account sign-in, and it does not read the account credentials the official client leaves in the shared data root — login tokens and account-scoped keys are treated as absent, so the fork reports you as signed out even if you signed in through the official client.

This is not a missing feature but an honest boundary: the upstream open-source release itself states that it does not promise the official product's full feature set or promotional policies (see [NOTICE.md](NOTICE.md)). Inheriting the official client's sign-in would get you neither the plan nor the promotions you would expect there, and the login token expires — refreshing it needs a re-login this fork cannot offer, so you would be left with "it worked for a while, then stopped, and I cannot fix it". Add **your own API key** under Model Providers instead.

For the upstream sync workflow and the full list of divergences, see [UPSTREAM.md](UPSTREAM.md).

The following identifiers are **intentionally kept identical to upstream** because they are cross-platform contracts rather than brand surfaces; changing them would break compatibility with existing servers, protocols, and user projects: the `zcode://` protocol scheme, the `@zcode/*` package scope, the `ZCODE_*` environment variable prefix, the `.zcode` data root (including `.zcode/config.json`, `.zcode/agents` in user projects), and the `zcode` CLI command name.

## Telemetry and vendor services

Telemetry and services backed by the vendor backend are **off by default**. The changes follow a "default off, keep the code" approach so upstream can still be merged cleanly; every switch is registered in [UPSTREAM.md](UPSTREAM.md).

| Item | Default | How to enable |
| --- | --- | --- |
| Telemetry (warehouse / ARMS / OTLP) | off | Set `ZCODE_TELEMETRY_ENABLED=1` |
| Official account sign-in (z.ai / BigModel OAuth) | off | Set `ZAI_OAUTH_ENABLED=1` / `BIGMODEL_OAUTH_ENABLED=1` |
| Conversation sharing (upload to remote) | off | `packages/shared/src/libre-features.ts` |
| User feedback | off | same file |
| Coding Plan upgrade entry | off | same file |
| Remote plugin marketplace (CDN catalog) | off | same file; bundled plugins are unaffected |
| In-app updates | own Releases, check only | Detects a newer release and sends you to this repository's Releases to download; nothing is downloaded or installed in-app |

Bundled capability plugins (browser control, documents, PDF, spreadsheets, presentations) stay enabled by default — they do not depend on vendor services.

### Updates

"Help → Check for Updates" only queries this repository's GitHub Release and compares versions. It never reads the vendor update manifest the way upstream does — that manifest points at official ZCode and installing it would overwrite this fork. When a newer version exists, the dialog offers a "Go to download" button that opens the Release page in your browser, where you pick the installer for your platform.

### Connecting models with an API key

Official sign-in is off by default; models are connected with an API key and need no account at all:

1. The first launch shows the setup screen, which defaults to the API key form. You can also add providers later from Settings → Model Providers.
2. Pick a channel, paste the key, save. Subsequent launches are not blocked by a sign-in page.

Two kinds of key take different request paths:

| Template | Endpoint | Request path |
| --- | --- | --- |
| Z.ai / BigModel **standard API** | `https://api.z.ai/api/paas/v4`, `https://open.bigmodel.cn/api/paas/v4` | **Direct** to the vendor API, no intermediate gateway |
| Z.ai / BigModel (login page default) | `https://api.z.ai/api/anthropic`, `https://open.bigmodel.cn/api/anthropic` | Routed through the ZCode platform gateway for plan-entitlement checks (auth headers are passed through unchanged and do not depend on a signed-in account) |

Use the **standard API** template in Settings → Model Providers when you want to bypass the vendor gateway entirely. Coding Plan keys must go through the gateway, because entitlement checks happen there.

## Updates

- 2026-09-24: Established the ZCode-Libre brand fork: independent application identity, independent data directory, a new circular mark, and a sync of the upstream v3.14.3 source.

## Setup

Install Git, Node.js **24.14.0**, and pnpm **10.33.2**. [mise.toml](mise.toml) is the source of truth for tool versions. Run all development and packaging commands below from the repository root.

```bash
pnpm bootstrap
```

`pnpm bootstrap` installs workspace dependencies, prepares local desktop runtime assets, and runs `build:bootstrap`.

The Agent CLI and runtime source code lives in [apps/zcode-cli/](apps/zcode-cli/) as a regular directory included when you clone this repository. No separate checkout or Git submodule initialization is required.

Additional setup and build commands:

| Command                        | Purpose                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                 | Install dependencies                                                                                                                |
| `pnpm prepare:desktop-runtime` | Prepare desktop runtime assets, including remote assets by default                                                                  |
| `pnpm prepare:remote-assets`   | Prepare remote runtime assets separately                                                                                            |
| `pnpm bootstrap:with-remote`   | Set up dependencies and local and remote assets, then build the relevant packages sequentially; skip the desktop application bundle |
| `pnpm build`                   | Recursively run each workspace package's build script, including its asset preparation steps                                        |

`bootstrap` skips remote asset preparation by default, which suits local desktop development. Run the corresponding preparation command when you use a remote workspace or verify remote release assets.

## Development and running

### Desktop

```bash
pnpm dev:desktop

# Use the test environment
pnpm dev:desktop:test
```

`pnpm dev:desktop` defaults to `pnpm dev:desktop:prod` and uses the production service configuration. The launch script prepares local runtime assets, builds the desktop Agent, then starts Electron and the source watchers.

To use a separate development data directory, set `ZCODE_DATA_BASE_DIR`. For example, on macOS / Linux:

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

### Remote features (SSH/WSL)

Run `pnpm bootstrap:with-remote` to prepare remote assets (mock-cdn), then `pnpm dev:desktop`; when connecting to a remote project, choose "download locally and upload" for assets. In development the assets come from the local `packages/desktop/mock-cdn` and local build output, uploaded to the remote over SFTP without contacting a CDN.

### Web development

When changing Web or backend source, use development mode:

```bash
pnpm dev:web

# Specify the backend workspace (macOS / Linux)
ZCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

This starts the Web dev server (default `http://localhost:5173`) and the backend (default `http://localhost:3030`) together; open the former in a browser. `/ws` and general `/api` requests proxy to the local backend, while `/api/v1/oauth/token` proxies separately to the currently configured product service.

After changing Agent source, run `pnpm --filter @zcode/cli... build` and restart the service. To verify the full distribution package, extract and run it as described in the "Command-line distribution" section below.

### ZCode-Libre command-line distribution

The command-line distribution bundles the TUI, Web, and Agent and is launched uniformly with `zcode`: no arguments enters the TUI; `--web` as the first argument starts the Web UI; any other arguments are passed through to the existing Agent CLI. Both modes run locally without Electron.

```bash
# Enter the terminal interface by default
zcode

# Start the Web UI
zcode --web

# Specify the project and port without opening a browser
zcode --web --workspace /path/to/project --port 3030 --no-open

# Show CLI or Web options
zcode --help
zcode --web --help
```

Web mode uses the current directory as the workspace by default, listens on `127.0.0.1`, starts without an access token, picks a free port, and opens the browser. Open the address printed in the terminal and press `Ctrl+C` to stop the server. For LAN access use `--host 0.0.0.0`; when listening on a non-local address a token is generated by default, and you can use the tokenized link printed in the terminal. Pass `--token` to specify a token or `--no-token` to disable token authentication.

When starting the generic Web service HTTP entry directly, configure API/WebSocket authentication through `ZCODE_SERVER_AUTH_TOKEN`; when creating the service programmatically, use the `authToken` option.

For build instructions see the packaging section below. `pnpm build:zcode` only produces the distribution package; it does not replace an existing `zcode` on `PATH`. If the command still points to an older install or another source checkout, check with `command -v zcode` on macOS / Linux or `where.exe zcode` on Windows.

### CLI source development

To work directly on the TUI or Agent, run the source entry points:

```bash
pnpm --filter @zcode/cli dev --help
pnpm --filter @zcode/cli dev

# Build the CLI and its workspace dependencies
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

This entry runs the Agent CLI directly and does not go through the distribution package's `--web` routing. Use `pnpm dev:web` for Web development; to verify the unified `zcode` command, use the extracted `bin/zcode.mjs` described below.

## Configuration

The root [.env.example](.env.example) provides examples for service addresses and build configuration; copy it to `.env` as needed and put local overrides in `.env.local`. The Desktop development environment is selected through `dev:desktop:test` / `dev:desktop:prod`.

| Configuration                        | Purpose                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `ZCODE_DATA_BASE_DIR`                | Base directory for application data; data is written under its `.zcode/`      |
| `ZCODE_SERVER_WORKSPACE`             | Workspace path for the Web backend                                             |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | Path to a local Provider configuration file; the built-in config is used otherwise |
| `ZCODE_DIST_BASE_URL`                | Download root used by the command-line install script                          |

Runtime variables can be set explicitly in the launch command's environment. See [config/README.md](config/README.md) for the defaults shipped with the client.

## Packaging

For third-party notice generation, the release verification flow, and where the notices live in the release artifacts, see [third-party/README.md](third-party/README.md).

### Desktop

```bash
pnpm bundle:desktop

# Specify target platform and CPU architecture
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

The default target is macOS arm64 and the default output directory is `packages/desktop/dist/`. `--os` accepts `mac`, `win`, `linux`; `--arch` accepts `x64`, `arm64`. Actual packaging and signing require the tools and configuration for the target platform.

Installation: open the produced DMG, then drag ZCode-Libre into "Applications". Local builds are unsigned; if macOS blocks the first launch, run:

```bash
sudo xattr -rd com.apple.quarantine /Applications/ZCode-Libre.app
```

### Command-line distribution

The build entry point is `pnpm build:zcode`. The script builds the CLI/TUI, backend, and Web in sequence, collects the TUI's native libraries, workers, and runtime dependencies, and assembles the distribution package; running the package still requires Node.js, with the version pinned by `mise.toml`.

Before packaging you must set the download root `ZCODE_DIST_BASE_URL` (in `.env`, `.env.local`, or the environment), or pass it through `--base-url`. The address below is a placeholder example; replace it with the real hosting address when publishing:

```bash
pnpm build:zcode --base-url https://downloads.example.com/zcode/

# When ZCODE_DIST_BASE_URL is already configured
pnpm build:zcode

# Repackage only, reusing existing Agent, backend, and Web build output
pnpm build:zcode --skip-build

# Show version, output directory, and other optional arguments
pnpm build:zcode --help
```

The default version comes from the root `package.json`, and the output directory is `dist/zcode/`:

- `releases/<version>/zcode-<version>.tar.gz`: the runtime package.
- `releases/<version>/sha256.txt`: checksum digests.
- `latest.json`, `install.sh`: version index and install script.

The complete directory can be uploaded to the configured download root. The install script downloads the runtime package from that address, installs to `~/.zcode/runtime` by default, and creates a `zcode` command in `~/.local/bin`. The install directory can be changed with `ZCODE_DIST_HOME`, and the command directory with `ZCODE_DIST_BIN_DIR`.

To debug a packaged artifact locally, extract and run it directly without uploading or installing:

```bash
zcode_version=$(node -p "require('./dist/zcode/latest.json').version")
mkdir -p dist/zcode/debug
tar -xzf "dist/zcode/releases/$zcode_version/zcode-$zcode_version.tar.gz" \
  -C dist/zcode/debug
# Start the TUI by default
node dist/zcode/debug/zcode/bin/zcode.mjs

# Start the Web UI
node dist/zcode/debug/zcode/bin/zcode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

Open `http://127.0.0.1:3030` in a browser to verify the full path where the same backend serves the Web page and the Agent. That port must be free; if `pnpm dev:web` is already running, use a different `--port`.

## Brand assets

The application icon is generated from a single source file, [public/logo/zcode-libre.svg](public/logo/zcode-libre.svg). After changing the mark, regenerate all bitmap assets:

```bash
python3 scripts/generate-logo-assets.py
```

The script requires ImageMagick (the `magick` command, with librsvg support) and Python's Pillow. It distributes PNG/ICO/ICNS files to `public/logo/icons/`, `public/icon_512@2x.png`, and `packages/desktop/build/`.

## Repository layout

| Directory                                            | Responsibility                                                |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `packages/desktop`                                   | Electron main, host, renderer, and desktop packaging          |
| `packages/web`                                       | Web client                                                    |
| `packages/server`                                    | HTTP / WebSocket services and remote connections              |
| `packages/zcode-server-cli`                          | Standalone server launch and process management               |
| `packages/ui`                                        | Shared React components, hooks, and Zustand state             |
| `packages/services`                                  | Business services and persistence                             |
| `packages/shared`, `packages/rpc`, `packages/client` | Shared protocols and types, RPC framework, Agent client SDK   |
| `packages/provider`, `packages/provider-node`        | Provider common capabilities and Node implementation          |
| `apps/zcode-cli`                                     | Agent CLI, TUI, runtime, and tooling                          |
| `scripts`, `config`, `third-party`                   | Build and maintenance scripts, built-in config, third-party notices |

## License and provenance

This source code comes from ZCode. First-party code is licensed under Apache-2.0 per the root [LICENSE](LICENSE), with original copyright held by Z.AI Co., Ltd. Modifications, brand assets, and build output in ZCode-Libre are maintained by this fork and offered under the same Apache-2.0 terms; that license grants no additional rights on behalf of other rights holders and does not cover third-party software, copied code, native binaries, fonts, icons, or web assets.

For feature scope, maintenance rules, execution and data risks, and the complete third-party attribution, see [NOTICE.md](NOTICE.md).
