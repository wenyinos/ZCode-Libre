#!/usr/bin/env node
/**
 * 发布说明生成：把 Release 页面的改动清单分成两栏。
 *
 * 一栏是本分支自己加的（额度显示、品牌、默认关闭项等），另一栏是从上游合并进来的。
 * 分类依据是**提交是否在上游 main 的可达范围内**——比按作者名或提交信息语言猜测可靠得多：
 * 上游作者会换，提交信息也可能被我们改写（品牌名替换脚本就会改）。
 *
 * 用法：
 *   node scripts/generate-release-notes.mjs --to v3.14.4
 *   node scripts/generate-release-notes.mjs --from v3.14.2 --to HEAD
 *   node scripts/generate-release-notes.mjs --template .github/release-body-template.md --out body.md
 *
 * 未指定 --from 时自动取目标 ref 上时间最近的一个 v* tag。上游 ref 不存在时不会猜，
 * 而是退化成单栏并写明原因——把本分支改动标成上游改动比不分类更糟。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);

function readArg(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${name} 需要一个取值`);
    process.exit(2);
  }
  return value;
}

const toRef = readArg("--to", "HEAD");
const fromRefArg = readArg("--from");
const upstreamRef = readArg("--upstream", "upstream/main");
const templatePath = readArg("--template");
const outPath = readArg("--out");

function git(gitArgs) {
  return execFileSync("git", gitArgs, { encoding: "utf8" }).trim();
}

function gitLines(gitArgs) {
  const output = git(gitArgs);
  return output ? output.split("\n").filter(Boolean) : [];
}

function revParse(ref) {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    return null;
  }
}

/** 目标 ref 上时间最近的一个 v* tag，作为「上次发布」基准。 */
function resolvePreviousTag(to) {
  const toSha = revParse(to);
  for (const tag of gitLines(["tag", "--merged", to, "--sort=-creatordate", "--list", "v*"])) {
    if (revParse(tag) !== toSha) {
      return tag;
    }
  }
  return null;
}

// 目标 ref 解析不了就直接说清楚：Release tag 由 CI 在发布时创建，
// 本地没同步过的 tag 是最常见的失败原因，让 git 抛原始错误反而难定位。
if (!revParse(toRef)) {
  console.error(`找不到目标 ref「${toRef}」。先同步远端 tag：`);
  console.error("  git fetch origin --tags");
  process.exit(2);
}

const fromRef = fromRefArg ?? resolvePreviousTag(toRef);
const range = fromRef ? `${fromRef}..${toRef}` : toRef;

/** 上游可达集合。拿不到上游 ref 时返回 null，由调用方决定怎么降级。 */
function readUpstreamShas() {
  if (!revParse(upstreamRef)) {
    return null;
  }
  return new Set(gitLines(["rev-list", upstreamRef]));
}

const upstreamShas = readUpstreamShas();

// 合并提交本身只是记账（「把上游合进来」），真正的内容改动都在各自提交里，因此不列。
const commits = gitLines(["log", "--no-merges", "--reverse", "--format=%H%x09%s", range]).map(
  (line) => {
    const [sha, ...subjectParts] = line.split("\t");
    return { sha, subject: subjectParts.join("\t") };
  },
);

const forkCommits = [];
const upstreamCommits = [];
for (const commit of commits) {
  if (upstreamShas?.has(commit.sha)) {
    upstreamCommits.push(commit);
  } else {
    forkCommits.push(commit);
  }
}

function renderSection(title, items, emptyText) {
  const lines = [`### ${title}`, ""];
  if (items.length === 0) {
    lines.push(`_${emptyText}_`);
  } else {
    for (const item of items) {
      lines.push(`- ${item.subject} (\`${item.sha.slice(0, 7)}\`)`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

const changelogParts = ["## 本次更新 / What's new", ""];

if (upstreamShas === null) {
  // 宁可只给一栏，也不要把本分支改动标成上游改动。
  changelogParts.push(
    `_未能读取上游 ref「${upstreamRef}」，本次不区分来源，以下为自 ${fromRef ?? "仓库起始"} 以来的全部改动。_`,
    "",
  );
  for (const item of [...forkCommits, ...upstreamCommits]) {
    changelogParts.push(`- ${item.subject} (\`${item.sha.slice(0, 7)}\`)`);
  }
  changelogParts.push("");
} else {
  changelogParts.push(
    renderSection("本仓库新增 / Added in this fork", forkCommits, "无"),
    renderSection("上游合并 / Merged from upstream", upstreamCommits, "无"),
  );
}

const changelog = changelogParts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

const body = templatePath
  ? readFileSync(templatePath, "utf8").replace("{{CHANGELOG}}", changelog)
  : changelog;

if (outPath) {
  writeFileSync(outPath, body, "utf8");
  console.error(
    `已写入 ${outPath}：本仓库 ${forkCommits.length} 条，上游 ${upstreamCommits.length} 条` +
      `（范围 ${fromRef ?? "仓库起始"}..${toRef}）`,
  );
} else {
  process.stdout.write(body);
}
