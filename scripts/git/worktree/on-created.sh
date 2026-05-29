#!/bin/sh
# on-created.sh
# Per-worktree setup: configures Playwright debug port.
#
# Called by VoiceTree's onWorktreeCreated hook after git worktree add.
# 1. Picks a free TCP port, patches .mcp.json for Playwright MCP, and writes
#    .cdp-port for Electron to read.
#
# Dependency setup is handled by the on-created-async.sh role router. Keeping
# it out of this blocking hook lets the worktree become available after the
# fast CDP configuration.
#
# Usage: on-created.sh <worktreePath> <worktreeName>

set -e

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

echo "worktree hook: starting combined setup for $WORKTREE_NAME at $WORKTREE_PATH"
exec "$SCRIPT_DIR/configure-cdp.sh" "$WORKTREE_PATH" "$WORKTREE_NAME"
