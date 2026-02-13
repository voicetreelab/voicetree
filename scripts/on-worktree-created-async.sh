#!/bin/sh
# on-worktree-created-async.sh
# Async worktree setup: npm install.
# Runs after git worktree add, fire-and-forget (does not block terminal spawn).
# Slow (10-30s) — terminal starts while deps install in background.
#
# Usage: on-worktree-created-async.sh <worktreePath> <worktreeName>

set -e

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
        echo "WARNING: npm install failed" >&2
    }
fi

echo "Async setup complete for worktree $WORKTREE_NAME"
