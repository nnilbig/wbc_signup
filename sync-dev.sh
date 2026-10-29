#!/bin/sh
# 把前端共用檔案複製到測試版 repo（預設 ../whonext-bc-dev）
# config.js、manifest.webmanifest 是測試版自己的設定：第一次從 env/dev 複製，之後不覆蓋
set -e
src=$(cd "$(dirname "$0")" && pwd)
dst=${1:-"$src/../whonext-bc-dev"}
mkdir -p "$dst/icons"

cp "$src/index.html" "$src/style.css" "$src/app.js" "$src/firebase-messaging-sw.js" "$src/apple-touch-icon.png" "$dst/"
cp "$src/icons/"*.png "$dst/icons/"
for f in config.js manifest.webmanifest; do
  [ -f "$dst/$f" ] || cp "$src/env/dev/$f" "$dst/$f"
done
echo "synced to $dst"
