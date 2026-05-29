#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 AGENT_NAME [N_LINES]" >&2
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 2
fi

agent_name="$1"
n_lines="${2:-50}"
project_dir="${PROJECT_DIR:-./test-project}"
log_file="$project_dir/.voicetree/terminals/$agent_name.log"

if [[ ! "$n_lines" =~ ^[0-9]+$ ]]; then
  echo "N_LINES must be a positive integer" >&2
  exit 2
fi

if [[ ! -f "$log_file" ]]; then
  echo "log file not found: $log_file" >&2
  exit 1
fi

tail -n "$n_lines" "$log_file"
