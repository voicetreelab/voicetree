#!/bin/sh
# Async setup for worktrees created on the Mac laptop.

set -e

WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

REPO_ROOT="$(git -C "$WORKTREE_PATH" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
ENV_HELPERS="$REPO_ROOT/scripts/dev-setup/common/env.sh"
INSTALL_DEPS="$REPO_ROOT/scripts/dev-setup/common/install-worktree-deps.sh"

if [ ! -f "$ENV_HELPERS" ]; then
    echo "worktree async mac hook: WARNING env helpers missing at $ENV_HELPERS" >&2
    exit 0
fi

. "$ENV_HELPERS"
dev_setup_link_worktree_env "$WORKTREE_PATH" "$REPO_ROOT"

if [ ! -x "$INSTALL_DEPS" ]; then
    echo "worktree async mac hook: WARNING dependency installer missing at $INSTALL_DEPS" >&2
else
    echo "worktree async mac hook: installing local dependencies for $WORKTREE_NAME"
    if ! "$INSTALL_DEPS" "$WORKTREE_PATH"; then
        echo "worktree async mac hook: WARNING local dependency setup failed for $WORKTREE_NAME" >&2
        echo "worktree async mac hook: run $INSTALL_DEPS $WORKTREE_PATH manually to retry" >&2
        exit 0
    fi
fi

REMOTE_HOST="$(dev_setup_resolve_remote_host "$WORKTREE_PATH" "$REPO_ROOT" || true)"
if [ -z "$REMOTE_HOST" ]; then
    echo "worktree async mac hook: WARNING no VT_REMOTE_HOST found; skipping remote dependency setup" >&2
    echo "worktree async mac hook: remote command boundary will retry before tests or agent commands" >&2
    exit 0
fi

if command -v mutagen >/dev/null 2>&1; then
    echo "worktree async mac hook: flushing mutagen vt-wts-synced before remote setup"
    mutagen sync flush vt-wts-synced >/dev/null 2>&1 \
        || echo "worktree async mac hook: WARNING mutagen sync flush vt-wts-synced failed; remote setup may race" >&2
fi

case "$WORKTREE_NAME" in
    "."|".."|""|*[!A-Za-z0-9._-]*)
        echo "worktree async mac hook: WARNING unsafe worktree name '$WORKTREE_NAME'; skipping remote setup" >&2
        exit 0
        ;;
esac

REMOTE_WORKTREE="/root/vt-wts-synced/$WORKTREE_NAME"
REMOTE_SCRIPT="cd '$REMOTE_WORKTREE' && bash scripts/dev-setup/common/install-worktree-deps.sh ."

echo "worktree async mac hook: installing remote dependencies for $WORKTREE_NAME"
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_HOST" "$REMOTE_SCRIPT"; then
    echo "worktree async mac hook: WARNING remote dependency setup failed for $WORKTREE_NAME" >&2
    echo "worktree async mac hook: remote command boundary will retry before tests or agent commands" >&2
    exit 0
fi

echo "worktree async mac hook: local and remote dependency readiness complete for $WORKTREE_NAME"
