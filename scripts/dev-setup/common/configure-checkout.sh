#!/usr/bin/env bash
# configure-checkout.sh — put this machine's main checkout on its own writable
# branch ($VT_DEV_BRANCH) and install the dev-flow commands. Shared by
# setup-laptop-env.sh (Mac) and setup-devbox-env.sh (VM).
#
# Per-machine-branch model: each machine owns ONE branch (Manu: dev-mac / dev-remote,
# set as VT_DEV_BRANCH in ~/.env — NEVER a literal in this repo; defaults to the
# safe non-shared `dev-new`). The checkout is a normal, fully writable checkout;
# integration is a PR to the shared `dev` branch. There is no read-only base, no
# branch pinning, and no sync daemon — those existed only to make a shared base
# branch safe across two machines, which per-machine branches make unnecessary.
#
# Config (env):
#   VT_BASE_DIR              the checkout to configure                 (REQUIRED)
#   VT_DEV_BRANCH            this machine's branch (else ~/.env, else dev-new)
#   VT_INTEGRATION_BRANCH    branch to fork the machine branch from    (default: dev)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_FLOW_INSTALL="$(cd "$SCRIPT_DIR/../dev-flow" && pwd)/install.sh"
# shellcheck source=env.sh
. "$SCRIPT_DIR/env.sh"

BASE="${VT_BASE_DIR:?configure-checkout: set VT_BASE_DIR to the checkout}"
BRANCH="$(dev_setup_resolve_dev_branch)"
INTEGRATION="${VT_INTEGRATION_BRANCH:-dev}"

[ -d "$BASE/.git" ] || { echo "configure-checkout: $BASE is not a git repository" >&2; exit 1; }

echo "→ configure-checkout: $BASE  branch=$BRANCH  fork-from=origin/$INTEGRATION"

base_git() { git -C "$BASE" "$@"; }

# Never strand uncommitted work when switching the checkout's branch.
if ! base_git diff --quiet || ! base_git diff --cached --quiet; then
  echo "configure-checkout: REFUSING — $BASE has uncommitted changes." >&2
  echo "  Commit or stash them, then re-run." >&2
  exit 1
fi

base_git fetch origin --prune

# Put the checkout on its own branch: switch to it if it exists locally, else
# create it from origin/<branch> (if present) or from origin/<integration>.
if base_git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  base_git checkout "$BRANCH"
elif base_git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  base_git checkout -b "$BRANCH" "origin/$BRANCH"
else
  base_git show-ref --verify --quiet "refs/remotes/origin/$INTEGRATION" \
    || { echo "configure-checkout: origin/$INTEGRATION does not exist — cannot fork '$BRANCH' from it" >&2; exit 1; }
  base_git checkout -b "$BRANCH" "origin/$INTEGRATION"
  echo "→ configure-checkout: created '$BRANCH' off origin/$INTEGRATION — push it with: git push -u origin $BRANCH"
fi
echo "→ configure-checkout: $BASE is on $BRANCH ($(base_git rev-parse --short HEAD)), writable"

# dev-flow commands on PATH (vt-sync / vt-pr / vt-worktree).
bash "$DEV_FLOW_INSTALL"

echo "✔ configure-checkout: edit here directly (or in worktrees); integrate via 'vt-pr' to $INTEGRATION."
