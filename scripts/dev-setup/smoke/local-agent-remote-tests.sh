#!/usr/bin/env bash
# Smoke test for Mac-created worktrees: local agent deps + remote test deps.

set -euo pipefail

if [ "$(uname -s)" = "Darwin" ]; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
ENV_HELPERS="$REPO_ROOT/scripts/dev-setup/common/env.sh"
HOOK="$REPO_ROOT/scripts/git/worktree/on-created-async.sh"

. "$ENV_HELPERS"

ROLE="$(dev_setup_resolve_dev_role)"
if [ "$ROLE" != "mac" ]; then
  echo "local-agent-remote-tests: expected VT_DEV_ROLE=mac, got '$ROLE'" >&2
  exit 1
fi

REMOTE_HOST="$(dev_setup_resolve_remote_host "$REPO_ROOT" "$REPO_ROOT")"
WT_NAME="wt-smoke-local-remote-$(date +%Y%m%d%H%M%S)-$$"
LOCAL_WTS_ROOT="$(cd "$REPO_ROOT/.." && pwd)/vt-wts"
LOCAL_WT="$LOCAL_WTS_ROOT/$WT_NAME"
REMOTE_WT="/root/vt-wts-synced/$WT_NAME"

cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$LOCAL_WT" >/dev/null 2>&1 || true
  git -C "$REPO_ROOT" worktree prune >/dev/null 2>&1 || true
  if command -v mutagen >/dev/null 2>&1; then
    mutagen sync flush vt-wts-synced >/dev/null 2>&1 || true
  fi
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_HOST" \
    "rm -rf '$REMOTE_WT' '/root/vtrepo-synced/.git/worktrees/$WT_NAME'" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$LOCAL_WTS_ROOT"
env VT_GIT_GATE_SKIP_WORKTREE_PREWARM=1 git -C "$REPO_ROOT" worktree add --detach "$LOCAL_WT" HEAD
"$HOOK" "$LOCAL_WT" "$WT_NAME"

test -d "$LOCAL_WT/node_modules"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_HOST" \
  "test -d '$REMOTE_WT/node_modules'"

(
  cd "$LOCAL_WT"
  node scripts/run-remote.mjs test -d node_modules
)

echo "local-agent-remote-tests: ok"
