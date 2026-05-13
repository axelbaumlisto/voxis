#!/usr/bin/env bash
# Regenerate all SoupaWhisper app icon sizes from source.svg.
#
# Usage: ./src-tauri/icons/build.sh
#
# Required: rsvg-convert (brew install librsvg), sips (macOS), iconutil
# (macOS), python3 with Pillow (for the Windows .ico).
set -euo pipefail
cd "$(dirname "$0")"
SRC_SVG=source.svg
SRC_PNG=/tmp/soupawhisper-icon-1024.png

rsvg-convert -w 1024 -h 1024 "$SRC_SVG" -o "$SRC_PNG"

# Tauri-required PNGs (paths listed in tauri.conf.json -> bundle.icon)
sips -z 32 32   "$SRC_PNG" --out 32x32.png      > /dev/null
sips -z 128 128 "$SRC_PNG" --out 128x128.png    > /dev/null
sips -z 256 256 "$SRC_PNG" --out 128x128@2x.png > /dev/null
cp "$SRC_PNG" icon.png

# macOS .icns
ICSET=/tmp/SoupaWhisper.iconset
rm -rf "$ICSET" && mkdir -p "$ICSET"
for sz in 16 32 64 128 256 512; do
  sips -z "$sz" "$sz" "$SRC_PNG" --out "$ICSET/icon_${sz}x${sz}.png" > /dev/null
done
cp "$ICSET/icon_32x32.png"   "$ICSET/icon_16x16@2x.png"
cp "$ICSET/icon_64x64.png"   "$ICSET/icon_32x32@2x.png"
cp "$ICSET/icon_256x256.png" "$ICSET/icon_128x128@2x.png"
cp "$ICSET/icon_512x512.png" "$ICSET/icon_256x256@2x.png"
cp "$SRC_PNG"                "$ICSET/icon_512x512@2x.png"
iconutil -c icns "$ICSET" -o icon.icns
rm -rf "$ICSET"

# Windows .ico
python3 -c "
from PIL import Image
Image.open('$SRC_PNG').save(
    'icon.ico',
    sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)],
)
"

echo 'icons rebuilt from source.svg'
