const packageDirName = "zcode";

export function installScriptSource(baseUrl) {
  return `#!/usr/bin/env sh
set -eu

BASE_URL="\${ZCODE_DIST_BASE_URL:-${baseUrl}}"
INSTALL_DIR="\${ZCODE_DIST_HOME:-$HOME/.zcode/runtime}"
BIN_DIR="\${ZCODE_DIST_BIN_DIR:-$HOME/.local/bin}"
LOCAL_TARBALL=""

usage() {
  cat <<'USAGE'
用法：
  sh install.sh --tarball <安装包路径>   用已下载的安装包安装（离线，推荐）
  sh install.sh                        在线安装（从本仓库 Release 下载）
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tarball)
      [ -n "\${2:-}" ] || { echo "--tarball 需要一个文件路径" >&2; exit 1; }
      LOCAL_TARBALL="$2"
      shift 2
      ;;
    --tarball=*)
      LOCAL_TARBALL="\${1#--tarball=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "zcode install requires $1" >&2
    exit 1
  fi
}

need_cmd node
need_cmd tar

# 命令行版只发行 macOS arm64 与 Linux x64/arm64，包内原生件也只覆盖这三个平台；
# 在其他平台上装完同样起不来，早失败好过装完才发现。
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) ;;
  Linux/x86_64|Linux/aarch64|Linux/arm64) ;;
  *)
    echo "zcode 命令行版只支持 macOS arm64 与 Linux x64/arm64；当前是 $(uname -s)/$(uname -m)。" >&2
    echo "其他平台请使用桌面版：https://github.com/wenyinos/ZCode-Libre/releases" >&2
    exit 1
    ;;
esac

# 原生模块（node-pty 等）按构建时的 Node ABI 匹配，版本不一致时 TUI 可能起不来。
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" != "24" ]; then
  echo "警告：发行包按 Node 24 构建，当前 Node $NODE_MAJOR 可能无法启动 TUI（Web 模式通常不受影响）。" >&2
fi

# 解压与下载都在安装目录内完成：不落 /tmp，也不受 tmpfs 容量限制。
STAGING="$INSTALL_DIR/releases/.staging.$$"
cleanup() {
  rm -rf "$STAGING"
}
trap cleanup EXIT
mkdir -p "$STAGING" "$BIN_DIR"

if [ -n "$LOCAL_TARBALL" ]; then
  # 离线安装：直接用本地安装包，全程不联网。
  [ -f "$LOCAL_TARBALL" ] || { echo "找不到安装包：$LOCAL_TARBALL" >&2; exit 1; }
  ARCHIVE="$LOCAL_TARBALL"
else
  # 在线安装：latest.json 给出版本与包名；tarballUrl 存在时优先用完整地址
  # （GitHub Release 的资产是扁平地址，与自建 CDN 的 releases/<version>/ 布局不同）。
  need_cmd curl
  LATEST_JSON="$(curl -fsSL "\${BASE_URL%/}/latest.json")"
  TARBALL="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).tarball))")"
  TARBALL_URL="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).tarballUrl||''))")"
  ARCHIVE="$STAGING/$TARBALL"
  if [ -n "$TARBALL_URL" ]; then
    curl -fL "$TARBALL_URL" -o "$ARCHIVE"
  else
    VERSION="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).version))")"
    curl -fL "\${BASE_URL%/}/releases/$VERSION/$TARBALL" -o "$ARCHIVE"
  fi
fi

tar -xzf "$ARCHIVE" -C "$STAGING"
PACKAGE_DIR="$STAGING/${packageDirName}"
if [ ! -f "$PACKAGE_DIR/package.json" ]; then
  echo "安装包结构不正确：$ARCHIVE 里没有 ${packageDirName}/package.json" >&2
  exit 1
fi
# 版本以包内 package.json 为准：离线与在线安装都不必额外查版本清单。
VERSION="$(node -p "require('$PACKAGE_DIR/package.json').version")"

mkdir -p "$INSTALL_DIR/releases"
TARGET="$INSTALL_DIR/releases/$VERSION"
rm -rf "$TARGET"
mv "$PACKAGE_DIR" "$TARGET"
ln -sfn "$TARGET" "$INSTALL_DIR/current"

cat > "$BIN_DIR/zcode" <<SH
#!/usr/bin/env sh
exec node "$INSTALL_DIR/current/bin/zcode.mjs" "\\$@"
SH
chmod +x "$BIN_DIR/zcode"

echo "ZCode $VERSION installed."
echo "Run: zcode (TUI) or zcode --web (Web)"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: $BIN_DIR is not in PATH." ;;
esac
`;
}
