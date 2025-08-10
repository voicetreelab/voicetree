#!/bin/bash

echo "Testing Round-Robin Agent Name Assignment"
echo "=========================================="

# Source the common setup functions
source "$(dirname "$0")/common_agent_setup.sh"

# Clean up any existing tracker for fresh test
TRACKER_FILE="$(dirname "$0")/.agent_names_tracker"
rm -f "$TRACKER_FILE"
echo "# Test started at $(date)" > "$TRACKER_FILE"

# Test generating several names in sequence
echo -e "\nGenerating names in round-robin order:"
for i in {1..10}; do
    export OBSIDIAN_SOURCE_NOTE="test_$i.md"
    export OBSIDIAN_VAULT_PATH="/tmp/test_vault"
    mkdir -p $OBSIDIAN_VAULT_PATH
    
    # Create a test source note without agent_name
    cat > "$OBSIDIAN_VAULT_PATH/$OBSIDIAN_SOURCE_NOTE" << EOF
---
node_id: test_$i
title: Test Node $i
---
Test content $i
EOF
    
    # Clear any existing env vars
    unset AGENT_NAME
    unset AGENT_COLOR
    
    # Call assign_agent_identity which will generate a name
    assign_agent_identity > /dev/null 2>&1
    
    echo "$i. Assigned: $AGENT_NAME (color: $AGENT_COLOR)"
done

echo -e "\nCurrent tracker file contents:"
cat "$TRACKER_FILE" | grep -v "^#"

# Test that names are unique
echo -e "\nVerifying uniqueness..."
NAMES_LIST=$(cat "$TRACKER_FILE" | grep -v "^#" | cut -d',' -f1 | sort)
UNIQUE_NAMES=$(cat "$TRACKER_FILE" | grep -v "^#" | cut -d',' -f1 | sort -u)

if [ "$NAMES_LIST" == "$UNIQUE_NAMES" ]; then
    echo "✓ All assigned names are unique!"
else
    echo "✗ Duplicate names detected!"
fi

# Clean up
rm -rf /tmp/test_vault

echo -e "\n=========================================="
echo "Round-robin test completed!"