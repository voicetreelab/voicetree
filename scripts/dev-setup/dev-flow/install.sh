#!/usr/bin/env bash
# install.sh — put the machine-LOCAL dev-flow commands on PATH.
#
# Symlinks vt-land / vt-sync / vt-pr / vt-worktree into $HOME/bin — the same dir
# git-gate installs its `git` shim into, which is already guaranteed first on
# PATH (interactive, login, and /etc/environment non-login). Idempotent.
# _common.sh is sourced from the repo via symlink resolution, not installed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${VT_BIN_DIR:-$HOME/bin}"
mkdir -p "$DEST_DIR"

for cmd in vt-land vt-sync vt-pr vt-worktree; do
  src="$SCRIPT_DIR/$cmd"
  [ -f "$src" ] || { echo "install.sh: missing helper $src" >&2; exit 1; }
  chmod +x "$src"
  ln -sfn "$src" "$DEST_DIR/$cmd"
  echo "→ dev-flow: $DEST_DIR/$cmd -> $src"
done

echo "✔ dev-flow commands installed into $DEST_DIR (git-gate already prepends it to PATH)."
