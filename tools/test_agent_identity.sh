#!/bin/bash

echo "Testing Agent Name/Color Differentiation System"
echo "================================================"

# Source the common setup functions
source "$(dirname "$0")/common_agent_setup.sh"

# Test 1: Generate new agent identity
echo -e "\nTest 1: Generating new agent identity..."
export OBSIDIAN_SOURCE_NOTE="test_note.md"
export OBSIDIAN_VAULT_PATH="/tmp/test_vault"
mkdir -p $OBSIDIAN_VAULT_PATH

# Create a test source note without agent_name
cat > "$OBSIDIAN_VAULT_PATH/$OBSIDIAN_SOURCE_NOTE" << EOF
---
node_id: test_1
title: Test Node
---
Test content
EOF

# Clear any existing env vars
unset AGENT_NAME
unset AGENT_COLOR

# Call assign_agent_identity
assign_agent_identity

echo "Generated AGENT_NAME: $AGENT_NAME"
echo "Generated AGENT_COLOR: $AGENT_COLOR"

# Test 2: Existing agent_name in source note
echo -e "\nTest 2: Using existing agent_name from source note..."

# Create a test source note with agent_name
cat > "$OBSIDIAN_VAULT_PATH/$OBSIDIAN_SOURCE_NOTE" << EOF
---
node_id: test_2
title: Test Node
agent_name: TestBot
color: purple
---
Test content with existing identity
EOF

# Clear env vars again
unset AGENT_NAME
unset AGENT_COLOR

# Call assign_agent_identity
assign_agent_identity

echo "Loaded AGENT_NAME: $AGENT_NAME (should be TestBot)"
echo "Loaded AGENT_COLOR: $AGENT_COLOR (should be purple)"

# Test 3: Creating nodes with agent identity
echo -e "\nTest 3: Creating nodes with agent identity..."

# Set up for add_new_node test
export AGENT_NAME="Alice"
export AGENT_COLOR="blue"

# Create parent node
cat > "$OBSIDIAN_VAULT_PATH/1_parent.md" << EOF
---
node_id: 1
title: Parent Node
---
Parent content
EOF

# Test add_new_node with environment variables
echo "Creating node with AGENT_NAME=$AGENT_NAME and AGENT_COLOR=$AGENT_COLOR"
python add_new_node.py "$OBSIDIAN_VAULT_PATH/1_parent.md" "Test Progress" "Testing agent identity system" is_progress_of

# Check if the created file has agent_name in frontmatter
if [ -f "$OBSIDIAN_VAULT_PATH/1_1_Test_Progress.md" ]; then
    echo -e "\nCreated node content:"
    head -n 10 "$OBSIDIAN_VAULT_PATH/1_1_Test_Progress.md"
fi

# Test 4: Override with CLI parameters
echo -e "\nTest 4: Creating node with --agent-name override..."
python add_new_node.py "$OBSIDIAN_VAULT_PATH/1_parent.md" "Bob Task" "Task for Bob" is_subtask_of --color green --agent-name Bob

if [ -f "$OBSIDIAN_VAULT_PATH/1_2_Bob_Task.md" ]; then
    echo -e "\nCreated node with override:"
    head -n 10 "$OBSIDIAN_VAULT_PATH/1_2_Bob_Task.md"
fi

# Clean up
rm -rf $OBSIDIAN_VAULT_PATH

echo -e "\n================================================"
echo "Tests completed!"