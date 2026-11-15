#!/usr/bin/env node
// 构建手机远控页面并放进桌面打包资源。单独入口，避免开发态每次 dev 都重新构建。
import { spawn } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(
  repoRoot,
  "packages/desktop/bundled-resources/remote/v4",
);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

rmSync(outputDir, { recursive: true, force: true });

const startedAt = Date.now();
const child = spawn(
  pnpmCommand,
  [
    "--filter",
    "@zcode/web",
    "exec",
    "vite",
    "build",
    "--base=/remote/v4/",
    "--outDir",
    outputDir,
  ],
  {
    cwd: repoRoot,
    env: { ...process.env, VITE_WEB_REMOTE_CONTROL_ROUTE_PATH: "/remote/v4" },
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

const exitCode = await new Promise((resolveExit) => {
  child.once("error", (error) => {
    console.error("[remote-v4] failed to start vite build", error);
    resolveExit(1);
  });
  child.once("exit", (code) => resolveExit(code ?? 1));
});
if (exitCode !== 0) {
  process.exit(exitCode);
}

const indexPath = join(outputDir, "index.html");
if (!existsSync(indexPath)) {
  console.error(`[remote-v4] build finished without ${indexPath}`);
  process.exit(1);
}

const bytes = statSync(indexPath).size;
console.log(
  `[remote-v4] built ${outputDir} in ${Date.now() - startedAt}ms (index ${bytes} bytes)`,
);
