#!/usr/bin/env bash
# vt-sync-base.sh — read-only base self-heal daemon (ONE tick per invocation).
#
# The single-source dev model (see scripts/dev-setup/distributed-architecture.md):
# origin is the only writable copy of any branch; each machine's base checkout is
# a read-only fast-forward cache of origin. This script is the mechanism that
# keeps the base pinned to origin. It is invoked two ways, both running ONE tick:
#   - by a 2-3 min timer (systemd on Linux / launchd on macOS) — the backstop for
#     PR merges done on GitHub, where no local actor can nudge;
#   - on demand by vt-sync / vt-land (the hot path), locally and over ssh from the
#     other machine (by ABSOLUTE PATH — never via the `vt` forwarder name).
#
# Behaviour (D1/D6/D7):
#   git fetch origin --prune                     (keeps ALL origin/* refs fresh)
#   then advance the pinned local base branch (default dev-manu) by
#   git merge --ff-only origin/$VT_BASE_BRANCH   (never reset; never destroy data)
# On a dirty / diverged / ff-collision base it raises an ALERT — a red VoiceTree
# node (best-effort) AND an OS notification — and retries idempotently next tick.
# Transient fetch / ref-lock failures (shared object store with worktrees) are
# tolerated: the tick exits 0 and the next tick retries; it never wedges.
#
# Runs its own git with VT_SYNC=1 so git-gate's read-only base guard lets it
# fast-forward (the daemon is the ONE writer of the base ref).
#
# Config (env, all optional):
#   VT_BASE_DIR          base checkout to keep pinned   (default: this repo root)
#   VT_BASE_BRANCH       pinned branch                  (default: dev-manu)
#   VT_SYNC_STATE_DIR    alert markers + log            (default: ~/.cache/vt-sync-base)
#   VT_ALERT_PARENT_NODE VoiceTree node id to attach alert nodes under (optional)

# NOT `set -e`: a transient fetch failure must end the tick cleanly, not crash it.
set -uo pipefail

# Our own git must bypass git-gate's read-only base guard (D3): we are the daemon.
export VT_SYNC=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${VT_BASE_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
BRANCH="${VT_BASE_BRANCH:-dev-manu}"
STATE_DIR="${VT_SYNC_STATE_DIR:-$HOME/.cache/vt-sync-base}"
LOG="$STATE_DIR/vt-sync-base.log"

# Robust PATH for non-login ssh invocations: a bare `ssh host '<path>'` command
# gets a minimal PATH, but git lives in /opt/homebrew/bin (macOS) or /usr/bin.
case ":$PATH:" in
  *:/opt/homebrew/bin:*) ;;
  *) PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" ;;
esac

mkdir -p "$STATE_DIR"

log() {
  printf '%s vt-sync-base[%s]: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$BRANCH" "$*" >> "$LOG"
}

git_base() { git -C "$BASE" "$@"; }

# --- alert delivery (D7) ----------------------------------------------------
# OS notification is the GUARANTEED channel; the graph node is best-effort (the
# daemon has no VoiceTree task context, so a root node needs VT_ALERT_PARENT_NODE
# to attach cleanly — otherwise the create may be refused and we just log it).
notify_os() {
  local title="$1" body="$2"
  if [ "$(uname -s)" = "Darwin" ]; then
    osascript -e "display notification \"$body\" with title \"$title\"" >/dev/null 2>&1 || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send "$title" "$body" >/dev/null 2>&1 || true
  else
    printf '%s: %s\n' "$title" "$body" | wall 2>/dev/null || true
  fi
}

notify_graph() {
  local state="$1" body="$2"
  command -v vt >/dev/null 2>&1 || return 0
  local payload
  payload="$(VT_ALERT_PARENT_NODE="${VT_ALERT_PARENT_NODE:-}" python3 - "$state" "$body" "$BASE" "$BRANCH" <<'PY' 2>/dev/null
import json, os, sys
state, body, base, branch = sys.argv[1:5]
node = {
    "filename": "vt-sync-base-alert-%s" % state,
    "title": "⚠ vt-sync-base: %s" % state,
    "summary": body,
    "color": "red",
    "content": "Base `%s` on branch `%s` raised a **%s** alert:\n\n> %s\n\n"
               "The read-only cache will keep retrying each tick; it will NOT "
               "reset over local data. Resolve, then it self-heals."
               % (base, branch, state, body),
}
payload = {"nodes": [node]}
parent = os.environ.get("VT_ALERT_PARENT_NODE", "")
if parent:
    payload["parentNodeId"] = parent
sys.stdout.write(json.dumps(payload))
PY
)" || return 0
  [ -n "$payload" ] || return 0
  if ! printf '%s' "$payload" | vt graph create >/dev/null 2>&1; then
    log "graph alert best-effort failed (no VT task context? set VT_ALERT_PARENT_NODE) — OS notification still delivered"
  fi
}

# Fire an alert at most once per distinct state (no per-tick spam). Markers clear
# when the base returns to a healthy state, so a recurrence re-alerts.
alert() {
  local state="$1" body="$2"
  log "ALERT[$state]: $body"
  local marker="$STATE_DIR/alert-$state"
  [ -f "$marker" ] && return 0
  : > "$marker"
  notify_os "vt-sync-base: $state" "$body"
  notify_graph "$state" "$body"
}

clear_alerts() { rm -f "$STATE_DIR"/alert-* 2>/dev/null || true; }

# --- the tick ---------------------------------------------------------------
[ -d "$BASE/.git" ] || { log "no git repo at $BASE; nothing to do"; exit 0; }

if ! git_base fetch origin --prune >>"$LOG" 2>&1; then
  log "fetch failed (transient ref-lock / network?) — will retry next tick"
  exit 0
fi

# Never fast-forward over uncommitted work — alert and stop (D7).
if ! git_base diff --quiet || ! git_base diff --cached --quiet; then
  alert dirty "base '$BASE' has uncommitted changes — move work to a worktree; the cache cannot fast-forward while dirty"
  exit 0
fi

if ! git_base show-ref --verify --quiet "refs/heads/$BRANCH"; then
  alert no-branch "base '$BASE' has no local '$BRANCH' branch — run the base configuration (setup-*-env.sh --configure-base)"
  exit 0
fi

# Keep HEAD pinned to the base branch (D1). Tree is clean (checked above), so a
# re-pin is safe if a stray checkout left HEAD elsewhere.
cur="$(git_base symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [ "$cur" != "$BRANCH" ]; then
  if ! git_base checkout "$BRANCH" >>"$LOG" 2>&1; then
    alert head "base '$BASE' HEAD is '$cur'; could not return it to '$BRANCH'"
    exit 0
  fi
fi

if ! git_base show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  log "origin/$BRANCH not present after fetch — nothing to do this tick"
  exit 0
fi

local_sha="$(git_base rev-parse "$BRANCH")"
remote_sha="$(git_base rev-parse "origin/$BRANCH")"

if [ "$local_sha" = "$remote_sha" ]; then
  clear_alerts
  exit 0
fi

if git_base merge-base --is-ancestor "$local_sha" "$remote_sha"; then
  if git_base merge --ff-only "origin/$BRANCH" >>"$LOG" 2>&1; then
    log "fast-forwarded $BRANCH ${local_sha:0:9}..${remote_sha:0:9}"
    clear_alerts
    exit 0
  fi
  # ff blocked while clean → almost always an untracked path origin now adds (G5).
  alert collision "base '$BASE' could not fast-forward '$BRANCH' to origin/$BRANCH (an untracked file would be overwritten?) — resolve manually"
  exit 0
fi

# local is not an ancestor of origin → diverged (should be impossible with the
# guard, but we never reset over local commits).
alert diverged "base '$BASE' branch '$BRANCH' has DIVERGED from origin/$BRANCH — manual review; the cache will not be reset over local commits"
exit 0
