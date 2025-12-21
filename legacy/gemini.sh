#!/bin/bash

# Source the common setup functions
source "$(dirname "$0")/common_agent_setup.sh"

# Run common setup (sets up environment variables)
run_common_setup

# Change to repos directory (parent of VoiceTree)
cd ../..

# Source .env file (specific to gemini)
source .env

# Substitute environment variables in the prompt file and pass to gemini
promptstr=$(envsubst < VoiceTree/tools/prompts/prompt_main.md )
gemini -y -i "$initial_content" --model "gemini-2.5-pro"