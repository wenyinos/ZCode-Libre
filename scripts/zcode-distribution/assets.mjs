import { chmod, cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import {
  collectSeaTuiAssets,
  seaTuiAssetPrefix,
} from "../../apps/zcode-cli/packages/cli/scripts/sea-tui-assets.mjs";
const root = resolve(import.meta.dirname, "../..");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const runtimePackageNames = [
  "@hono/node-server",
  "@hono/node-ws",
  "ssh2",
  "node-pty",
  "undici",
  "axios",
  "form-data",
  "combined-stream",
  "follow-redirects",
  "proxy-from-env",
  "ws",
  "hono",
  "yaml",
  "yazl",
  // HTTP bundle 将 yauzl 外置；发行包必须携带它，否则脱离仓库就无法启动后端。
  "yauzl",
  "node-forge",
];

// ZCode-Libre：命令行版只发行 macOS arm64 与 Linux x64/arm64 三个平台，因此包里
// 也只带这三个平台的原生件（上游的 SEA 目标矩阵保持不动，那是另一条发行链路）。
const cliReleaseTargets = ["darwin-arm64", "linux-x64", "linux-arm64"];

export async function stageTuiRuntime(packageRoot) {
  const stagingDirectory = resolve(packageRoot, "../tui-staging");
  const copied = new Map();
  try {
    for (const target of cliReleaseTargets) {
      const { assets, manifest } = await collectSeaTuiAssets({
        root: resolve(root, "apps/zcode-cli"),
        stagingDirectory,
        target,
      });
      for (const file of manifest.files) {
        const previous = copied.get(file.path);
        if (previous) {
          if (previous !== file.sha256)
            throw new Error(`Conflicting TUI asset: ${file.path} (${target})`);
          continue;
        }
        const destination = resolve(packageRoot, "agent", file.path);
        await mkdir(dirname(destination), { recursive: true });
        await cp(assets[`${seaTuiAssetPrefix}${file.path}`], destination);
        await chmod(destination, file.mode);
        copied.set(file.path, file.sha256);
      }
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}
// 与 cliReleaseTargets 对齐，只带这三个平台的原生件。
const lydellNodePtyPackages = [
  "@lydell/node-pty-darwin-arm64",
  "@lydell/node-pty-linux-arm64",
  "@lydell/node-pty-linux-x64",
];

function shouldCopyPackagePath(packageDirectory, source) {
  const rel = relative(packageDirectory, source);
  if (!rel) {
    return true;
  }
  const parts = rel.split(sep);
  return !parts.includes("node_modules") && !parts.includes(".git");
}

async function resolvePackageJsonPath(requireFrom, packageName) {
  try {
    return requireFrom.resolve(`${packageName}/package.json`);
  } catch (error) {
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      throw error;
    }
    let current = dirname(requireFrom.resolve(packageName));
    for (;;) {
      const candidate = resolve(current, "package.json");
      if (await pathExists(candidate)) {
        try {
          const packageJson = await readJson(candidate);
          if (packageJson.name === packageName) {
            return candidate;
          }
        } catch {
          // Keep walking; malformed nested metadata should not pick the package root.
        }
      }
      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      current = parent;
    }
  }
}

async function copyRuntimePackageTree({ packageName, packageRoot, requireFrom, seen }) {
  if (seen.has(packageName)) {
    return;
  }
  seen.add(packageName);

  let packageJsonPath;
  try {
    packageJsonPath = await resolvePackageJsonPath(requireFrom, packageName);
  } catch (error) {
    throw new Error(`Unable to resolve runtime package ${packageName}`, {
      cause: error,
    });
  }

  const packageDirectory = dirname(packageJsonPath);
  const destination = resolve(packageRoot, "node_modules", ...packageName.split("/"));
  await mkdir(dirname(destination), {
    recursive: true,
  });
  await cp(packageDirectory, destination, {
    dereference: true,
    force: true,
    recursive: true,
    filter: (source) => shouldCopyPackagePath(packageDirectory, source),
  });

  const packageJson = await readJson(packageJsonPath);
  const requireFromPackage = createRequire(packageJsonPath);
  const dependencies = Object.assign(
    {},
    packageJson.dependencies,
    packageJson.optionalDependencies,
  );
  for (const dependencyName of Object.keys(dependencies)) {
    try {
      await copyRuntimePackageTree({
        packageName: dependencyName,
        packageRoot,
        requireFrom: requireFromPackage,
        seen,
      });
    } catch (error) {
      if (!Object.hasOwn(packageJson.optionalDependencies ?? {}, dependencyName)) {
        throw error;
      }
      console.warn(`[zcode] optional package ${dependencyName} is unavailable; skipping`);
    }
  }
}

export async function copyRuntimeNodeModules(packageRoot) {
  const requireFromServer = createRequire(resolve(root, "packages", "server", "package.json"));
  const seen = new Set();
  for (const packageName of runtimePackageNames) {
    await copyRuntimePackageTree({
      packageName,
      packageRoot,
      requireFrom: requireFromServer,
      seen,
    });
  }
  // CLI 的浏览器运行时同样是外部依赖，不能依赖开发仓库的 hoisted node_modules。
  await copyRuntimePackageTree({
    packageName: "playwright-core",
    packageRoot: resolve(packageRoot, "agent"),
    requireFrom: createRequire(resolve(root, "apps/zcode-cli/packages/cli/package.json")),
    seen: new Set(),
  });
}

export async function patchNodePtyPrebuilds(packageRoot) {
  const requireFromServer = createRequire(resolve(root, "packages", "server", "package.json"));
  const nodePtyPrebuildRoot = resolve(packageRoot, "node_modules", "node-pty", "prebuilds");

  for (const packageName of lydellNodePtyPackages) {
    let packageJsonPath;
    try {
      packageJsonPath = await resolvePackageJsonPath(requireFromServer, packageName);
    } catch {
      console.warn(`[zcode] ${packageName} is unavailable; skipping node-pty prebuild patch`);
      continue;
    }
    const sourcePrebuildRoot = resolve(dirname(packageJsonPath), "prebuilds");
    const sourceStat = await stat(sourcePrebuildRoot).catch(() => null);
    if (!sourceStat?.isDirectory()) {
      continue;
    }
    await cp(sourcePrebuildRoot, nodePtyPrebuildRoot, {
      dereference: true,
      force: true,
      recursive: true,
    });
  }

  for (const helper of [resolve(nodePtyPrebuildRoot, "darwin-arm64", "spawn-helper")]) {
    if (await pathExists(helper)) {
      await chmod(helper, 0o755);
    }
  }

  // node-pty 主包自带多平台 prebuild；不属于发行平台的目录直接删掉，
  // 避免包里夹带 Windows 与 Intel Mac 的二进制。
  const prebuildStat = await stat(nodePtyPrebuildRoot).catch(() => null);
  if (prebuildStat?.isDirectory()) {
    for (const entry of await readdir(nodePtyPrebuildRoot)) {
      if (!cliReleaseTargets.includes(entry)) {
        await rm(resolve(nodePtyPrebuildRoot, entry), {
          force: true,
          recursive: true,
        });
      }
    }
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
