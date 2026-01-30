#!/bin/bash

# Run the fixup tests command N times
# Usage: ./run_fixup_tests_10x.sh [number_of_iterations]
# Default: 10 iterations if no argument provided

ITERATIONS=${1:-4}

for i in $(seq 1 $ITERATIONS); do
  echo "========================================="
  echo "Running iteration $i of $ITERATIONS"
  echo "========================================="

  promptstr=$(envsubst < meta/fixup_tests.md)
  claude --dangerously-skip-permissions -p "$promptstr"

  echo ""
  echo "Completed iteration $i"
  echo ""
done

echo "All $ITERATIONS iterations completed!"
