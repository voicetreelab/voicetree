#!/usr/bin/env bash
#
# Rebuild native node-addon modules for their target runtimes.
#
# Modules that load INSIDE Electron (electron-trackpad-detect, node-pty)
# must be compiled for Electron's ABI via electron-rebuild.
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

# 1. webapp's direct native deps (electron-trackpad-detect, node-pty).
echo "→ rebuild-native: webapp (Electron ABI)"
( cd "$ROOT/webapp" && "$REBUILD" )

# 2. agent-runtime's direct native deps (node-pty).
echo "→ rebuild-native: packages/systems/agent-runtime (Electron ABI)"
# electron-rebuild lstat's node_gyp_bins while force-rebuilding the hoisted
# node-pty package; npm may install node-pty without that optional directory.
mkdir -p "$ROOT/node_modules/node-pty/build/node_gyp_bins"
( cd "$ROOT/packages/systems/agent-runtime" && "$REBUILD" -f -w node-pty )

echo "✔ rebuild-native: all native modules built for correct ABIs"
