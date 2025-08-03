#!/bin/bash

# Source the common setup functions
source "$(dirname "$0")/common_agent_setup.sh"

# Run common setup
run_common_setup

# Source .env file (specific to gemini)
source .env

# Substitute environment variables in the prompt file and pass to gemini
promptstr=$(envsubst < /Users/bobbobby/repos/VoiceTree/tools/prompts/prompt_main.md )
gemini -y -i "$promptstr" --model "gemini-2.5-pro"