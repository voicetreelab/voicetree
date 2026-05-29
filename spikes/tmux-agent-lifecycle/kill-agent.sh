#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 AGENT_NAME" >&2
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

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

agent_name="$1"
project_dir="${PROJECT_DIR:-./test-project}"
terminal_dir="$project_dir/.voicetree/terminals"
metadata_file="$terminal_dir/$agent_name.json"
session_name="vt-$agent_name"

if tmux has-session -t "$session_name" 2>/dev/null; then
  tmux kill-session -t "$session_name"
fi

mkdir -p "$terminal_dir"
exited_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

if [[ -f "$metadata_file" ]]; then
  pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$metadata_file" | head -n 1)"
  started_at="$(sed -n 's/.*"startedAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$metadata_file" | head -n 1)"
  log_file="$(sed -n 's/.*"logFile"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$metadata_file" | head -n 1)"
else
  pid="0"
  started_at=""
  log_file="$terminal_dir/$agent_name.log"
fi

cat > "$metadata_file" <<JSON
{"name":"$(json_escape "$agent_name")","status":"exited","pid":$pid,"session":"$(json_escape "$session_name")","startedAt":"$(json_escape "$started_at")","exitedAt":"$exited_at","logFile":"$(json_escape "$log_file")"}
JSON

echo "killed $agent_name"
