#!/bin/sh
# on-worktree-created-async.sh
# Async worktree setup: symlink node_modules from main repo.
# Runs after git worktree add, fire-and-forget (does not block terminal spawn).
#
# Usage: on-worktree-created-async.sh <worktreePath> <worktreeName>

set -e

WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

# --- Symlink node_modules from main repo (fast) instead of npm install (slow) ---
MAIN_REPO="$(cd "$WORKTREE_PATH" && git worktree list --porcelain | head -1 | sed 's/^worktree //')"
MAIN_NODE_MODULES="$MAIN_REPO/webapp/node_modules"

if [ -f "$WORKTREE_PATH/webapp/package.json" ] && [ ! -e "$WORKTREE_PATH/webapp/node_modules" ]; then
    if [ -d "$MAIN_NODE_MODULES" ]; then
        echo "Symlinking node_modules from $MAIN_NODE_MODULES ..."
        ln -s "$MAIN_NODE_MODULES" "$WORKTREE_PATH/webapp/node_modules"
    else
        echo "Main repo node_modules not found, falling back to npm install ..."
        (cd "$WORKTREE_PATH/webapp" && npm install --prefer-offline 2>&1) || {
            echo "WARNING: npm install failed" >&2
        }
    fi
fi

echo "Async setup complete for worktree $WORKTREE_NAME"
