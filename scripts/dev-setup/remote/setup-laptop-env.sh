#!/usr/bin/env bash
# Configure machine-local laptop (Mac) env for remote dev routing.
#
# Default run: writes VT_REMOTE_HOST + VT_DEV_ROLE=mac.
# With --configure-base: ALSO turns the Mac base ($VT_BASE_DIR, default the repo
# root this script lives in) into a read-only fast-forward cache of origin,
# creates the daily worktree, installs the dev-flow commands + the launchd sync
# timer. Must run AFTER git-gate is on PATH. See common/configure-base.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REPO_ENV_FILE="$REPO_ROOT/.env"
HOME_ENV_FILE="$HOME/.env"

CONFIGURE_BASE=0
for arg in "$@"; do
  case "$arg" in
    --configure-base) CONFIGURE_BASE=1 ;;
    *) echo "setup-laptop-env.sh: unknown arg: $arg" >&2; exit 64 ;;
  esac
done

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

# --- single-source base configuration (opt-in; needs git-gate on PATH) -------
if [ "$CONFIGURE_BASE" = "1" ]; then
  VT_BASE_DIR="${VT_BASE_DIR:-$REPO_ROOT}" \
    bash "$SCRIPT_DIR/../common/configure-base.sh"
fi
