#!/bin/bash

# Edge Healing Test Script
# Creates test nodes to verify edge healing in VoiceTree
#
# Usage: ./test_edge_healing.sh [count] [directory]
#   count     - Number of each test type to create (default: 2)
#   directory - Target directory (default: current working directory)
#
# Test Types:
#   Type A: Child first, then parent with link (tests immediate edge resolution)
#   Type B: Parent with link first, then child (tests edge healing on child creation)

COUNT=${1:-2}
DIR=${2:-.}
DELAY=${3:-0.1}  # Delay between file creations in seconds

# Ensure directory exists
mkdir -p "$DIR"

# Generate unique prefix based on timestamp
PREFIX="edge_test_$(date +%s)"

echo "=== Edge Healing Test ==="
echo "Creating $COUNT of each test type in: $DIR"
echo "Prefix: $PREFIX"
echo ""

# Type A: Child first, then parent with link
echo "--- Type A: Child FIRST, then Parent with link ---"
for i in $(seq 1 $COUNT); do
    CHILD_FILE="$DIR/${PREFIX}_A${i}_child.md"
    PARENT_FILE="$DIR/${PREFIX}_A${i}_parent.md"

    # Create child first
    cat > "$CHILD_FILE" << EOF
# Child A$i

Child created FIRST. Parent will link to this.
EOF
    echo "Created child: $CHILD_FILE"
    sleep $DELAY

    # Create parent with link to child
    cat > "$PARENT_FILE" << EOF
# Parent A$i

Parent created AFTER child exists.

Link: [[${PREFIX}_A${i}_child.md]]
EOF
    echo "Created parent: $PARENT_FILE"
    sleep $DELAY
done

echo ""

# Type B: Parent with link first, then child
echo "--- Type B: Parent with link FIRST, then Child ---"
for i in $(seq 1 $COUNT); do
    PARENT_FILE="$DIR/${PREFIX}_B${i}_parent.md"
    CHILD_FILE="$DIR/${PREFIX}_B${i}_child.md"

    # Create parent with dangling link first
    cat > "$PARENT_FILE" << EOF
# Parent B$i

Parent created BEFORE child exists.

Link: [[${PREFIX}_B${i}_child.md]]
EOF
    echo "Created parent: $PARENT_FILE"
    sleep $DELAY

    # Create child (should trigger edge healing)
    cat > "$CHILD_FILE" << EOF
# Child B$i

Child created AFTER parent. Edge should heal.
EOF
    echo "Created child: $CHILD_FILE"
    sleep $DELAY
done

echo ""
echo "=== Test Complete ==="
echo "Created $((COUNT * 2)) Type A files (child first)"
echo "Created $((COUNT * 2)) Type B files (parent first)"
echo "Total: $((COUNT * 4)) files"
echo ""
echo "Check VoiceTree UI for:"
echo "  - Type A: Edges should appear immediately"
echo "  - Type B: Edges should heal when children are created"
