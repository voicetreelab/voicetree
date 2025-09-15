#!/bin/bash

# Script to flatten all markdown files in a directory into a single text file
# Usage: ./flattenDir.sh <input_directory> <output_file>

if [ $# -ne 2 ]; then
    echo "Usage: $0 <input_directory> <output_file>"
    echo "Example: $0 markdownTreeVault output.txt"
    exit 1
fi

INPUT_DIR="$1"
OUTPUT_FILE="$2"

if [ ! -d "$INPUT_DIR" ]; then
    echo "Error: Directory '$INPUT_DIR' does not exist"
    exit 1
fi

# Find and concatenate all markdown files
find "$INPUT_DIR" -type f -name "*.md" -exec cat {} \; > "$OUTPUT_FILE"

# Display results
FILE_COUNT=$(find "$INPUT_DIR" -type f -name "*.md" | wc -l)
LINE_COUNT=$(wc -l < "$OUTPUT_FILE")
CHAR_COUNT=$(wc -c < "$OUTPUT_FILE")

echo "Successfully flattened $FILE_COUNT markdown files from '$INPUT_DIR' into '$OUTPUT_FILE'"
echo "Output file contains $LINE_COUNT lines and $CHAR_COUNT characters"