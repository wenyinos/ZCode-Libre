#!/usr/bin/env python3
"""生成 ZCode-Libre 品牌图标资源。

以 public/logo/zcode-libre.svg 为唯一源，渲染后分发到桌面打包、Web 与 UI
引用的全部图标位置。更换 logo 后重新运行本脚本即可同步所有产物。

依赖 ImageMagick（magick 命令，需 librsvg 才能渲染 SVG）与 Pillow。
运行：python3 scripts/generate-logo-assets.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - 环境缺失时给出可执行的提示
    sys.exit("缺少 Pillow，请先安装：python3 -m pip install Pillow")

REPO_ROOT = Path(__file__).resolve().parents[1]
SVG_SOURCE = REPO_ROOT / "public" / "logo" / "zcode-libre.svg"

# 主图先按 4 倍于最大目标尺寸渲染，再降采样到各尺寸，避免多次栅格化造成边缘模糊。
RENDER_EDGE = 4096
PNG_SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
ICNS_SIZE = 1024


def render_master(dest: Path) -> Image.Image:
    if not SVG_SOURCE.is_file():
        sys.exit(f"找不到 logo 源文件：{SVG_SOURCE}")
    subprocess.run(
        [
            "magick",
            "-background",
            "none",
            "-density",
            "384",
            str(SVG_SOURCE),
            "-resize",
            f"{RENDER_EDGE}x{RENDER_EDGE}",
            "-depth",
            "8",
            str(dest),
        ],
        check=True,
    )
    return Image.open(dest).convert("RGBA")


def scaled(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.LANCZOS)


def write_png(master: Image.Image, size: int, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    scaled(master, size).save(dest, format="PNG", optimize=True)


def write_ico(master: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    scaled(master, max(ICO_SIZES)).save(dest, format="ICO", sizes=[(s, s) for s in ICO_SIZES])


def write_icns(master: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Pillow 会按尺寸映射到 ic07..ic14 等标准块类型，无需手工拼装 ICNS 容器。
    master.resize((ICNS_SIZE, ICNS_SIZE), Image.LANCZOS).save(dest, format="ICNS")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        master = render_master(Path(tmp) / "master.png")

        logo_dir = REPO_ROOT / "public" / "logo" / "icons"
        for size in PNG_SIZES:
            write_png(master, size, logo_dir / f"{size}x{size}.png")
        write_ico(master, logo_dir / "icon.ico")
        write_icns(master, logo_dir / "icon.icns")

        write_png(master, 1024, REPO_ROOT / "public" / "icon_512@2x.png")

        build = REPO_ROOT / "packages" / "desktop" / "build"
        write_png(master, 1024, build / "icon.png")
        write_png(master, 1024, build / "icon_windows.png")
        write_ico(master, build / "icon.ico")
        write_icns(master, build / "icon.icns")
        for size in PNG_SIZES:
            write_png(master, size, build / "icons" / f"{size}x{size}.png")

        write_png(master, 1024, build / "icon_installer.png")
        write_ico(master, build / "icon_installer.ico")
        write_icns(master, build / "icon_installer.icns")

    print("已生成 ZCode-Libre 图标资源：")
    print(f"  public/logo/icons/ + public/icon_512@2x.png")
    print(f"  packages/desktop/build/（icon / icon_windows / icon_installer / icons/ / .ico / .icns）")


if __name__ == "__main__":
    main()
