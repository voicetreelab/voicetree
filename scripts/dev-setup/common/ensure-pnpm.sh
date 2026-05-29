#!/usr/bin/env bash
# Activate the pnpm version pinned by package.json.

set -euo pipefail

TARGET_PATH="${1:-$PWD}"

fail() {
  printf 'ensure-pnpm: %s\n' "$*" >&2
  exit 1
}

[ "${2:-}" = "" ] || fail "expected at most one argument: [checkout-path]"
[ -d "$TARGET_PATH" ] || fail "checkout path does not exist: $TARGET_PATH"

CHECKOUT_ROOT="$(cd "$TARGET_PATH" && pwd)"
[ -f "$CHECKOUT_ROOT/package.json" ] || fail "missing package.json in $CHECKOUT_ROOT"

command -v node >/dev/null || fail "node is required"
command -v corepack >/dev/null || fail "corepack is required; install Node with bundled corepack"

PNPM_SPEC="$(cd "$CHECKOUT_ROOT" && node -p "require('./package.json').packageManager || ''")"

case "$PNPM_SPEC" in
  pnpm@*) ;;
  "") fail "package.json is missing packageManager; expected pnpm@<version>" ;;
  *) fail "packageManager must be pnpm@<version>, got: $PNPM_SPEC" ;;
esac

printf 'ensure-pnpm: activating %s\n' "$PNPM_SPEC"
corepack enable
corepack prepare "$PNPM_SPEC" --activate
