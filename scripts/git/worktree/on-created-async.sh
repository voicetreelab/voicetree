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

echo "worktree async hook: starting dependency readiness for $WORKTREE_NAME at $WORKTREE_PATH"
echo "worktree async hook: command-boundary readiness will retry later if this prewarm fails"

if ! "$SCRIPT_DIR/ensure-ready.mjs" "$WORKTREE_PATH"; then
    echo "worktree async hook: WARNING dependency readiness failed for $WORKTREE_NAME" >&2
    echo "worktree async hook: remote command boundary will retry before tests or agent commands" >&2
    exit 0
fi

echo "worktree async hook: dependency readiness complete for $WORKTREE_NAME"
