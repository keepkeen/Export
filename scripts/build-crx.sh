#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
ZIP_PATH="$DIST/threadatlas.zip"
CRX_PATH="$DIST/threadatlas.crx"
DEFAULT_KEY="$ROOT/certs/threadatlas.pem"
LEGACY_KEY="$ROOT/certs/chronochat-studio.pem"
KEY_PATH="${KEY_PATH:-$DEFAULT_KEY}"
if [[ "$KEY_PATH" == "$DEFAULT_KEY" && ! -f "$KEY_PATH" && -f "$LEGACY_KEY" ]]; then
  KEY_PATH="$LEGACY_KEY"
fi

mkdir -p "$DIST"
WORK_ROOT="$(mktemp -d "$DIST/.build.XXXXXX")"
UNPACKED="$WORK_ROOT/unpacked"
PROFILE_DIR="$WORK_ROOT/.chrome-profile"
mkdir -p "$UNPACKED"

cleanup() {
  if [[ -n "${WORK_ROOT:-}" && -d "${WORK_ROOT:-}" ]]; then
    find "$WORK_ROOT" -depth -mindepth 1 \
      \( -type f -o -type l \) -exec unlink {} \; \
      -o -type d -exec rmdir {} \; 2>/dev/null || true
    rmdir "$WORK_ROOT" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cp "$ROOT/manifest.json" "$UNPACKED/"
cp "$ROOT/README.md" "$UNPACKED/"
cp -R "$ROOT/src" "$UNPACKED/"
cp -R "$ROOT/icons" "$UNPACKED/"
cp -R "$ROOT/vendor" "$UNPACKED/"

pushd "$UNPACKED" >/dev/null
TMP_ZIP="$WORK_ROOT/threadatlas.zip"
zip -qr "$TMP_ZIP" .
popd >/dev/null
mv -f "$TMP_ZIP" "$ZIP_PATH"

echo "✅ Packed ZIP at $ZIP_PATH"

mkdir -p "$(dirname "$KEY_PATH")"
if [[ ! -f "$KEY_PATH" ]]; then
  echo "🔐 Generating signing key at $KEY_PATH"
  openssl genrsa -out "$KEY_PATH" 2048 >/dev/null 2>&1
fi

BROWSER_CANDIDATES=()
if [[ -n "${CHROME_BIN:-}" ]]; then
  BROWSER_CANDIDATES+=("$CHROME_BIN")
fi
BROWSER_CANDIDATES+=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  "$(command -v google-chrome 2>/dev/null || true)"
  "$(command -v chromium 2>/dev/null || true)"
  "$(command -v msedge 2>/dev/null || true)"
)

BROWSER_BIN=""
for candidate in "${BROWSER_CANDIDATES[@]}"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    BROWSER_BIN="$candidate"
    break
  fi
done

if [[ -z "$BROWSER_BIN" ]]; then
  cat <<'MSG'
⚠️  未找到可用于打包 CRX 的 Chrome/Edge 可执行文件。
请安装 Chromium 内核浏览器，并设置环境变量 CHROME_BIN 指向其可执行文件，
或者手动运行：
  /path/to/chrome --pack-extension=dist/unpacked --pack-extension-key=certs/threadatlas.pem
MSG
  exit 0
fi

"$BROWSER_BIN" \
  --pack-extension="$UNPACKED" \
  --pack-extension-key="$KEY_PATH" \
  --user-data-dir="$PROFILE_DIR" \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  --disable-extensions >/dev/null 2>&1 || {
    echo "⚠️  浏览器打包命令执行失败，请查看上方输出。" >&2
    exit 1
  }

if [[ -f "$UNPACKED.crx" ]]; then
  mv -f "$UNPACKED.crx" "$CRX_PATH"
  echo "📦  生成 CRX => $CRX_PATH"
else
  echo "⚠️  未找到 $UNPACKED.crx，可能是浏览器版本不支持 --pack-extension。" >&2
fi
