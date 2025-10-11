#!/bin/bash
# Run tests for modified file

# Parse JSON input to get file path
file_path=$(python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('tool_input', {}).get('file_path', ''))")

# Only check TypeScript/JavaScript files
if [[ ! "$file_path" =~ \.(ts|tsx|js|jsx)$ ]]; then
    exit 0
fi

cd /Users/bobbobby/repos/VoiceTree/frontend/webapp

# Extract filename without extension
filename=$(basename "$file_path")
basename_no_ext="${filename%.*}"

# Search for matching test files in tests/ folder
test_files=$(find tests -type f \( -name "${basename_no_ext}.test.*" -o -name "${basename_no_ext}.spec.*" \))

# If no test files found, exit successfully
if [ -z "$test_files" ]; then
    exit 0
fi

# Run vitest on matching test files with timeout
# Use perl-based timeout (macOS compatible) to kill vitest if it runs too long (120 seconds)
test_output=$(perl -e 'alarm 120; exec @ARGV' npx vitest run $test_files 2>&1)
test_code=$?

# If timeout occurred (exit code 142 = SIGALRM), treat as failure
if [ $test_code -eq 142 ]; then
    echo "Test timeout for $file_path - killed after 120 seconds" >&2
    exit 2
fi

# If tests failed, output to stderr and block Claude
if [ $test_code -ne 0 ]; then
    echo "Test failures for $file_path:" >&2
    echo "$test_output" >&2
    echo "please fix THESE TEST FAILURES." >&2
    exit 2
fi

exit 0
