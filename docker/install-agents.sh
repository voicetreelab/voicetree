#!/usr/bin/env bash
# Optional installer for additional terminal-based agents. Run inside a
# running container (`docker exec -it voicetree bash -lc install-agents.sh`)
# to add codex / opencode / gemini alongside the preinstalled Claude Code.
set -euo pipefail

sudo npm install -g \
    @openai/codex \
    opencode-ai \
    @google/gemini-cli

echo "Installed: codex, opencode, gemini"
