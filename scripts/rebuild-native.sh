#!/usr/bin/env bash
#
# Rebuild native node-addon modules for their target runtimes.
#
# Two categories of native modules exist in this workspace:
#
#   A. Modules that load INSIDE Electron (electron-trackpad-detect, node-pty)
#      → Must be compiled for Electron's ABI via electron-rebuild.
#
#   B. Modules that load in STANDALONE Node.js (better-sqlite3, sqlite-vec)
#      → Must be compiled for Node.js ABI. vt-graphd and knowledge-graph run
#        as detached Node processes, never inside Electron. The boundary test
#        (electron-native-boundary.test.ts) enforces this.
#
# Previously this script ran electron-rebuild on ALL native deps, including
# better-sqlite3. That compiled it for Electron ABI (e.g. 139) while
# vt-graphd needs Node.js ABI (e.g. 127), causing persistent
# NODE_MODULE_VERSION mismatch errors.
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

# --- Category A: Electron-hosted native modules ---

# 1. webapp's direct native deps (electron-trackpad-detect, node-pty).
echo "→ rebuild-native: webapp (Electron ABI)"
( cd "$ROOT/webapp" && "$REBUILD" )

# 2. agent-runtime's direct native deps (node-pty).
echo "→ rebuild-native: packages/agent-runtime (Electron ABI)"
( cd "$ROOT/packages/agent-runtime" && "$REBUILD" -f -w node-pty )

# --- Category B: Node.js-hosted native modules ---
# better-sqlite3 and sqlite-vec run in standalone Node.js processes
# (vt-graphd, knowledge-graph). Rebuild for Node.js ABI, not Electron.

echo "→ rebuild-native: better-sqlite3, sqlite-vec (Node.js ABI)"
( cd "$ROOT" && npm rebuild better-sqlite3 sqlite-vec 2>&1 )

echo "✔ rebuild-native: all native modules built for correct ABIs"
