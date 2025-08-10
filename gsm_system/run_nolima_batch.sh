#!/bin/bash

# NoLiMa VoiceTree Batch Benchmark Runner
# Runs multiple benchmark questions on specified datasets

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Function to run a single benchmark
run_benchmark() {
    local dataset=$1
    local question=$2
    echo ""
    echo "🔍 Testing: $question"
    echo "   Dataset: $dataset"
    echo "-------------------------------------------"
    "$SCRIPT_DIR/run_nolima_benchmark.sh" "$dataset" "$question"
}

# Test cases for nolima_8k_spain
echo "==============================================="
echo "Running NoLiMa 8K Spain Benchmarks"
echo "==============================================="

run_benchmark "nolima_8k_spain" "Which character has been to Spain?"
run_benchmark "nolima_8k_spain" "Who visited the Prado Museum?"
run_benchmark "nolima_8k_spain" "Which character saw the Garden of Earthly Delights?"

# Test cases for nolima_16k_vegan  
echo ""
echo "==============================================="
echo "Running NoLiMa 16K Vegan Benchmarks"
echo "==============================================="

run_benchmark "nolima_16k_vegan" "Which character is vegan?"
run_benchmark "nolima_16k_vegan" "Who doesn't eat meat?"
run_benchmark "nolima_16k_vegan" "Which character follows a plant-based diet?"

echo ""
echo "==============================================="
echo "All benchmarks completed!"
echo "==============================================="