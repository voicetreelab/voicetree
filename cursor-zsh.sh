#!/bin/zsh
# Simple zsh wrapper for Cursor automation
# This avoids P10k and other interactive features

# Basic environment
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export PS1="$ "

# Keep important environment variables
export GOOGLE_API_KEY="${GOOGLE_API_KEY:-}"

# Disable problematic features
unsetopt AUTO_CD CORRECT CORRECT_ALL
setopt NO_BEEP NO_FLOW_CONTROL

# Use emacs mode (not vi mode)
bindkey -e

# Execute the command
exec "$@" 