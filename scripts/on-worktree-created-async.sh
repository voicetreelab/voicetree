#!/bin/sh
# on-worktree-created-async.sh
# Async worktree setup: share external node_modules from main, materialize
# @vt/* package symlinks locally, and symlink .env.
# Runs after git worktree add, fire-and-forget (does not block terminal spawn).
#
# How node_modules is shared (and the bug this avoids):
#
#   Naive approach (PREVIOUSLY USED, BROKEN): symlink the whole
#     <worktree>/webapp/node_modules -> <main>/webapp/node_modules
#   That makes Node's upward resolution find @vt/* via the main repo's
#   node_modules/@vt, whose entries are relative symlinks like
#   ../../packages/systems/agent-runtime. Those relative paths resolve from
#   the MAIN repo's node_modules, so they point at the main repo's packages/
#   -- silently using source from whatever branch the main repo is checked out
#   on, not the worktree's branch. electron-vite then treeshakes "missing"
#   exports without a warning, leading to runtime "is not a function" errors
#   with no compile-time signal.
#
#   Minimum correct fix: keep the big webapp/node_modules symlink (external
#   deps are read-only in the common case, so sharing is fine), but also
#   create a worktree-local <worktree>/node_modules/@vt populated by `cp -a`
#   of the main repo's @vt directory. cp -a preserves symlinks AS symlinks;
#   the relative ../../packages/... target now resolves from the worktree's
#   own node_modules, pointing at the worktree's own packages/. Total cost:
#   ~50 KB of symlinks per worktree.
#
# Mutation caveat (read this before adding deps in a worktree):
#
#   Because webapp/node_modules is a symlink to main's, any operation that
#   writes into it mutates main's tree:
#     - npm install <new-dep> in this worktree -> main's node_modules + lock
#       diverge from main's package.json
#     - native module rebuild (Electron ABI) -> main's binaries get rebuilt
#       against this worktree's Electron version; sibling worktrees on a
#       different Electron crash at runtime
#     - npm prune / dedupe -> affects main too
#
#   If you need to add deps or change Electron version safely:
#     rm <worktree>/webapp/node_modules <worktree>/node_modules/@vt
#     (cd <worktree> && npm install --prefer-offline)
#   That materializes a fully private tree at the cost of a real install.
#
# Usage: on-worktree-created-async.sh <worktreePath> <worktreeName>

set -e

WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

WORKTREE_REALPATH="$(cd "$WORKTREE_PATH" && pwd -P)"
MAIN_REPO="$(cd "$WORKTREE_PATH" && git worktree list --porcelain | head -1 | sed 's/^worktree //')"
MAIN_REPO_REALPATH="$(cd "$MAIN_REPO" && pwd -P)"

# --- Share webapp/node_modules from main (external deps; mutation caveat above) ---
MAIN_WEBAPP_NODE_MODULES="$MAIN_REPO_REALPATH/webapp/node_modules"
MAIN_AT_VT="$MAIN_REPO_REALPATH/node_modules/@vt"
WORKTREE_WEBAPP_NODE_MODULES="$WORKTREE_PATH/webapp/node_modules"
WORKTREE_AT_VT="$WORKTREE_PATH/node_modules/@vt"
PRIVATE_INSTALL_ATTEMPTED=0

install_private_dependencies() {
    if [ "$PRIVATE_INSTALL_ATTEMPTED" -eq 1 ]; then
        return 0
    fi
    PRIVATE_INSTALL_ATTEMPTED=1
    if [ ! -f "$WORKTREE_PATH/package.json" ]; then
        echo "WARNING: $WORKTREE_PATH/package.json not found; cannot install private dependencies" >&2
        return 0
    fi
    echo "Shared node_modules unavailable; installing private dependencies in $WORKTREE_PATH ..."
    (cd "$WORKTREE_PATH" && npm install --prefer-offline 2>&1) || {
        echo "WARNING: npm install failed; worktree dependencies may be incomplete" >&2
    }
}

if [ -f "$WORKTREE_PATH/webapp/package.json" ] && [ ! -e "$WORKTREE_PATH/webapp/node_modules" ]; then
    if [ -d "$MAIN_WEBAPP_NODE_MODULES" ] && [ -d "$MAIN_AT_VT" ]; then
        echo "Symlinking webapp/node_modules -> $MAIN_WEBAPP_NODE_MODULES ..."
        ln -s "$MAIN_WEBAPP_NODE_MODULES" "$WORKTREE_WEBAPP_NODE_MODULES"
    else
        install_private_dependencies
    fi
fi

# --- Materialize @vt/* at the worktree root so cross-package resolution
#     stays inside the worktree. cp -a preserves the symlinks AS symlinks. ---
if [ -d "$MAIN_AT_VT" ] && [ ! -e "$WORKTREE_AT_VT" ]; then
    echo "Materializing @vt/* symlinks at $WORKTREE_AT_VT ..."
    mkdir -p "$WORKTREE_PATH/node_modules"
    cp -a "$MAIN_AT_VT" "$WORKTREE_AT_VT"
elif [ ! -e "$WORKTREE_AT_VT" ] && [ -L "$WORKTREE_WEBAPP_NODE_MODULES" ]; then
    echo "WARNING: $WORKTREE_AT_VT is missing while webapp/node_modules is shared; @vt/* resolution not verified" >&2
elif [ ! -e "$WORKTREE_AT_VT" ]; then
    install_private_dependencies
fi

# --- Verifier: every @vt/* symlink must resolve INSIDE the worktree. Catches
#     the original bug at create-time rather than as a silent build failure. ---
verify_at_vt_resolution() {
    if [ ! -d "$WORKTREE_AT_VT" ]; then
        echo "WARNING: $WORKTREE_AT_VT does not exist; @vt/* resolution not verified" >&2
        return 0
    fi
    failed=0
    for link in "$WORKTREE_AT_VT"/*; do
        [ -L "$link" ] || continue
        resolved="$(cd "$(dirname "$link")" 2>/dev/null && cd "$(readlink "$link")" 2>/dev/null && pwd -P)" || {
            echo "ERROR: $link is a broken symlink" >&2
            failed=1
            continue
        }
        case "$resolved" in
            "$WORKTREE_REALPATH"/*) ;;
            *)
                echo "ERROR: $link resolves to $resolved (expected inside $WORKTREE_REALPATH)" >&2
                failed=1
                ;;
        esac
    done
    if [ "$failed" -ne 0 ]; then
        echo "ERROR: @vt/* package symlinks escape the worktree. Worktree builds will silently use stale main-repo packages." >&2
        exit 1
    fi
}
verify_at_vt_resolution

# --- Symlink .env from main repo so run-remote.mjs and other tools see
#     VT_REMOTE_HOST etc. without per-shell exports. Target is RELATIVE: an
#     absolute target (/Users/.../.env) fails mutagen's portable symlink mode
#     with "invalid symbolic link: target is absolute" and blocks the scan. ---
MAIN_ENV="$MAIN_REPO_REALPATH/.env"
if [ -f "$MAIN_ENV" ] && [ ! -e "$WORKTREE_PATH/.env" ]; then
    suffix="${WORKTREE_REALPATH#$MAIN_REPO_REALPATH/}"
    if [ "$suffix" = "$WORKTREE_REALPATH" ]; then
        echo "ERROR: $WORKTREE_REALPATH is not under $MAIN_REPO_REALPATH; cannot compute relative .env target" >&2
        exit 1
    fi
    rel_prefix=""
    rest="$suffix"
    while [ -n "$rest" ]; do
        rel_prefix="../$rel_prefix"
        case "$rest" in
            */*) rest="${rest#*/}" ;;
            *)   rest="" ;;
        esac
    done
    REL_ENV="${rel_prefix}.env"
    echo "Symlinking .env -> $REL_ENV ..."
    ln -s "$REL_ENV" "$WORKTREE_PATH/.env"
fi

echo "Async setup complete for worktree $WORKTREE_NAME"

# Devbox-side mirroring is handled by mutagen (vt-remote bidirectional sync of
# .git/ with narrow per-host excludes) plus git-gate's `worktree add` post-action
# that normalizes admin gitdir to relative paths. No bespoke script needed.
