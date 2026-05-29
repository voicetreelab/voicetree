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

# Find the main repo root via git. With sibling worktree layout (`<parent>/vt-wts[-remote]/<name>/`
# alongside `<parent>/vtrepo[-synced]/`), `$WORKTREE_PATH/../..` would point at
# `<parent>`, not at the main repo. `git worktree list --porcelain` always emits
# the main worktree first with an absolute path, regardless of layout.
REPO_ROOT="$(git -C "$WORKTREE_PATH" worktree list --porcelain | awk '/^worktree / {print $2; exit}')"
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT" ]; then
    echo "configure-cdp: ERROR could not resolve main repo root from $WORKTREE_PATH" >&2
    exit 1
fi
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

# --- Sync voicetree MCP URL into worktree configs ---
# Electron forwards VOICETREE_MCP_PORT via runHook so codex/claude-code agents
# spawned in this worktree reach the running MCP server. Silent skip if absent
# (e.g. running the hook by hand outside Electron).
if [ -n "$VOICETREE_MCP_PORT" ]; then
    VT_MCP_URL="http://localhost:$VOICETREE_MCP_PORT/mcp"
    echo "configure-cdp: syncing voicetree MCP URL = $VT_MCP_URL"

    # --- Patch .mcp.json voicetree.url (preserve other servers + Playwright args) ---
    if command -v jq >/dev/null 2>&1; then
        jq --arg url "$VT_MCP_URL" \
           '.mcpServers.voicetree.url = $url | .mcpServers.voicetree.type = "http"' \
           "$WORKTREE_PATH/.mcp.json" > "$WORKTREE_PATH/.mcp.json.tmp" && \
        mv "$WORKTREE_PATH/.mcp.json.tmp" "$WORKTREE_PATH/.mcp.json"
    else
        # sed fallback: replace any http://host:port/mcp in voicetree block.
        # Less safe than jq but the file template is small and stable.
        sed -E "s|(\"voicetree\"[^}]*\"url\":[[:space:]]*\")[^\"]*(\")|\1$VT_MCP_URL\2|" \
            "$WORKTREE_PATH/.mcp.json" > "$WORKTREE_PATH/.mcp.json.tmp" && \
        mv "$WORKTREE_PATH/.mcp.json.tmp" "$WORKTREE_PATH/.mcp.json"
    fi

    # --- Patch .codex/config.toml [mcp_servers.voicetree] (preserve other sections) ---
    CODEX_DIR="$WORKTREE_PATH/.codex"
    CODEX_CFG="$CODEX_DIR/config.toml"
    mkdir -p "$CODEX_DIR"
    if [ -f "$CODEX_CFG" ] && grep -q '^\[mcp_servers\.voicetree\]' "$CODEX_CFG"; then
        # Replace the section's url line. The TOML section is one line + one key line.
        # awk preserves every other section verbatim.
        awk -v url="$VT_MCP_URL" '
            BEGIN { in_section = 0 }
            /^\[mcp_servers\.voicetree\]/ { print; in_section = 1; next }
            in_section && /^\[/ { in_section = 0 }
            in_section && /^url[[:space:]]*=/ { print "url = \"" url "\""; next }
            { print }
        ' "$CODEX_CFG" > "$CODEX_CFG.tmp" && mv "$CODEX_CFG.tmp" "$CODEX_CFG"
    else
        # Append a fresh section (or create the file)
        if [ -s "$CODEX_CFG" ]; then printf '\n' >> "$CODEX_CFG"; fi
        printf '[mcp_servers.voicetree]\nurl = "%s"\n' "$VT_MCP_URL" >> "$CODEX_CFG"
    fi
    echo "  .codex/config.toml: $CODEX_CFG"
else
    echo "configure-cdp: VOICETREE_MCP_PORT unset; skipping voicetree MCP URL sync" >&2
fi
