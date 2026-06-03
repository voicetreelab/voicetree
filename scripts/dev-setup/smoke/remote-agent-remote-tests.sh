#!/usr/bin/env bash
# Smoke test for VM-created worktrees: remote agent deps + remote test deps.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
ENV_HELPERS="$REPO_ROOT/scripts/dev-setup/common/env.sh"
HOOK="$REPO_ROOT/scripts/git/worktree/on-created-async.sh"

. "$ENV_HELPERS"

ROLE="$(dev_setup_resolve_dev_role)"
if [ "$ROLE" != "remote" ]; then
  echo "remote-agent-remote-tests: expected VT_DEV_ROLE=remote, got '$ROLE'" >&2
  exit 1
fi

WT_NAME="wt-smoke-remote-$(date +%Y%m%d%H%M%S)-$$"
# Remote/dev-box worktrees live under the plain (suffix-less) root, the default
# VT_WORKTREE_ROOT that vt-worktree and the app use.
REMOTE_WTS_ROOT="${VT_WORKTREE_ROOT:-/root/vt-wts}"
WT_PATH="$REMOTE_WTS_ROOT/$WT_NAME"

cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$WT_PATH" >/dev/null 2>&1 || true
  git -C "$REPO_ROOT" worktree prune >/dev/null 2>&1 || true
  rm -rf "$WT_PATH"
}
trap cleanup EXIT

mkdir -p "$REMOTE_WTS_ROOT"
git -C "$REPO_ROOT" worktree add --detach "$WT_PATH" HEAD
"$HOOK" "$WT_PATH" "$WT_NAME"

test -d "$WT_PATH/node_modules"
(
  cd "$WT_PATH"
  pnpm --version >/dev/null
)

echo "remote-agent-remote-tests: ok"
