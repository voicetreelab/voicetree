#!/bin/bash

# NoLiMa VoiceTree Benchmark Runner
# Usage: ./run_nolima_benchmark.sh <dataset_name> <question>
# Example: ./run_nolima_benchmark.sh nolima_8k_spain "Which character has been to Spain?"

set -e

# Check arguments
if [ $# -lt 2 ]; then
    echo "Usage: $0 <dataset_name> <question>"
    echo "Example: $0 nolima_8k_spain \"Which character has been to Spain?\""
    echo ""
    echo "Available datasets:"
    echo "  - nolima_8k_spain"
    echo "  - nolima_16k_vegan"
    exit 1
fi

DATASET_NAME=$1
QUESTION=$2

# Set paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VOICETREE_DIR="$(dirname "$SCRIPT_DIR")"
MARKDOWN_FOLDER="${VOICETREE_DIR}/backend/benchmarker/output/${DATASET_NAME}"
TOOLS_DIR="${SCRIPT_DIR}"
PROMPT_TEMPLATE="${SCRIPT_DIR}/nolima_agent_prompt.md"

# Check if dataset exists
if [ ! -d "$MARKDOWN_FOLDER" ]; then
    echo "Error: Dataset directory not found: $MARKDOWN_FOLDER"
    echo "Make sure you've run VoiceTree on the dataset first."
    exit 1
fi

# Check if prompt template exists
if [ ! -f "$PROMPT_TEMPLATE" ]; then
    echo "Error: Prompt template not found: $PROMPT_TEMPLATE"
    exit 1
fi

# Create temporary prompt file with filled template
TEMP_PROMPT=$(mktemp /tmp/nolima_prompt.XXXXXX.md)
trap "rm -f $TEMP_PROMPT" EXIT

# Fill in the template
sed -e "s|{question}|${QUESTION}|g" \
    -e "s|{markdown_folder}|${MARKDOWN_FOLDER}|g" \
    -e "s|{tools_dir}|${TOOLS_DIR}|g" \
    "$PROMPT_TEMPLATE" > "$TEMP_PROMPT"

echo "==============================================="
echo "Running NoLiMa Benchmark"
echo "==============================================="
echo "Dataset: $DATASET_NAME"
echo "Question: $QUESTION"
echo "Markdown folder: $MARKDOWN_FOLDER"
echo "Tools directory: $TOOLS_DIR"
echo "==============================================="
echo ""

# Count nodes in dataset
NODE_COUNT=$(ls -1 "$MARKDOWN_FOLDER"/*.md 2>/dev/null | wc -l | tr -d ' ')
echo "Dataset contains $NODE_COUNT nodes"
echo ""

# Run Claude with the filled prompt
echo "Launching Claude to answer the question..."
echo "-----------------------------------------------"
claude -p "$TEMP_PROMPT" --model sonnet --max-turns 10

echo ""
echo "==============================================="
echo "Benchmark completed!"
echo "==============================================="