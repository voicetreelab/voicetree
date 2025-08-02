#!/bin/bash

# Check if OBSIDIAN_SOURCE_NAME is set
if [ -z "$OBSIDIAN_SOURCE_NOTE" ]; then
    echo "Error: OBSIDIAN_SOURCE_NAME is not set"
    echo "This script should be run from a Juggl terminal with the environment variable set"
    exit 1
fi

# Array of available colors for agents
COLORS=("red" "green" "blue" "purple" "orange" "pink" "cyan" "magenta" "indigo" "teal" "brown" "navy" "olive")

# Select a random color from the array
RANDOM_INDEX=$((RANDOM % ${#COLORS[@]}))
export AGENT_COLOR="${COLORS[$RANDOM_INDEX]}"

echo "Assigned color: $AGENT_COLOR to this agent session"

cd ~/repos

# Substitute environment variables in the prompt file and pass to claude
envsubst < demo_prompt_wait.md | claude --dangerously-skip-permissions --model sonnet