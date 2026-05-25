#!/bin/sh
# Shared worktree setup: CDP port config + .mcp.json patching.
#
# Usage: configure-cdp.sh <worktreePath> <worktreeName>

set -e

WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

echo "configure-cdp: configuring $WORKTREE_NAME at $WORKTREE_PATH"

# Find repo root (parent of .worktrees/)
REPO_ROOT="$(cd "$WORKTREE_PATH/../.." && pwd)"
echo "configure-cdp: repo root $REPO_ROOT"

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

echo "configure-cdp: selected CDP port $PORT for worktree $WORKTREE_NAME"

# --- Write .cdp-port file ---
echo "configure-cdp: writing $WORKTREE_PATH/webapp/.cdp-port"
echo "$PORT" > "$WORKTREE_PATH/webapp/.cdp-port"

# --- Copy and patch .mcp.json ---
MCP_TEMPLATE="$REPO_ROOT/.mcp.json"

if [ ! -f "$MCP_TEMPLATE" ]; then
    echo "configure-cdp: WARNING no .mcp.json template found at $MCP_TEMPLATE; skipping MCP patch" >&2
    exit 0
fi

echo "configure-cdp: copying $MCP_TEMPLATE to $WORKTREE_PATH/.mcp.json"
cp "$MCP_TEMPLATE" "$WORKTREE_PATH/.mcp.json"

# Patch playwright CDP endpoint port
if command -v jq >/dev/null 2>&1; then
    echo "configure-cdp: patching Playwright MCP endpoint with jq"
    jq --arg endpoint "http://localhost:$PORT" \
       '.mcpServers.playwright.args = ["@playwright/mcp@latest", "--cdp-endpoint", $endpoint]' \
       "$WORKTREE_PATH/.mcp.json" > "$WORKTREE_PATH/.mcp.json.tmp" && \
    mv "$WORKTREE_PATH/.mcp.json.tmp" "$WORKTREE_PATH/.mcp.json"
else
    echo "configure-cdp: jq not found; patching Playwright MCP endpoint with sed"
    sed "s|http://localhost:[0-9]*|http://localhost:$PORT|g" \
        "$WORKTREE_PATH/.mcp.json" > "$WORKTREE_PATH/.mcp.json.tmp" && \
    mv "$WORKTREE_PATH/.mcp.json.tmp" "$WORKTREE_PATH/.mcp.json"
fi

echo "configure-cdp: worktree $WORKTREE_NAME configured with CDP port $PORT"
echo "  .cdp-port: $WORKTREE_PATH/webapp/.cdp-port"
echo "  .mcp.json: $WORKTREE_PATH/.mcp.json"
