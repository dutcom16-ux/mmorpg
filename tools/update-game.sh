#!/usr/bin/env bash
# Copies a fresh game build (the main project's dist/web folder) into public/.
# Usage: ./tools/update-game.sh /path/to/game-project/dist/web
set -euo pipefail
src="${1:?give the path to dist/web}"
[ -f "$src/index.html" ] || { echo "No index.html in $src" >&2; exit 1; }
here="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$here/public"
mkdir -p "$here/public"
cp -R "$src/." "$here/public/"
echo "public/ updated: $(find "$here/public" -type f | wc -l) files, $(du -sh "$here/public" | cut -f1)"
