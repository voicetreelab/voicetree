#!/bin/sh
# on-created-blocking.sh
# Blocking worktree setup: CDP port config + .mcp.json patching.
# Runs after git worktree add, blocks terminal spawn until complete.
# Fast (<1s) — agent needs these files before starting.
#
# Usage: on-created-blocking.sh <worktreePath> <worktreeName>

set -e

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

echo "worktree blocking hook: starting CDP/MCP setup for $WORKTREE_NAME at $WORKTREE_PATH"
exec "$SCRIPT_DIR/configure-cdp.sh" "$@"
