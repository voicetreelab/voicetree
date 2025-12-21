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

# Find all markdown files, sort them (numerically if they have node IDs, otherwise alphabetically)
# Create empty output file
> "$OUTPUT_FILE"

# Process files with numeric prefixes first (e.g., "123_filename.md")
find "$INPUT_DIR" -type f -name "[0-9]*_*.md" -print0 | \
    while IFS= read -r -d '' file; do
        # Extract the numeric prefix for sorting
        basename_only=$(basename "$file")
        num_prefix=$(echo "$basename_only" | sed 's/^\([0-9]*\)_.*/\1/')
        echo "$num_prefix|$file"
    done | \
    sort -t'|' -k1,1n | \
    cut -d'|' -f2- | \
    while IFS= read -r file; do
        cat "$file" >> "$OUTPUT_FILE"
    done

# Then process files without numeric prefixes (alphabetically)
find "$INPUT_DIR" -type f -name "*.md" ! -name "[0-9]*_*.md" -print0 | \
    sort -z | \
    while IFS= read -r -d '' file; do
        cat "$file" >> "$OUTPUT_FILE"
    done

# Display results
FILE_COUNT=$(find "$INPUT_DIR" -type f -name "*.md" | wc -l)
LINE_COUNT=$(wc -l < "$OUTPUT_FILE")
CHAR_COUNT=$(wc -c < "$OUTPUT_FILE")

echo "Successfully flattened $FILE_COUNT markdown files from '$INPUT_DIR' into '$OUTPUT_FILE'"
echo "Output file contains $LINE_COUNT lines and $CHAR_COUNT characters"