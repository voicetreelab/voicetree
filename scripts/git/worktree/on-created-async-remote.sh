#!/bin/sh
# Async setup for worktrees created on the remote VM.

set -e

WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

REPO_ROOT="$(git -C "$WORKTREE_PATH" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
INSTALL_DEPS="$REPO_ROOT/scripts/dev-setup/common/install-worktree-deps.sh"

if [ ! -x "$INSTALL_DEPS" ]; then
    echo "worktree async remote hook: WARNING dependency installer missing at $INSTALL_DEPS" >&2
    exit 0
fi

echo "worktree async remote hook: installing dependencies for $WORKTREE_NAME"
if ! "$INSTALL_DEPS" "$WORKTREE_PATH"; then
    echo "worktree async remote hook: WARNING dependency setup failed for $WORKTREE_NAME" >&2
    echo "worktree async remote hook: run $INSTALL_DEPS $WORKTREE_PATH manually to retry" >&2
    exit 0
fi

echo "worktree async remote hook: dependency readiness complete for $WORKTREE_NAME"
