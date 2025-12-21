#!/bin/bash

# Source the common setup functions
source "$(dirname "$0")/common_agent_setup.sh"

# Run common setup (sets up environment variables)
run_common_setup



promptstr=$(envsubst < prompts/prompt_main.md )

settings_file="$PWD/claude/settings.agent.json"

# Change to repos directory (parent of VoiceTree)
# If a relative path parameter is provided, cd to that location
if [ -n "$1" ]; then
  cd ~/$1
else
  cd ~
fi

# Substitute environment variables in the prompt file and pass to claude with settings
claude --dangerously-skip-permissions --settings "$settings_file" "$promptstr"