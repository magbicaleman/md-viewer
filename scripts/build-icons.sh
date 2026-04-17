#!/bin/zsh

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
ASSETS_DIR="$ROOT_DIR/assets"
SOURCE_PNG="$ASSETS_DIR/icon.png"

if [[ ! -f "$SOURCE_PNG" ]]; then
  echo "Missing source icon: $SOURCE_PNG" >&2
  exit 1
fi

rm -f "$ASSETS_DIR/icon.ico"
magick "$SOURCE_PNG" -define icon:auto-resize=256,128,64,48,32,16 "$ASSETS_DIR/icon.ico"
