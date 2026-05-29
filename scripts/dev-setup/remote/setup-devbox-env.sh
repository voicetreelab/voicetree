#!/usr/bin/env bash
# Configure machine-local env on the remote devbox.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_ENV_FILE="$HOME/.env"

bash "$SCRIPT_DIR/write-env-value.sh" "$HOME_ENV_FILE" VT_DEV_ROLE remote

echo "setup-devbox-env: $HOME_ENV_FILE has VT_DEV_ROLE=remote"
