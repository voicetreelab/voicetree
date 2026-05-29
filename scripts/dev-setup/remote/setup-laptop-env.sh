#!/usr/bin/env bash
# Configure machine-local laptop env for remote dev routing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REPO_ENV_FILE="$REPO_ROOT/.env"
HOME_ENV_FILE="$HOME/.env"

: "${VT_REMOTE_HOST:?set VT_REMOTE_HOST=root@<your-devbox-host> before running}"

if [ -f "$REPO_ENV_FILE" ] && grep -q '^VT_REMOTE_HOST=' "$REPO_ENV_FILE"; then
  current="$(awk -F= '/^VT_REMOTE_HOST=/{sub(/^VT_REMOTE_HOST=/,""); print; exit}' "$REPO_ENV_FILE")"
  if [ "$current" != "$VT_REMOTE_HOST" ]; then
    echo "setup-laptop-env: $REPO_ENV_FILE already has VT_REMOTE_HOST=$current; refusing to overwrite" >&2
    exit 1
  fi
else
  printf 'VT_REMOTE_HOST=%s\n' "$VT_REMOTE_HOST" >> "$REPO_ENV_FILE"
fi

"$SCRIPT_DIR/write-env-value.sh" "$HOME_ENV_FILE" VT_DEV_ROLE mac
"$SCRIPT_DIR/write-env-value.sh" "$HOME_ENV_FILE" VT_REMOTE_HOST "$VT_REMOTE_HOST"

echo "setup-laptop-env: $REPO_ENV_FILE has VT_REMOTE_HOST=$VT_REMOTE_HOST"
echo "setup-laptop-env: $HOME_ENV_FILE has VT_DEV_ROLE=mac and VT_REMOTE_HOST=$VT_REMOTE_HOST"
