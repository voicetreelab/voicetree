#!/bin/sh
# on-worktree-created.sh
# Per-worktree setup: installs deps, configures Playwright debug port.
#
# Called by VoiceTree's onWorktreeCreated hook after git worktree add.
# 1. Installs npm dependencies in webapp/
# 2. Picks a free TCP port, patches .mcp.json for Playwright MCP,
#    and writes .cdp-port for Electron to read.
#
# Usage: on-worktree-created.sh <worktreePath> <worktreeName>

set -e

WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

# Find repo root (parent of .worktrees/)
REPO_ROOT="$(cd "$WORKTREE_PATH/../.." && pwd)"

# --- Install npm dependencies ---
if [ -f "$WORKTREE_PATH/webapp/package.json" ]; then
    echo "Installing npm dependencies in $WORKTREE_PATH/webapp ..."
    (cd "$WORKTREE_PATH/webapp" && npm install --prefer-offline 2>&1) || {
        echo "WARNING: npm install failed (non-blocking)" >&2
    }
fi

# --- Find a free TCP port in range 9222-9322 ---
PORT=$(python3 -c "
import socket
for port in range(9222, 9323):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(('127.0.0.1', port))
        s.close()
        print(port)
        break
    except OSError:
        continue
else:
    print('0')
")

if [ "$PORT" = "0" ]; then
    echo "ERROR: No free port found in range 9222-9322" >&2
    exit 1
fi

echo "Selected CDP port: $PORT for worktree $WORKTREE_NAME"

# --- Write .cdp-port file ---
echo "$PORT" > "$WORKTREE_PATH/.cdp-port"

# --- Copy and patch .mcp.json ---
MCP_TEMPLATE="$REPO_ROOT/.mcp.json"

if [ ! -f "$MCP_TEMPLATE" ]; then
    echo "WARNING: No .mcp.json template found at $MCP_TEMPLATE" >&2
    exit 0
fi

cp "$MCP_TEMPLATE" "$WORKTREE_PATH/.mcp.json"

# Patch playwright CDP endpoint port
if command -v jq >/dev/null 2>&1; then
    jq --arg endpoint "http://localhost:$PORT" \
       '.mcpServers.playwright.args = ["@playwright/mcp@latest", "--cdp-endpoint", $endpoint]' \
       "$WORKTREE_PATH/.mcp.json" > "$WORKTREE_PATH/.mcp.json.tmp" && \
    mv "$WORKTREE_PATH/.mcp.json.tmp" "$WORKTREE_PATH/.mcp.json"
else
    sed "s|http://localhost:[0-9]*|http://localhost:$PORT|g" \
        "$WORKTREE_PATH/.mcp.json" > "$WORKTREE_PATH/.mcp.json.tmp" && \
    mv "$WORKTREE_PATH/.mcp.json.tmp" "$WORKTREE_PATH/.mcp.json"
fi

echo "Worktree $WORKTREE_NAME configured with CDP port $PORT"
echo "  .cdp-port: $WORKTREE_PATH/.cdp-port"
echo "  .mcp.json: $WORKTREE_PATH/.mcp.json"
