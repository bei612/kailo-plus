#!/usr/bin/env bash
# install.sh [runtime dir]: install the train-g acceptance suite from this kailo-plus checkout onto the CI node.
#
# The suite's sources live here (tools/acceptance/traing): changes are committed and pushed, then installed on the
# node with this script from a kailo-plus checkout pulled from GitHub, never edited in place on the node. The runtime
# directory (default /volumes/kailo/acceptance/traing) keeps what only exists there: state/ (accounts, 0600 secrets,
# run state, config.env), shots/, logs/, results/, node_modules and .tools; every source file is replaced, and a
# source file the repository no longer has, or a leftover *.bak*, is removed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=$here/traing
dst=${1:-/volumes/kailo/acceptance/traing}
[ -d "$src/steps" ] || { echo "install.sh: $src/steps not found" >&2; exit 2; }
mkdir -p "$dst/state" "$dst/lib" "$dst/steps" "$dst/host"
# Sources: the top-level scripts, lib/, steps/, host/ and the state scripts (not state data).
( cd "$src" && find . -type f ! -path './state/*.json' -print0 ) | while IFS= read -r -d '' f; do
  install -D -m "$( [ -x "$src/$f" ] && echo 0755 || echo 0644 )" "$src/$f" "$dst/$f"
done
# Sources the repository no longer has, and leftover backups.
for d in lib steps host; do
  for f in "$dst/$d"/*; do
    [ -e "$f" ] || continue
    [ -e "$src/$d/$(basename "$f")" ] || rm -f "$f"
  done
done
find "$dst" -maxdepth 3 -name '*.bak*' -not -path '*/node_modules/*' -exec rm -rf {} +
echo "acceptance suite installed into $dst from $(git -C "$here" rev-parse --short HEAD 2>/dev/null || echo checkout)"
