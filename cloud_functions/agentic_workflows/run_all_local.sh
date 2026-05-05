#!/bin/bash

# Run all three agents locally in parallel
# Usage: ./run_all_local.sh

echo "Starting all agents locally..."
echo "  - Append Agent:    http://localhost:8080"
echo "  - Optimizer Agent: http://localhost:8081"
echo "  - Orphan Agent:    http://localhost:8082"
echo ""
echo "Press Ctrl+C to stop all agents"
echo ""

cd "$(dirname "$0")"

# Load environment variables from .env
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Trap Ctrl+C to kill all background processes
trap 'kill $(jobs -p) 2>/dev/null' EXIT

# Start all three agents in the background
functions-framework --target=append_agent_handler --source=main.py --port=8080 --debug &
functions-framework --target=optimizer_agent_handler --source=main_optimizer.py --port=8081 --debug &
functions-framework --target=orphan_agent_handler --source=main_orphan.py --port=8082 --debug &

# Wait for all background processes
wait
