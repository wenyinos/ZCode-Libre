#!/usr/bin/env python3
"""把用户可见文案中的产品名从 ZCode 改写为 ZCode-Libre。

这是分支维护脚本：上游同步会带入新的、仍写着 ZCode 的文案，每次合并后运行一次即可补齐。
只替换独立单词 ZCode，避开代码契约（@zcode/、ZCODE_ 常量、.zcode 数据根、zcode:// 协议、
zcode.z.ai 域名）与已改写内容，因此可以安全地重复运行。

用法：
  python3 scripts/apply-brand-naming.py            # 预览改动（dry-run）
  python3 scripts/apply-brand-naming.py --write    # 落盘
  python3 scripts/apply-brand-naming.py --check    # 校验是否已全部改写，未改写则以退出码 1 结束
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# 独立单词匹配：前面不能是标识符/路径字符，后面不能是字母数字或连字符
# （后面是连字符说明已经是 ZCode-Libre，跳过；前面是 @ . / - 说明属于契约名）。
PATTERN = re.compile(r"(?<![A-Za-z0-9@._/-])ZCode(?![A-Za-z0-9-])")

# 指代远端服务端点与协议的专名，保持原样，避免用户把它误解为本机应用名。
KEEP_PATTERNS = ("ZCode Endpoint", "ZCode Protocol", "ZCode Agent")

# 用户可见文案所在文件。上游同步若新增同类文件，在此登记。
TARGETS = (
    "packages/ui/src/i18n/locales/zh-CN.ts",
    "packages/ui/src/i18n/locales/en-US.ts",
    "packages/shared/src/desktopMenu.ts",
    "apps/zcode-cli/packages/i18n/src/locales/zh-CN.ts",
    "apps/zcode-cli/packages/i18n/src/locales/en-US.ts",
    "packages/web/src/main.tsx",
    "packages/web/src/share/ConversationShareLandingPage.tsx",
    "packages/desktop/src/renderer/index.html",
    "packages/web/index.html",
)


def rewrite_line(line: str) -> tuple[str, int]:
    if any(keep in line for keep in KEEP_PATTERNS):
        return line, 0
    new_line, count = PATTERN.subn("ZCode-Libre", line)
    return new_line, count


def process(path: Path, write: bool) -> int:
    if not path.is_file():
        print(f"跳过（不存在）：{path.relative_to(REPO_ROOT)}")
        return 0

    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    rewritten: list[str] = []
    samples: list[tuple[str, str]] = []
    hits = 0
    for line in lines:
        new_line, count = rewrite_line(line)
        rewritten.append(new_line)
        if count:
            hits += count
            samples.append((line.rstrip(), new_line.rstrip()))

    if not hits:
        return 0

    relative = path.relative_to(REPO_ROOT)
    print(f"\n=== {relative}（{hits} 处）===")
    for before, after in samples[:5]:
        print(f"  - {before.strip()[:96]}")
        print(f"  + {after.strip()[:96]}")
    if len(samples) > 5:
        print(f"  ...（其余 {len(samples) - 5} 行同规则）")

    if write:
        path.write_text("".join(rewritten), encoding="utf-8")
    return hits


def main() -> None:
    write = "--write" in sys.argv
    check = "--check" in sys.argv
    total = sum(process(REPO_ROOT / target, write) for target in TARGETS)

    if check:
        if total:
            print(f"\n发现 {total} 处未改写的品牌名，运行 --write 修复")
            sys.exit(1)
        print("品牌名一致：未发现遗留的 ZCode 文案")
        return

    print(f"\n合计 {'已写入' if write else '待替换'} {total} 处")


if __name__ == "__main__":
    main()
