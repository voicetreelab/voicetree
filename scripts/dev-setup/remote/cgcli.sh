#!/usr/bin/env bash
# cgcli.sh — PATH shim for @vt/code-graph-cli (symbol-resolved call-graph CLI).
#
# The packaged CLI lives in-repo (packages/libraries/code-graph-cli) and runs
# under tsx; it ships no standalone build artifact. This shim runs it against
# the repo of the current working directory, so it analyses the worktree you're
# in — cgcli resolves its own REPO_ROOT relative to its bin file, so invoking a
# worktree's copy targets that worktree. Falls back to the canonical synced
# clone when called from outside any vtrepo checkout.
#
# Installed by install.sh as the symlink target of /usr/local/bin/cgcli.
set -euo pipefail

CANONICAL="${VT_CGCLI_REPO:-/root/vtrepo-synced}"

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ] || [ ! -f "$root/packages/libraries/code-graph-cli/bin/cgcli.ts" ]; then
  root="$CANONICAL"
fi

cli="$root/packages/libraries/code-graph-cli/bin/cgcli.ts"
tsx="$root/node_modules/.bin/tsx"

[ -f "$cli" ] || { echo "cgcli: CLI not found at $cli (is the repo checked out?)" >&2; exit 70; }
[ -x "$tsx" ] || { echo "cgcli: tsx missing at $tsx (run pnpm install at $root)" >&2; exit 70; }

exec "$tsx" "$cli" "$@"
