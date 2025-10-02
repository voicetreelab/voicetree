#!/bin/bash
# Run eslint and tsc on specific modified file

# Parse JSON input to get file path
file_path=$(python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('tool_input', {}).get('file_path', ''))")

# Only check TypeScript/JavaScript files
if [[ ! "$file_path" =~ \.(ts|tsx|js|jsx)$ ]]; then
    exit 0
fi

cd /Users/bobbobby/repos/VoiceTree/frontend/webapp

# Run eslint on the specific file
eslint_output=$(eslint "$file_path" 2>&1)
eslint_code=$?

# Run tsc on whole project (tsc --noEmit needs full context)
tsc_output=$(tsc --noEmit 2>&1)
tsc_code=$?

# If either failed, output to stderr and block Claude
if [ $eslint_code -ne 0 ] || [ $tsc_code -ne 0 ]; then
    if [ $eslint_code -ne 0 ]; then
        echo "ESLint errors in $file_path:" >&2
        echo "$eslint_output" >&2
    fi
    if [ $tsc_code -ne 0 ]; then
        echo "TypeScript errors:" >&2
        echo "$tsc_output" >&2
    fi
    echo "YOU MUST NOW FIX THESE PROBLEMS." >&2
    exit 2
fi

exit 0
