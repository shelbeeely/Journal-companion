#!/usr/bin/env bash
# Rebuilds the Latin-subset WOFF2 fonts from the Android app's TTFs.
# Needs: pip install fonttools brotli   (build-time only)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=../app/src/main/res/font
OUT=src/assets/fonts
UNICODES="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+FEFF,U+FFFD,U+00D7,U+2022,U+2026,U+201C-201D,U+2018-2019"
for f in newsreader plus_jakarta_sans; do
  pyftsubset "$SRC/$f.ttf" --unicodes="$UNICODES" --layout-features='*' --flavor=woff2 --output-file="$OUT/$f.woff2"
done
ls -la "$OUT"
