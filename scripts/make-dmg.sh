#!/usr/bin/env bash
# make-dmg.sh — build a distributable .dmg from the packaged .app using the
# system hdiutil (electron-builder's bundled dmgbuild is unreliable).
# Run after `npm run pack:mac:dir` (or `npm run pack:mac`).
set -euo pipefail

cd "$(dirname "$0")/.."

APP_DIR="dist/mac-arm64/DeepSeek Harness.app"
if [ ! -d "$APP_DIR" ]; then
  echo "error: $APP_DIR not found — run 'npm run pack:mac:dir' first" >&2
  exit 1
fi

VERSION=$(node -p "require('./package.json').version")
OUT="dist/DeepSeek Harness-${VERSION}-arm64.dmg"
STAGING="$(mktemp -d)"

trap 'rm -rf "$STAGING"' EXIT

cp -R "$APP_DIR" "$STAGING/"
hdiutil create \
  -volname "DeepSeek Harness" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$OUT"

echo "created $OUT"
