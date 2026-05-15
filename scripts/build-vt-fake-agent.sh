#!/usr/bin/env bash
#
# Ensure tools/vt-fake-agent has its dist/ build available before tier-1 e2e
# launches the fake agent via `node tools/vt-fake-agent/dist/index.js`.
#
# vt-fake-agent is a separate npm package outside the workspaces graph, so
# `npm install` in the root does not install or build it. Without this step a
# fresh worktree fails the tier-1 fake-agent smoke with a MODULE_NOT_FOUND
# from node's CJS loader pointing at the missing dist entrypoint.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAKE_AGENT_DIR="$ROOT/tools/vt-fake-agent"

if [[ ! -d "$FAKE_AGENT_DIR/node_modules" ]]; then
    echo "→ build-vt-fake-agent: installing $FAKE_AGENT_DIR"
    ( cd "$FAKE_AGENT_DIR" && npm install --no-audit --no-fund --silent )
fi

echo "→ build-vt-fake-agent: building $FAKE_AGENT_DIR/dist"
( cd "$FAKE_AGENT_DIR" && npm run build --silent )
