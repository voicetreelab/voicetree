#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 AGENT_NAME MESSAGE" >&2
}

if [[ $# -ne 2 ]]; then
  usage
  exit 2
fi

agent_name="$1"
message="$2"
session_name="vt-$agent_name"

if ! tmux has-session -t "$session_name" 2>/dev/null; then
  echo "tmux session not found: $session_name" >&2
  exit 1
fi

tmux send-keys -t "$session_name" "$message" C-m
echo "sent message to $agent_name"
