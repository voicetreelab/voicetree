#!/usr/bin/env bash
set -euo pipefail

json_value() {
  local key="$1"
  local file="$2"
  sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$file" | head -n 1
}

json_number() {
  local key="$1"
  local file="$2"
  sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" "$file" | head -n 1
}

project_dir="${PROJECT_DIR:-./test-project}"
terminal_dir="$project_dir/.voicetree/terminals"

printf '%-20s %-10s %-10s %-24s %s\n' "NAME" "STATUS" "TMUX" "SESSION" "PID"

shopt -s nullglob
for metadata_file in "$terminal_dir"/*.json; do
  name="$(json_value "name" "$metadata_file")"
  status="$(json_value "status" "$metadata_file")"
  session="$(json_value "session" "$metadata_file")"
  pid="$(json_number "pid" "$metadata_file")"

  if [[ -n "$session" ]] && tmux has-session -t "$session" 2>/dev/null; then
    tmux_status="present"
  else
    tmux_status="missing"
  fi

  printf '%-20s %-10s %-10s %-24s %s\n' "$name" "$status" "$tmux_status" "$session" "$pid"
done
