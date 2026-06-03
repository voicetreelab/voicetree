#!/usr/bin/env bash
# Best-effort tsx JIT warm-up for the browser daemon round-trip tier.
#
# `vt serve` boots graphd + vtd from tsx SOURCE bins (no electron-vite build).
# On a cold CI runner, first-boot tsx compilation of the daemon module graphs
# can exceed the harness SERVE_READY_TIMEOUT_MS (20s). Pre-compiling here keeps
# the real boot inside that budget. Mirrors the electron-smoke job's graphd
# pre-warm and extends it to vtd. Never fails the build — the caller appends
# `|| true`, and every step here is defensive.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRAPHD_BIN="$REPO_ROOT/packages/systems/graph-db-server/bin/vt-graphd.ts"
VTD_BIN="$REPO_ROOT/packages/systems/vt-daemon/bin/vtd.ts"

TSX_PATH="$(node -e "console.log(require.resolve('tsx'))" 2>/dev/null)" || {
  echo "[prewarm] tsx not resolvable — skipping"; exit 0; }

WARM_DIR="$(mktemp -d 2>/dev/null || echo /tmp/vt-daemon-prewarm)"
mkdir -p "$WARM_DIR/.voicetree"
echo "# prewarm" > "$WARM_DIR/root.md"

# graphd: boot with a short idle-timeout so it compiles the real server path and
# self-exits (no stranded daemon, no owner-record cleanup needed).
echo "[prewarm] graphd…"
timeout 30 node --import "$TSX_PATH" "$GRAPHD_BIN" \
  --project-root "$WARM_DIR" --idle-timeout-ms 3000 >/dev/null 2>&1 || true

# vtd: compile the entry + arg-parsing graph via --help (prints usage, exits 0).
# A full vtd boot needs a graphd sibling + owner-record teardown; the entry warm
# plus the shared @vt module graph already JIT'd above covers most cold latency.
echo "[prewarm] vtd…"
timeout 30 node --import "$TSX_PATH" "$VTD_BIN" --help >/dev/null 2>&1 || true

rm -rf "$WARM_DIR" 2>/dev/null || true
echo "[prewarm] done"
exit 0
