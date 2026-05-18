#!/bin/sh
# on-worktree-created.sh
# Per-worktree setup: installs deps, configures Playwright debug port.
#
# Called by VoiceTree's onWorktreeCreated hook after git worktree add.
# 1. Installs npm dependencies in webapp/
# 2. Picks a free TCP port, patches .mcp.json for Playwright MCP,
#    and writes .cdp-port for Electron to read.
#
# Usage: on-worktree-created.sh <worktreePath> <worktreeName>

set -e

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

# --- Install npm dependencies ---
if [ -f "$WORKTREE_PATH/webapp/package.json" ]; then
    echo "Installing npm dependencies in $WORKTREE_PATH/webapp ..."
    (cd "$WORKTREE_PATH/webapp" && npm install --prefer-offline 2>&1) || {
        echo "WARNING: npm install failed (non-blocking)" >&2
    }
fi

exec "$SCRIPT_DIR/configure-worktree-cdp.sh" "$WORKTREE_PATH" "$WORKTREE_NAME"
