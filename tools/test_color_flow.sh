#!/bin/bash

# Test script to verify the orchestrator -> subagent color flow

echo "=== Testing Orchestrator -> Subagent Color Flow ==="
echo

# Set up test environment
export OBSIDIAN_VAULT_PATH="/tmp/test_vault"
mkdir -p "$OBSIDIAN_VAULT_PATH"

# Step 1: Create a parent node (simulating existing tree)
echo "1. Creating parent node..."
cat > "$OBSIDIAN_VAULT_PATH/1_parent_task.md" << EOF
---
node_id: 1
title: Parent Task (1)
---
This is the main task that needs to be decomposed.
EOF

# Step 2: Orchestrator creates subtask with specific color (green)
echo "2. Orchestrator creating subtask with green color..."
export AGENT_COLOR="orchestrator_default"  # Orchestrator's own color
python add_new_node.py \
    "$OBSIDIAN_VAULT_PATH/1_parent_task.md" \
    "Bob implement feature" \
    "Task: Implement the feature X with requirements Y" \
    "is_subtask_of" \
    --color green

# Find the created file
SUBTASK_FILE=$(ls -t "$OBSIDIAN_VAULT_PATH" | grep -E "^1_.*Bob.*\.md$" | head -1)
echo "Created subtask file: $SUBTASK_FILE"
echo

# Step 3: Show the subtask content
echo "3. Subtask content:"
cat "$OBSIDIAN_VAULT_PATH/$SUBTASK_FILE"
echo
echo

# Step 4: Simulate subagent being spawned on this subtask
echo "4. Testing subagent color inheritance..."
export OBSIDIAN_SOURCE_NOTE="$SUBTASK_FILE"

# Source the common setup to test color extraction
source ./common_agent_setup.sh

# Just test the color assignment function
assign_agent_color

echo "Agent color assigned: $AGENT_COLOR"
echo

# Step 5: Verify subagent creates nodes with inherited color
echo "5. Subagent creating progress node with inherited color..."
python add_new_node.py \
    "$OBSIDIAN_VAULT_PATH/$SUBTASK_FILE" \
    "Progress Update 1" \
    "Completed initial setup" \
    "is_progress_of"

# Find and show the progress node
PROGRESS_FILE=$(ls -t "$OBSIDIAN_VAULT_PATH" | grep -E "Progress.*\.md$" | head -1)
echo "Created progress file: $PROGRESS_FILE"
echo
echo "Progress node content:"
cat "$OBSIDIAN_VAULT_PATH/$PROGRESS_FILE"
echo

# Cleanup
echo "=== Test Complete ==="
echo "Check that:"
echo "1. Subtask has 'color: green' in frontmatter"
echo "2. Subagent inherited color 'green' from subtask"  
echo "3. Progress node also has 'color: green'"
echo
echo "Test files in: $OBSIDIAN_VAULT_PATH"