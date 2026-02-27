#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
UNPACKED="$DIST/unpacked"
ZIP_PATH="$DIST/chatgpt-conversation-exporter.zip"
CRX_PATH="$DIST/chatgpt-conversation-exporter.crx"
PROFILE_DIR="$DIST/.chrome-profile"
DEFAULT_KEY="$ROOT/certs/chatgpt-exporter.pem"
KEY_PATH="${KEY_PATH:-$DEFAULT_KEY}"

rm -rf "$UNPACKED" "$ZIP_PATH" "$CRX_PATH" "$PROFILE_DIR"
mkdir -p "$UNPACKED" "$DIST"

cp "$ROOT/manifest.json" "$UNPACKED/"
cp "$ROOT/README.md" "$UNPACKED/"
cp -R "$ROOT/src" "$UNPACKED/"
cp -R "$ROOT/icons" "$UNPACKED/"
cp -R "$ROOT/vendor" "$UNPACKED/"

pushd "$UNPACKED" >/dev/null
zip -qr "$ZIP_PATH" .
popd >/dev/null

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
  /path/to/chrome --pack-extension=dist/unpacked --pack-extension-key=certs/chatgpt-exporter.pem
MSG
  exit 0
fi

mkdir -p "$PROFILE_DIR"
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
  mv "$UNPACKED.crx" "$CRX_PATH"
  echo "📦  生成 CRX => $CRX_PATH"
else
  echo "⚠️  未找到 $UNPACKED.crx，可能是浏览器版本不支持 --pack-extension。" >&2
fi

rm -rf "$PROFILE_DIR"
