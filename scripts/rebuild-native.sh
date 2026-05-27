#!/usr/bin/env bash
#
# Rebuild native node-addon modules for their target runtimes.
#
# Modules that load INSIDE Electron (electron-trackpad-detect, node-pty)
# must be compiled for Electron's ABI via electron-rebuild.
#
# Also builds the graph-db-server daemon to dist/vt-graphd.mjs so the daemon
# runs as a plain ESM bundle (no tsx loader at runtime). This avoids the
# Node 25 ERR_UNSUPPORTED_ESM_URL_SCHEME failure when tsx resolves
# Windows-style paths on a clean dev checkout.
#
# Usage: scripts/rebuild-native.sh
# Exits non-zero if any rebuild step fails.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Locate electron-rebuild. npm workspaces install it into webapp/node_modules;
# pnpm (hoisted) puts it at the workspace root.
REBUILD=""
for candidate in \
    "$ROOT/webapp/node_modules/.bin/electron-rebuild" \
    "$ROOT/node_modules/.bin/electron-rebuild"
do
    if [[ -x "$candidate" ]] || [[ -f "${candidate}.cmd" ]]; then
        REBUILD="$candidate"
        break
    fi
done

if [[ -z "$REBUILD" ]]; then
    echo "rebuild-native: electron-rebuild not found. Run 'npm install' first." >&2
    exit 1
fi

# 1. webapp's direct native deps (electron-trackpad-detect, node-pty).
echo "→ rebuild-native: webapp (Electron ABI)"
( cd "$ROOT/webapp" && "$REBUILD" )

# 2. vt-daemon's direct native deps (node-pty).
echo "→ rebuild-native: packages/systems/vt-daemon (Electron ABI)"
# electron-rebuild lstat's node_gyp_bins while force-rebuilding the hoisted
# node-pty package; npm may install node-pty without that optional directory.
mkdir -p "$ROOT/node_modules/node-pty/build/node_gyp_bins"
( cd "$ROOT/packages/systems/vt-daemon" && "$REBUILD" -f -w node-pty )

# 3. Build graph-db-server to dist/vt-graphd.mjs.
# resolveDefaultDaemonArgs prefers FALLBACK_BIN_PATH (dist) over the tsx-loaded
# source bin. Pre-building avoids the Node 25 + Windows ESM-URL-scheme bug
# where tsx resolves a 'c:\...' path that the loader rejects.
if [[ -f "$ROOT/packages/systems/graph-db-server/build.mjs" ]]; then
    echo "→ rebuild-native: packages/systems/graph-db-server (esbuild → dist/vt-graphd.mjs)"
    ( cd "$ROOT/packages/systems/graph-db-server" && node build.mjs )
fi

echo "✔ rebuild-native: all native modules built for correct ABIs"
