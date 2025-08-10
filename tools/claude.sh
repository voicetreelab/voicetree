#!/bin/bash

# Source the common setup functions
source "$(dirname "$0")/common_agent_setup.sh"

# Run common setup
run_common_setup

# Substitute environment variables in the prompt file and pass to claude with settings
envsubst < /Users/bobbobby/repos/VoiceTree/tools/prompts/prompt_main.md | claude --dangerously-skip-permissions --settings /Users/bobbobby/repos/VoiceTree/.claude/settings.json