#!/usr/bin/env bash
# Compatibility wrapper for the shared worktree dependency installer.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/common/install-worktree-deps.sh" "$@"
