#!/usr/bin/env bash
#
# worktree-admission-check.sh — read-only admission gate for `git worktree add`.
#
# Exits non-zero (with actionable messages) when EITHER condition holds:
#
#   (1) MERGED-NOT-CLEANED: a worktree under the sibling vt-wts/ dir is on a
#       branch whose PR is already MERGED. That work has landed upstream — the
#       worktree is dead weight and should be removed before creating more.
#
#   (2) TOO-MANY-IDLE: more than $VT_MAX_IDLE_WORKTREES worktrees are "idle".
#       idle  ≝  no commit in > $VT_IDLE_DAYS day(s)  AND  clean working tree
#               AND  no open PR  AND  not a merged-PR branch (that's cond. 1).
#       We key staleness off the last *commit* time, not filesystem mtime:
#       mtime bumps on builds / installs / index writes and would both miss
#       truly-abandoned trees and flag valuable-but-paused ones.
#
# This script NEVER deletes anything — detection only. It is safe to run any
# time. Once trusted, call it as a PRE-action in git-gate's `worktree add` path.
#
# Knobs (env):
#   VT_MAX_IDLE_WORKTREES   max idle worktrees allowed         (default 1)
#   VT_IDLE_DAYS            idle threshold in days             (default 1)
#   VT_WT_SIBLING_DIR_NAME  sibling worktree dir name          (default vt-wts)
#
# Exit codes: 0 = OK, 1 = policy violation, 2 = setup error.

set -uo pipefail

MAX_IDLE="${VT_MAX_IDLE_WORKTREES:-1}"
IDLE_DAYS="${VT_IDLE_DAYS:-1}"
SIBLING="${VT_WT_SIBLING_DIR_NAME:-vt-wts}"

NOW="$(date +%s)"
IDLE_SECS=$(( IDLE_DAYS * 86400 ))

git rev-parse --git-dir >/dev/null 2>&1 || { echo "worktree-admission-check: not inside a git repo" >&2; exit 2; }

# Membership test: is line "$1" present (exact) in newline-list "$2"?
in_list() { printf '%s\n' "$2" | grep -qxF -- "$1"; }

# --- enumerate sibling worktrees as "path<TAB>branch" (skips main checkout + detached) ---
wt_tsv="$(git worktree list --porcelain | awk -v s="/$SIBLING/" '
  $1=="worktree"{p=$2; b=""}
  $1=="branch"{b=$2; sub(/refs\/heads\//,"",b)}
  $0==""{ if(p!="" && b!="" && index(p,s)) print p"\t"b; p="";b="" }
  END{ if(p!="" && b!="" && index(p,s)) print p"\t"b }
')"

# --- one-shot PR state from GitHub (merged + open head branches) ---
GH_OK=1
MERGED_BRANCHES=""
OPEN_BRANCHES=""
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  MERGED_BRANCHES="$(gh pr list --state merged --limit 300 --json headRefName -q '.[].headRefName' 2>/dev/null)"
  OPEN_BRANCHES="$(gh pr list --state open --limit 300 --json headRefName -q '.[].headRefName' 2>/dev/null)"
else
  GH_OK=0
fi

merged_hits=""
idle_list=""
idle_count=0

while IFS=$'\t' read -r wt_path branch; do
  [ -z "${branch:-}" ] && continue

  # (1) merged-not-cleaned — takes precedence; such trees are excluded from idle.
  if [ "$GH_OK" = 1 ] && in_list "$branch" "$MERGED_BRANCHES"; then
    dirty=""
    [ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ] && dirty="  (dirty — review before removing)"
    merged_hits="${merged_hits}    - ${branch}  [${wt_path}]${dirty}\n"
    continue
  fi

  # (2) idle accounting — needs a last-commit timestamp.
  last_commit="$(git -C "$wt_path" log -1 --format=%ct 2>/dev/null)"
  [ -z "$last_commit" ] && continue
  age=$(( NOW - last_commit ))

  is_clean=1
  [ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ] && is_clean=0

  has_open_pr=0
  { [ "$GH_OK" = 1 ] && in_list "$branch" "$OPEN_BRANCHES"; } && has_open_pr=1

  if [ "$age" -gt "$IDLE_SECS" ] && [ "$is_clean" = 1 ] && [ "$has_open_pr" = 0 ]; then
    days=$(( age / 86400 ))
    idle_list="${idle_list}    - ${branch}  [${wt_path}]  (no commit in ${days}d)\n"
    idle_count=$(( idle_count + 1 ))
  fi
done <<EOF
$wt_tsv
EOF

err=0

if [ -n "$merged_hits" ]; then
  echo "✗ worktree-admission-check: merged worktree(s) await cleanup (PR already merged):" >&2
  printf '%b' "$merged_hits" >&2
  echo "  → remove each before creating more:  git worktree remove <path> && git branch -d <branch>" >&2
  err=1
fi

if [ "$idle_count" -gt "$MAX_IDLE" ]; then
  echo "✗ worktree-admission-check: too many idle worktrees (${idle_count} > max ${MAX_IDLE})." >&2
  echo "  idle = no commit in >${IDLE_DAYS}d, clean tree, no open PR:" >&2
  printf '%b' "$idle_list" >&2
  echo "  → resolve down to ${MAX_IDLE}: commit & open a PR, merge, or remove one." >&2
  err=1
fi

if [ "$GH_OK" = 0 ]; then
  echo "⚠ worktree-admission-check: gh unavailable/unauthed — merged & open-PR checks skipped." >&2
fi

if [ "$err" = 0 ]; then
  echo "✓ worktree-admission-check: OK (no merged worktrees pending cleanup; idle ≤ ${MAX_IDLE})."
fi

exit "$err"
