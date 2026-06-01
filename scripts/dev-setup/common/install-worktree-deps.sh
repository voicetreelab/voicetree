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

# Seed the ck semantic-search index from the main checkout so a fresh worktree
# skips the ~10-min cold embed. ck reconciles by CONTENT HASH — a changed mtime
# alone re-embeds nothing (verified) — so the copied index stays valid despite
# the worktree's fresh checkout mtimes; the first `ck --sem` re-embeds only the
# files that genuinely differ. Best-effort: a search-cache optimisation must
# never fail worktree setup.
seed_ck_index() {
  checkout="$1"
  main_root="$(git -C "$checkout" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')" || main_root=""
  [ -n "$main_root" ] || return 0
  [ "$main_root" != "$checkout" ] || return 0   # this IS the main checkout — nothing to seed from
  [ -d "$main_root/.ck" ] || return 0           # no source index to copy
  [ ! -e "$checkout/.ck" ] || return 0          # keep any index the worktree already has
  step "seeding ck index from $main_root/.ck"
  if cp -R "$main_root/.ck" "$checkout/.ck"; then
    step "ck index seeded; first 'ck --sem' reconciles by hash (no full re-embed)"
  else
    rm -rf "$checkout/.ck" 2>/dev/null || true
    step "WARNING ck index seed failed; first 'ck --sem' cold-indexes (slower, still correct)"
  fi
}

[ "${2:-}" = "" ] || fail "expected at most one argument: [checkout-path]"
[ -d "$TARGET_PATH" ] || fail "checkout path does not exist: $TARGET_PATH"

if [ "$(uname -s)" = "Darwin" ]; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi

CHECKOUT_ROOT="$(cd "$TARGET_PATH" && pwd)"
[ -f "$CHECKOUT_ROOT/pnpm-lock.yaml" ] || fail "missing pnpm-lock.yaml in $CHECKOUT_ROOT"

"$SCRIPT_DIR/ensure-pnpm.sh" "$CHECKOUT_ROOT"

step "installing dependencies in $CHECKOUT_ROOT"
cd "$CHECKOUT_ROOT"
if command -v pnpm >/dev/null; then
  pnpm install --frozen-lockfile
else
  corepack pnpm install --frozen-lockfile
fi

seed_ck_index "$CHECKOUT_ROOT"

step "complete"
