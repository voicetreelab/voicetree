#!/bin/bash

# Source the common setup functions
source "$(dirname "$0")/common_agent_setup.sh"

# Run common setup (sets up environment variables)
run_common_setup

# Change to repos directory (parent of VoiceTree)
cd ../..

# Substitute environment variables in the prompt file and pass to claude with settings
promptstr=$(envsubst < VoiceTree/tools/prompts/prompt_main.md )
claude --dangerously-skip-permissions --settings VoiceTree/.claude/settings.agent.json "$promptstr"