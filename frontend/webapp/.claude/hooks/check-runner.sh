#!/bin/bash
# Wrapper script to ensure npm run check outputs errors to stderr

cd /Users/bobbobby/repos/VoiceTree/frontend/webapp

# Run npm check and capture output
output=$(npm run check 2>&1)
exit_code=$?

# If the command failed, output everything to stderr and block Claude
if [ $exit_code -ne 0 ]; then
    echo "$output" >&2
    echo "YOU MUST NOW FIX THESE PROBLEMS, YOU ARE NOT ALLOWED TO STOP UNTIL ALL THESE ERRORS ARE FIXED."
    exit 2  # Exit code 2 blocks Claude
fi

# Success - no output needed
exit 0