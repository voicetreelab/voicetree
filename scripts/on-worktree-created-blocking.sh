#!/bin/sh
# on-worktree-created-blocking.sh
# Blocking worktree setup: CDP port config + .mcp.json patching.
# Runs after git worktree add, blocks terminal spawn until complete.
# Fast (<1s) — agent needs these files before starting.
#
# Usage: on-worktree-created-blocking.sh <worktreePath> <worktreeName>

set -e

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/configure-worktree-cdp.sh" "$@"
