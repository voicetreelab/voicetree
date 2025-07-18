#!/bin/bash

# Check if number of commits is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <number_of_commits>"
    exit 1
fi

N=$1
OUTPUT_FILE="aggregated_changes.md"

# Validate that N is a positive integer
if ! [[ "$N" =~ ^[0-9]+$ ]] || [ "$N" -eq 0 ]; then
    echo "Error: Please provide a positive integer for the number of commits"
    exit 1
fi

# Get list of changed files in the last N commits
echo "# Aggregated Changes from Last $N Commits" > "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "Generated on: $(date)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Get unique files changed in last N commits, excluding the output file itself
FILES=$(git diff --name-only HEAD~$N HEAD 2>/dev/null | grep -v "^${OUTPUT_FILE}$" | sort | uniq)

if [ -z "$FILES" ]; then
    echo "No files changed in the last $N commits." >> "$OUTPUT_FILE"
    exit 0
fi

# Create comma-separated list
FILES_LIST=$(echo "$FILES" | tr '\n' ',' | sed 's/,$//')

echo "## List of files changed:" >> "$OUTPUT_FILE"
echo "$FILES_LIST" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Process each file
for FILE in $FILES; do
    echo "## Filename: $FILE" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    
    if [ -f "$FILE" ]; then
        echo '```' >> "$OUTPUT_FILE"
        cat "$FILE" >> "$OUTPUT_FILE"
        echo '```' >> "$OUTPUT_FILE"
    else
        echo "*File no longer exists in current working tree*" >> "$OUTPUT_FILE"
    fi
    
    echo "" >> "$OUTPUT_FILE"
    echo "-----------" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
done

echo "Aggregated changes written to $OUTPUT_FILE"