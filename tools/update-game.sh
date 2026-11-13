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
# version.txt: "build: <BUILD> (<title of the newest patch note>)". Open games read it every 2 minutes and offer a
# refresh when the build is newer than theirs (they look for "build: ..."; keep this format)
b="$(grep -o "const BUILD='[^']*'" "$here/public/index.html" | head -1 | cut -d"'" -f2)"
t="$(grep -o "title:'[^']*'" "$here/public/index.html" | head -1 | cut -d"'" -f2)"
[ -n "$b" ] && printf 'build: %s (%s)\n' "$b" "$t" > "$here/public/version.txt"
echo "public/ updated: $(find "$here/public" -type f | wc -l) files, $(du -sh "$here/public" | cut -f1) · version.txt: $(cat "$here/public/version.txt" 2>/dev/null)"
