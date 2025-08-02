#!/bin/bash

# Source the common setup functions
source "$(dirname "$0")/common_agent_setup.sh"

# Run common setup
run_common_setup

# Substitute environment variables in the prompt file and pass to claude
envsubst < demo_prompt_wait.md | claude --dangerously-skip-permissions