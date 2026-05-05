#!/bin/bash

# Run Orphan Agent locally on port 8082
# Usage: ./run_local_orphan.sh

echo "Starting Orphan Agent locally on http://localhost:8082"
echo "Press Ctrl+C to stop"
echo ""

cd "$(dirname "$0")"

# Load environment variables from .env
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

functions-framework --target=orphan_agent_handler --source=main.py --port=8082 --debug
