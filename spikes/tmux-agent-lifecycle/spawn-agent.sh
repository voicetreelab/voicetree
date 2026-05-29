#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 AGENT_NAME [PROMPT]" >&2
}

json_escape() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 2
fi

agent_name="$1"
prompt="${2:-}"
project_dir="${PROJECT_DIR:-./test-project}"
terminal_dir="$project_dir/.voicetree/terminals"
log_file="$terminal_dir/$agent_name.log"
metadata_file="$terminal_dir/$agent_name.json"
session_name="vt-$agent_name"

mkdir -p "$terminal_dir"

if tmux has-session -t "$session_name" 2>/dev/null; then
  echo "tmux session already exists: $session_name" >&2
  exit 1
fi

if [[ -n "$prompt" ]]; then
  command_text="VOICETREE_TERMINAL_ID=$(printf '%q' "$agent_name") claude --print $(printf '%q' "$prompt")"
else
  command_text="VOICETREE_TERMINAL_ID=$(printf '%q' "$agent_name") bash"
fi

: > "$log_file"
tmux new-session -d -s "$session_name" -x 200 -y 50 "$command_text"
tmux pipe-pane -t "$session_name" -o "cat >> $(printf '%q' "$log_file")"

pid="$(tmux display-message -p -t "$session_name" '#{pane_pid}')"
started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

cat > "$metadata_file" <<JSON
{"name":"$(json_escape "$agent_name")","status":"running","pid":$pid,"session":"$(json_escape "$session_name")","startedAt":"$started_at","logFile":"$(json_escape "$log_file")"}
JSON

echo "spawned $agent_name in tmux session $session_name"
