#!/bin/sh
# on-created-async.sh
# Fire-and-forget worktree setup. This is a prewarm path only; remote command
# execution still enforces readiness before it runs agent/test commands.
#
# Usage: on-created-async.sh <worktreePath> <worktreeName>

set -e

WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"

if ! "$SCRIPT_DIR/ensure-ready.mjs" "$WORKTREE_PATH"; then
    echo "WARNING: worktree dependency prewarm failed for $WORKTREE_NAME" >&2
fi

echo "Async setup complete for worktree $WORKTREE_NAME"
