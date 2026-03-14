#!/bin/bash
# trigger-overnight.sh — Trigger an overnight batch run via VoiceTree's MCP server.
#
# Reads the MCP server port from .mcp.json (written by VoiceTree at startup),
# then POSTs to /trigger-overnight to spawn a meta-observer agent.
#
# Usage:
#   ./trigger-overnight.sh [--dry-run] [--max-tasks=N] [--complexity-threshold=N] [--cost-cap=N]
#
# Requires: VoiceTree app running, jq and curl installed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_JSON="$PROJECT_ROOT/.mcp.json"

if [[ ! -f "$MCP_JSON" ]]; then
    echo "Error: $MCP_JSON not found. Is VoiceTree running?" >&2
    exit 1
fi

# Extract port from the voicetree MCP server URL in .mcp.json
PORT=$(jq -r '.mcpServers.voicetree.url' "$MCP_JSON" | sed 's|.*:\([0-9]*\)/.*|\1|')
if [[ -z "$PORT" || "$PORT" == "null" ]]; then
    echo "Error: Could not extract port from $MCP_JSON" >&2
    exit 1
fi

# Parse arguments
DRY_RUN=false
MAX_TASKS=""
COMPLEXITY_THRESHOLD=""
COST_CAP=""

for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=true
            ;;
        --max-tasks=*)
            MAX_TASKS="${arg#*=}"
            ;;
        --complexity-threshold=*)
            COMPLEXITY_THRESHOLD="${arg#*=}"
            ;;
        --cost-cap=*)
            COST_CAP="${arg#*=}"
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Usage: $0 [--dry-run] [--max-tasks=N] [--complexity-threshold=N] [--cost-cap=N]" >&2
            exit 1
            ;;
    esac
done

# Build JSON body
BODY="{}"
if [[ "$DRY_RUN" == "true" ]]; then
    BODY=$(echo "$BODY" | jq '. + {dryRun: true}')
fi
if [[ -n "$MAX_TASKS" ]]; then
    BODY=$(echo "$BODY" | jq --argjson v "$MAX_TASKS" '. + {maxTasks: $v}')
fi
if [[ -n "$COMPLEXITY_THRESHOLD" ]]; then
    BODY=$(echo "$BODY" | jq --argjson v "$COMPLEXITY_THRESHOLD" '. + {complexityThreshold: $v}')
fi
if [[ -n "$COST_CAP" ]]; then
    BODY=$(echo "$BODY" | jq --argjson v "$COST_CAP" '. + {costCapUsd: $v}')
fi

echo "Triggering overnight run on http://127.0.0.1:$PORT/trigger-overnight"
echo "Params: $BODY"

RESULT=$(curl -s -X POST "http://127.0.0.1:$PORT/trigger-overnight" \
    -H "Content-Type: application/json" \
    -d "$BODY")

echo "$RESULT" | jq .
