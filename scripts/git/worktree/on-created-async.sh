#!/bin/sh
# on-created-async.sh
# Fire-and-forget worktree setup router.
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

# Derive REPO_ROOT from git's main-worktree pointer rather than `cd ../..`,
# because worktrees live as a SIBLING of the main checkout (<parent>/vt-wts/<name>/),
# not nested inside it. The first entry in `git worktree list --porcelain` is
# always the main worktree.
REPO_ROOT="$(git -C "$WORKTREE_PATH" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
ENV_HELPERS="$REPO_ROOT/scripts/dev-setup/common/env.sh"

if [ ! -f "$ENV_HELPERS" ]; then
    echo "worktree async hook: WARNING env helpers missing at $ENV_HELPERS" >&2
    exit 0
fi

. "$ENV_HELPERS"
dev_setup_link_worktree_env "$WORKTREE_PATH" "$REPO_ROOT"

ROLE="$(dev_setup_resolve_dev_role || true)"

case "$ROLE" in
    mac)
        exec "$SCRIPT_DIR/on-created-async-mac.sh" "$WORKTREE_PATH" "$WORKTREE_NAME"
        ;;
    remote)
        exec "$SCRIPT_DIR/on-created-async-remote.sh" "$WORKTREE_PATH" "$WORKTREE_NAME"
        ;;
    *)
        echo "worktree async hook: WARNING unsupported VT_DEV_ROLE '$ROLE'" >&2
        echo "worktree async hook: set VT_DEV_ROLE=mac or VT_DEV_ROLE=remote in ~/.env" >&2
        exit 0
        ;;
esac
