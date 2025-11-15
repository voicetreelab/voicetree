#!/bin/bash

# Run the fixup tests command 10 times
for i in {1..10}; do
  echo "========================================="
  echo "Running iteration $i of 10"
  echo "========================================="

  promptstr=$(envsubst < meta/fixup_tests.md)
  claude --dangerously-skip-permissions "$promptstr"

  echo ""
  echo "Completed iteration $i"
  echo ""
done

echo "All 10 iterations completed!"
