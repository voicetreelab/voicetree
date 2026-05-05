#!/bin/bash

# Run Optimizer Agent locally on port 8081
# Usage: ./run_local_optimizer.sh

echo "Starting Optimizer Agent locally on http://localhost:8081"
echo "Press Ctrl+C to stop"
echo ""

cd "$(dirname "$0")"

# Load environment variables from .env
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

functions-framework --target=optimizer_agent_handler --source=main.py --port=8081 --debug
