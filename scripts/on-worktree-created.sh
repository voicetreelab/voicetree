#!/bin/sh
# on-worktree-created.sh
# Per-worktree setup: configures Playwright debug port.
#
# Called by VoiceTree's onWorktreeCreated hook after git worktree add.
# 1. Picks a free TCP port, patches .mcp.json for Playwright MCP, and writes
#    .cdp-port for Electron to read.
#
# Dep setup (node_modules + @vt/*) is handled by on-worktree-created-async.sh
# via symlinks + a tiny cp -a of @vt; see that script's header. Running
# `npm install` here used to clobber that setup (it'd write into main's
# shared tree because webapp/node_modules is a symlink), so it has been
# removed. If you need a fully private node_modules tree for this worktree
# (e.g. you're about to add an external dep or change Electron version),
# read the escape-hatch instructions at the top of on-worktree-created-async.sh.
#
# Usage: on-worktree-created.sh <worktreePath> <worktreeName>

set -e

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

exec "$SCRIPT_DIR/configure-worktree-cdp.sh" "$WORKTREE_PATH" "$WORKTREE_NAME"
