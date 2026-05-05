#!/bin/bash

# Run Append Agent locally on port 8080
# Usage: ./run_local_append.sh

echo "Starting Append Agent locally on http://localhost:8080"
echo "Press Ctrl+C to stop"
echo ""

cd "$(dirname "$0")"

# Load environment variables from .env
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

functions-framework --target=append_agent_handler --source=main.py --port=8080 --debug
