#!/bin/bash
# Run eslint and tsc on specific modified file

# Parse JSON input to get file absolutePath
file_path=$(python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('tool_input', {}).get('file_path', ''))")

# Only check TypeScript/JavaScript files
if [[ ! "$file_path" =~ \.(ts|tsx|js|jsx)$ ]]; then
    exit 0
fi

cd /Users/bobbobby/repos/VoiceTree/frontend/webapp

# Run eslint on the specific file
eslint_output=$(npx eslint "$file_path" 2>&1)
eslint_code=$?

# Run tsc in build mode (tsc -b is stricter and matches production build)
tsc_output=$(npx tsc -b 2>&1)
tsc_code=$?

# Filter tsc errors to only include the edited file
if [ $tsc_code -ne 0 ]; then
    tsc_file_errors=$(echo "$tsc_output" | grep "^$file_path")
    if [ -n "$tsc_file_errors" ]; then
        tsc_has_file_errors=1
    else
        tsc_has_file_errors=0
    fi
else
    tsc_has_file_errors=0
fi

# If either failed, output to stderr and block Claude
if [ $eslint_code -ne 0 ] || [ $tsc_has_file_errors -ne 0 ]; then
    if [ $eslint_code -ne 0 ]; then
        echo "ESLint errors in $file_path:" >&2
        echo "$eslint_output" >&2
    fi
    if [ $tsc_has_file_errors -ne 0 ]; then
        echo "TypeScript errors in $file_path:" >&2
        echo "$tsc_file_errors" >&2
    fi
    echo "please fix THESE PROBLEMS." >&2
    exit 2
fi

exit 0
