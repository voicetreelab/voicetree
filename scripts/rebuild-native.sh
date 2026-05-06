#!/usr/bin/env bash
#
# Rebuild all native node-addon modules for Electron's bundled Node ABI.
#
# Why this exists:
#   `electron-rebuild` only sees modules listed as DIRECT dependencies of the
#   package whose dir it runs in. Our workspace splits native modules across
#   two packages — `electron-trackpad-detect` is a direct dep of `webapp`,
#   `better-sqlite3` is a direct dep of `packages/graph-db-server` — and
#   `node_modules` gets hoisted to the workspace root.
#
#   Running `electron-rebuild` from `webapp/` (the obvious choice) silently
#   no-ops `better-sqlite3` and reports "Rebuild Complete" anyway, leaving
#   the daemon unable to load the native binding (NODE_MODULE_VERSION
#   mismatch). We have to invoke `electron-rebuild` once per package that
#   directly owns a native dep.
#
# Usage: scripts/rebuild-native.sh
# Exits non-zero if any rebuild step fails.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REBUILD="$ROOT/webapp/node_modules/.bin/electron-rebuild"

if [[ ! -x "$REBUILD" ]]; then
    echo "rebuild-native: $REBUILD not found. Run 'npm install' first." >&2
    exit 1
fi

# 1. webapp's direct native deps (e.g. electron-trackpad-detect).
echo "→ rebuild-native: webapp"
( cd "$ROOT/webapp" && "$REBUILD" )

# 2. graph-db-server's direct native deps (better-sqlite3).
echo "→ rebuild-native: packages/graph-db-server"
( cd "$ROOT/packages/graph-db-server" && "$REBUILD" -f -w better-sqlite3 )

echo "✔ rebuild-native: all native modules built for Electron ABI"
