#!/usr/bin/env bash
# Symlink CLAUDE.md and AGENTS.md to $HOME on the devbox.
# Run from the repo root on the remote, or pass REPO_ROOT as $1.
set -euo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"
PROMPT_DIR="$REPO_ROOT/scripts/dev-setup/vm_prompts"

for file in CLAUDE.md AGENTS.md; do
  src="$PROMPT_DIR/$file"
  dest="$HOME/$file"
  if [ ! -f "$src" ]; then
    echo "⚠  $src not found, skipping"
    continue
  fi
  ln -sf "$src" "$dest"
  echo "✓  $dest → $src"
done
