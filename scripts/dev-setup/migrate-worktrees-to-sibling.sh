#!/usr/bin/env bash
# One-shot migration: move all linked git worktrees from
#   <repo>/.worktrees/<name>/
# to the sibling layout
#   <parent>/vt-wts/<name>/
#
# Run this AFTER:
#   1. The codebase has been updated (this branch).
#   2. `vt-remote.sh vt-wts-create` has spun up the second mutagen session.
#
# What it does:
#   * Refuses to run if there are uncommitted changes in any worktree
#     (mv across rename would orphan unstaged work).
#   * Moves each `.worktrees/<name>/` directory to `../vt-wts/<name>/`.
#   * Replaces the `.env` symlink with one targeting the new relative depth
#     (it's a symlink to ../../.env today; needs to become
#     ../../voicetree-public/.env in the new layout).
#   * Runs `git worktree repair --relative-paths` so all git pointers
#     (`.git` files + admin `gitdir`/`commondir`) line up with the new paths.
#   * Removes `.worktrees/` if it ends up empty.
#
# WARNING: this WILL disrupt any agent currently working inside a worktree.
# Their cwd will be invalidated. Coordinate with peers before running.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PARENT_DIR="$(cd "$REPO_ROOT/.." && pwd)"
OLD_WTS="$REPO_ROOT/.worktrees"
NEW_WTS="$PARENT_DIR/vt-wts"

if [ ! -d "$OLD_WTS" ]; then
  echo "migrate: $OLD_WTS does not exist — nothing to do." >&2
  exit 0
fi

# Pre-flight: check for unstaged or untracked work in any worktree.
# `git status --porcelain` is empty iff the tree is clean.
echo "migrate: scanning for uncommitted work in $OLD_WTS"
for wt in "$OLD_WTS"/*/; do
  [ -d "$wt" ] || continue
  wt="${wt%/}"
  name="$(basename "$wt")"
  status="$(git -C "$wt" status --porcelain 2>/dev/null || true)"
  if [ -n "$status" ]; then
    echo "migrate: REFUSING — $name has uncommitted changes:" >&2
    echo "$status" | head -10 | sed 's/^/  /' >&2
    echo "migrate: commit / stash inside that worktree, then re-run." >&2
    exit 1
  fi
done

mkdir -p "$NEW_WTS"

# Move each worktree dir.
for wt in "$OLD_WTS"/*/; do
  [ -d "$wt" ] || continue
  wt="${wt%/}"
  name="$(basename "$wt")"
  dest="$NEW_WTS/$name"
  if [ -e "$dest" ]; then
    echo "migrate: skipping $name — $dest already exists" >&2
    continue
  fi
  echo "migrate: moving $wt -> $dest"
  mv "$wt" "$dest"

  # Repair .env symlink: old target was ../../.env (depth 2 below repo);
  # new layout needs ../../voicetree-public/.env (cross the sibling).
  env_link="$dest/.env"
  if [ -L "$env_link" ]; then
    rm "$env_link"
  fi
  if [ -f "$REPO_ROOT/.env" ]; then
    ln -s "../../voicetree-public/.env" "$env_link"
    echo "migrate:   refreshed .env symlink for $name"
  fi
done

# Fix git's per-worktree pointers (both the `.git` files inside each worktree
# and the admin `gitdir` files under <repo>/.git/worktrees/<name>/).
echo "migrate: running 'git worktree repair --relative-paths' from $REPO_ROOT"
git -C "$REPO_ROOT" worktree repair --relative-paths

# Clean up the now-empty old container.
if [ -d "$OLD_WTS" ] && [ -z "$(ls -A "$OLD_WTS" 2>/dev/null)" ]; then
  rmdir "$OLD_WTS"
  echo "migrate: removed empty $OLD_WTS"
fi

echo "migrate: done. Verify with: git -C $REPO_ROOT worktree list"
