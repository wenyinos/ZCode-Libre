#!/usr/bin/env node
/**
 * 上游改动审计。
 *
 * 本分支维护着一批故意偏离上游的改动（全部登记在 UPSTREAM.md）。同步前先跑这个脚本：
 * 它列出上游尚未合入的提交，并标出其中动到了本分支偏离文件的那些 —— 那才是需要人工过目的地方，
 * 其余提交按上游版本直接合入即可。
 *
 * 用法：
 *   node scripts/audit-upstream-sync.mjs                  # 审计 upstream/main 上未合入的提交
 *   node scripts/audit-upstream-sync.mjs upstream/main~30 # 指定上游基准点
 *   node scripts/audit-upstream-sync.mjs --strict         # 有高危提交时以退出码 1 结束（供 CI 使用）
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const upstreamRef = args.find((arg) => !arg.startsWith("--")) ?? "upstream/main";

function git(gitArgs) {
  return execFileSync("git", gitArgs, { encoding: "utf8" }).trim();
}

function gitLines(gitArgs) {
  const output = git(gitArgs);
  return output ? output.split("\n").filter(Boolean) : [];
}

/** 上游 ref 必须存在，否则后面的 diff 会静默给出空结果。 */
try {
  git(["rev-parse", "--verify", upstreamRef]);
} catch {
  console.error(`找不到上游 ref「${upstreamRef}」。先执行：`);
  console.error("  git remote add upstream https://github.com/zai-org/ZCode   # 若尚未添加");
  console.error("  git fetch upstream");
  process.exit(2);
}

// 本分支相对上游改过的文件：`git diff` 用三方比较，只看内容差异，不受提交历史形态影响。
const divergentFiles = new Set(gitLines(["diff", "--name-only", `${upstreamRef}...HEAD`]));

// 上游尚未合入的提交。
const commits = gitLines(["log", "--reverse", "--format=%H%x09%h%x09%s", `HEAD..${upstreamRef}`]).map(
  (line) => {
    const [sha, shortSha, ...subjectParts] = line.split("\t");
    return { sha, shortSha, subject: subjectParts.join("\t") };
  },
);

console.log(`上游基准：${upstreamRef}`);
console.log(`本分支偏离上游的文件：${divergentFiles.size} 个`);
console.log(`上游待合入提交：${commits.length} 个\n`);

if (commits.length === 0) {
  console.log("上游没有新提交，无需审计。");
  process.exit(0);
}

const highRisk = [];
const lowRisk = [];

for (const commit of commits) {
  const touched = gitLines(["show", "--name-only", "--format=", commit.sha, "--"]);
  const overlap = touched.filter((file) => divergentFiles.has(file));
  if (overlap.length > 0) {
    highRisk.push({ ...commit, overlap });
  } else {
    lowRisk.push(commit);
  }
}

if (highRisk.length > 0) {
  console.log(`需要人工过目的提交：${highRisk.length} 个`);
  console.log("（这些提交动到了本分支已偏离的文件，合并时可能覆盖我们的改动）\n");
  for (const item of highRisk) {
    console.log(`  ⚠ ${item.shortSha} ${item.subject}`);
    for (const file of item.overlap) {
      console.log(`      ${file}`);
    }
  }
  console.log("");
}

if (lowRisk.length > 0) {
  console.log(`未触及偏离文件的提交：${lowRisk.length} 个（按上游版本合入即可）`);
  for (const item of lowRisk.slice(0, 20)) {
    console.log(`  · ${item.shortSha} ${item.subject}`);
  }
  if (lowRisk.length > 20) {
    console.log(`  … 其余 ${lowRisk.length - 20} 个省略`);
  }
  console.log("");
}

console.log("审计建议：");
console.log("  1. 先处理上面标记为 ⚠ 的提交，逐条确认是否覆盖了 UPSTREAM.md 登记的改动；");
console.log("  2. 合并后运行 node scripts/check-defaults-regression.mjs 验证不变量仍然成立；");
console.log("  3. 再运行 python3 scripts/apply-brand-naming.py --write 补齐新文案的品牌名。");

if (strict && highRisk.length > 0) {
  process.exit(1);
}
