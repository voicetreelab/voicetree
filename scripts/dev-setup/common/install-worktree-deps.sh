#!/usr/bin/env bash
# Repeatable dependency setup for a Voicetree checkout or worktree.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PATH="${1:-$PWD}"

fail() {
  printf 'install-worktree-deps: %s\n' "$*" >&2
  exit 1
}

step() {
  printf 'install-worktree-deps: %s\n' "$*"
}

[ "${2:-}" = "" ] || fail "expected at most one argument: [checkout-path]"
[ -d "$TARGET_PATH" ] || fail "checkout path does not exist: $TARGET_PATH"

CHECKOUT_ROOT="$(cd "$TARGET_PATH" && pwd)"
[ -f "$CHECKOUT_ROOT/pnpm-lock.yaml" ] || fail "missing pnpm-lock.yaml in $CHECKOUT_ROOT"

"$SCRIPT_DIR/ensure-pnpm.sh" "$CHECKOUT_ROOT"

step "installing dependencies in $CHECKOUT_ROOT"
cd "$CHECKOUT_ROOT"
pnpm install --frozen-lockfile

step "complete"
