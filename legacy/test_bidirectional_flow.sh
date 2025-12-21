#!/bin/bash

# Mock the environment that claude.sh sets up
export OBSIDIAN_VAULT_PATH="/Users/bobbobby/repos/VoiceTree/frontend/webapp"
export OBSIDIAN_SOURCE_NOTE="ctx-nodes/76_Spawning_Terminals_with_Context_Node.md"

# Source the common setup (like claude.sh does)
source "$(dirname "$0")/common_agent_setup.sh"

# Run the dependency graph generation
generate_dependency_graph

# Check results
echo "=== EXIT CODE: $? ==="
echo "=== DEPENDENCY_GRAPH_CONTENT LENGTH ==="
echo ${#DEPENDENCY_GRAPH_CONTENT}
echo ""
echo "=== FIRST 1000 CHARS ==="
echo "${DEPENDENCY_GRAPH_CONTENT:0:1000}"
echo ""
echo "=== NODE COUNT ==="
echo "$DEPENDENCY_GRAPH_CONTENT" | grep -c "^File:"
