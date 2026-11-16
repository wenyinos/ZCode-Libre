#!/usr/bin/env node
// 带重试的 pnpm install。用于 Release 构建：容器内 pnpm 偶发在 postinstall
// 阶段出现临时目录 rename 的 ENOENT（bundle-require -> esbuild），重试即可恢复。
import { spawnSync } from "node:child_process";

const attempts = Number(process.env.ZCODE_INSTALL_ATTEMPTS ?? 3);
const delayMs = Number(process.env.ZCODE_INSTALL_RETRY_DELAY_MS ?? 5_000);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = spawnSync(pnpmCommand, ["install", "--frozen-lockfile"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status === 0) process.exit(0);
  if (attempt === attempts) {
    console.error(`[install] pnpm install failed after ${attempts} attempts`);
    process.exit(result.status ?? 1);
  }
  console.warn(
    `[install] attempt ${attempt} failed (status ${result.status ?? "signal"}); retrying in ${delayMs}ms`,
  );
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
