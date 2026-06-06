#!/usr/bin/env bash
# vt-brain-autosync.sh — bidirectional auto-sync for the brain notes repo (ONE tick).
#
# Unlike vt-sync-base.sh (a read-only fast-forward CACHE for the code repos), the
# brain notes repo is a co-equal WRITER on every machine, exactly like the Obsidian
# Git plugin on the Mac: each tick stages local edits, commits them, merges
# origin, and pushes. origin/<branch> is the shared truth; the Mac (Obsidian Git)
# and this VM both push to it. Non-overlapping note edits auto-merge; a genuine
# content conflict is left for a human — the merge is aborted, an alert is raised,
# and the tick retries next time. Nothing is ever reset or lost.
#
# Why brain breaks the single-source model (see distributed-architecture.md): a
# notes repo is edited in-tree (no worktrees), on two machines at once, so it
# needs a real commit+merge+push loop — a fast-forward-only cache wedges the
# moment either side commits locally (it diverges and can no longer ff).
#
# Invoked one tick per run, the same two ways as vt-sync-base.sh:
#   - by a short systemd timer (the steady-state loop), and
#   - on demand (e.g. before a manual read) — both run exactly one tick.
#
# Runs git with VT_SYNC=1 so git-gate's read-only base guard admits the writer:
# this daemon is the ONE sanctioned writer of the brain base.
#
# Config (env, all optional):
#   VT_BASE_DIR          brain checkout         (default: /root/brain-real)
#   VT_BASE_BRANCH       branch                 (default: master)
#   VT_SYNC_STATE_DIR    alert markers + log    (default: ~/.cache/vt-brain-autosync)
#   VT_ALERT_PARENT_NODE VoiceTree node id to attach alert nodes under (optional)

# NOT `set -e`: a transient fetch/push failure must end the tick cleanly so the
# next tick retries; it must never wedge the loop.
set -uo pipefail

# Our git must bypass git-gate's read-only base guard: we are the daemon writer.
export VT_SYNC=1

BASE="${VT_BASE_DIR:-/root/brain-real}"
BRANCH="${VT_BASE_BRANCH:-master}"

# systemd runs services with a minimal env that has NO $HOME; with `set -u` that
# would abort every tick. Default it from the passwd db, then fall back to /root.
HOME="${HOME:-$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)}"
HOME="${HOME:-/root}"
export HOME
STATE_DIR="${VT_SYNC_STATE_DIR:-$HOME/.cache/vt-brain-autosync}"
LOG="$STATE_DIR/vt-brain-autosync.log"

# Robust PATH for non-login systemd/ssh invocations (git + gh credential helper
# live in /usr/local/bin or /usr/bin; gh provides the https push credential).
case ":$PATH:" in
  *:/usr/local/bin:*) ;;
  *) PATH="/usr/local/bin:/usr/bin:/bin:$PATH" ;;
esac
export PATH

mkdir -p "$STATE_DIR"

log() { printf '%s vt-brain-autosync[%s]: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$BRANCH" "$*" >> "$LOG"; }
g()   { git -C "$BASE" "$@"; }

# --- alert delivery: durable record is always the $LOG line; OS + graph are
# best-effort, fired at most once per distinct state (markers clear on recovery).
notify_os() {
  if [ "$(uname -s)" = "Darwin" ]; then
    osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1 || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send "$1" "$2" >/dev/null 2>&1 || true
  fi
}
notify_graph() {
  command -v vt >/dev/null 2>&1 || return 0
  python3 - "$1" "$2" "$BASE" "$BRANCH" "${VT_ALERT_PARENT_NODE:-}" <<'PY' 2>/dev/null | vt graph create >/dev/null 2>&1 || true
import json, sys
state, body, base, branch, parent = sys.argv[1:6]
node = {
    "filename": "vt-brain-autosync-alert-%s" % state,
    "title": "⚠ vt-brain-autosync: %s" % state,
    "summary": body,
    "color": "red",
    "content": "Brain `%s` on `%s` raised a **%s** alert:\n\n> %s\n\n"
               "The loop keeps retrying each tick and never resets over local "
               "commits. Resolve, then it self-heals." % (base, branch, state, body),
}
payload = {"nodes": [node]}
if parent:
    payload["parentNodeId"] = parent
sys.stdout.write(json.dumps(payload))
PY
}
alert() {
  local state="$1" body="$2"
  log "ALERT[$state]: $body"
  local marker="$STATE_DIR/alert-$state"
  [ -f "$marker" ] && return 0
  : > "$marker"
  notify_os "vt-brain-autosync: $state" "$body"
  notify_graph "$state" "$body"
}
clear_alerts() { rm -f "$STATE_DIR"/alert-* 2>/dev/null || true; }

# --- the tick ---------------------------------------------------------------
[ -d "$BASE/.git" ] || { log "no git repo at $BASE; nothing to do"; exit 0; }

# Keep HEAD pinned to the brain branch.
cur="$(g symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [ "$cur" != "$BRANCH" ]; then
  g checkout "$BRANCH" >>"$LOG" 2>&1 || { alert head "brain '$BASE' HEAD is '$cur'; could not return it to '$BRANCH'"; exit 0; }
fi

# 1. Commit local edits (the "backup" the Mac's Obsidian Git also makes).
g add -A >>"$LOG" 2>&1 || true
if ! g diff --cached --quiet 2>/dev/null; then
  if g commit -q -m "remote brain backup: $(date '+%Y-%m-%d %H:%M:%S')" >>"$LOG" 2>&1; then
    log "committed local brain edits"
  fi
fi

# 2. Fetch origin (transient failure: end the tick cleanly, retry next time).
if ! g fetch origin "$BRANCH" >>"$LOG" 2>&1; then
  log "fetch from origin failed (transient ref-lock / network?) — retry next tick"
  exit 0
fi

if ! g show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  log "origin/$BRANCH not present after fetch — nothing to do this tick"
  exit 0
fi

local_sha="$(g rev-parse "$BRANCH")"
remote_sha="$(g rev-parse "origin/$BRANCH")"

# 3. Integrate origin when it has commits we lack (behind or diverged). A
#    fast-forward or a clean auto-merge just works; a real content conflict is
#    aborted (working tree restored), alerted, and retried — never force-resolved.
if [ "$local_sha" != "$remote_sha" ] && ! g merge-base --is-ancestor "origin/$BRANCH" "$BRANCH"; then
  if ! g merge --no-edit "origin/$BRANCH" >>"$LOG" 2>&1; then
    g merge --abort >>"$LOG" 2>&1 || true
    alert conflict "brain '$BASE' has a real merge conflict with origin/$BRANCH — resolve by hand; your local commit is intact and the loop retries each tick"
    exit 0
  fi
fi

# 4. Push when we are ahead of origin (local commit and/or merge commit).
if [ -n "$(g log --oneline "origin/$BRANCH..$BRANCH" 2>/dev/null)" ]; then
  if GIT_TERMINAL_PROMPT=0 g push origin "$BRANCH" >>"$LOG" 2>&1; then
    log "pushed $BRANCH ${local_sha:0:9}.. to origin"
  else
    # Lost a push race with the other writer, or a transient network error: the
    # next tick re-fetches, re-merges, and re-pushes. Not an alert condition.
    log "push rejected/failed (raced with the other writer?) — retry next tick"
    exit 0
  fi
fi

clear_alerts
exit 0
