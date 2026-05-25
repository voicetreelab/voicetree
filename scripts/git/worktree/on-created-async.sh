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

echo "worktree async hook: starting dependency readiness for $WORKTREE_NAME at $WORKTREE_PATH"
echo "worktree async hook: command-boundary readiness will retry later if this prewarm fails"

REPO_ROOT="$(cd "$WORKTREE_PATH/../.." && pwd)"
REMOTE_RUNNER="$REPO_ROOT/scripts/run-remote.mjs"

if [ ! -f "$REMOTE_RUNNER" ]; then
    echo "worktree async hook: WARNING remote runner missing at $REMOTE_RUNNER" >&2
    echo "worktree async hook: command-boundary readiness will retry before tests or agent commands" >&2
    exit 0
fi

echo "worktree async hook: ensuring dependencies on the devbox for $WORKTREE_NAME"
echo "worktree async hook: local node_modules will not be created by default"
if ! (cd "$WORKTREE_PATH" && node "$REMOTE_RUNNER" true); then
    echo "worktree async hook: WARNING remote dependency readiness failed for $WORKTREE_NAME" >&2
    echo "worktree async hook: remote command boundary will retry before tests or agent commands" >&2
    exit 0
fi

echo "worktree async hook: remote dependency readiness complete for $WORKTREE_NAME"
