#!/usr/bin/env bash
# _common.sh — shared helpers for the machine-LOCAL dev-flow commands
# (vt-land / vt-sync / vt-pr / vt-worktree). Sourced, never executed.
#
# These commands are deliberately NOT `vt` subverbs: on the VM `vt` is a
# forwarder that ssh's every call to the Mac, so a `vt land` would run on the
# wrong machine. They are hyphen-named local scripts that act on the LOCAL
# base/worktree, and nudge the OTHER machine's cache by absolute path over ssh
# (never the `vt` name). See scripts/dev-setup/distributed-architecture.md.

vt_uname="$(uname -s)"

# Base repo path on each machine (where vt-sync-base.sh lives). Overridable.
VT_MAC_REPO="${VT_MAC_REPO:-/Users/bobbobby/repos/vtrepo}"
VT_VM_REPO="${VT_VM_REPO:-/root/vtrepo}"
VT_SYNC_BASE_REL="scripts/dev-setup/remote/vt-sync-base.sh"

# Repo path for THIS machine.
self_repo() {
  if [ "$vt_uname" = "Darwin" ]; then printf '%s' "$VT_MAC_REPO"; else printf '%s' "$VT_VM_REPO"; fi
}

# Resolve VT_REMOTE_HOST (Mac→VM ssh target) from env, then ~/.env, then repo .env.
resolve_remote_host() {
  if [ -n "${VT_REMOTE_HOST:-}" ]; then printf '%s' "$VT_REMOTE_HOST"; return 0; fi
  local f v top
  top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  for f in "$HOME/.env" "${top:+$top/.env}"; do
    [ -n "$f" ] && [ -f "$f" ] || continue
    v="$(awk -F= '/^VT_REMOTE_HOST=/{sub(/^VT_REMOTE_HOST=/,""); print; exit}' "$f")"
    v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
    [ -n "$v" ] && { printf '%s' "$v"; return 0; }
  done
  return 1
}

# Fast-forward THIS machine's base now (one tick of the daemon).
nudge_local() {
  local s; s="$(self_repo)/$VT_SYNC_BASE_REL"
  if [ -x "$s" ]; then "$s" || true; else echo "vt: local sync script not found at $s" >&2; fi
}

# Nudge the OTHER machine's base by ABSOLUTE PATH over ssh (D2) — reuse the `mac`
# alias / multiplexing already shipped to the devbox; never `ssh host 'vt ...'`.
nudge_other() {
  if [ "$vt_uname" = "Darwin" ]; then
    local host
    host="$(resolve_remote_host)" || { echo "vt: VT_REMOTE_HOST not set — skipping VM cache nudge (its timer will catch up)" >&2; return 0; }
    ssh -o BatchMode=yes -o ConnectTimeout=8 "$host" "$VT_VM_REPO/$VT_SYNC_BASE_REL" \
      || echo "vt: warning: could not nudge VM cache at $host (its timer will catch up)" >&2
  else
    ssh -o BatchMode=yes -o ConnectTimeout=8 mac "$VT_MAC_REPO/$VT_SYNC_BASE_REL" \
      || echo "vt: warning: could not nudge Mac cache via 'ssh mac' (its timer will catch up)" >&2
  fi
}

nudge_both() { nudge_local; nudge_other; }

# Refuse dev-flow mutations in the read-only base; require a linked worktree.
require_worktree() {
  local gd cd
  gd="$(git rev-parse --git-dir 2>/dev/null)" || { echo "vt: not inside a git repository" >&2; exit 1; }
  cd="$(git rev-parse --git-common-dir 2>/dev/null)"
  if [ "$gd" = "$cd" ]; then
    echo "vt: this checkout is the read-only base — run from a worktree (vt-worktree <name>)" >&2
    exit 1
  fi
}

# Integration branch to land/PR onto: explicit --onto, else the worktree's
# upstream (origin/X → X), else $VT_BASE_BRANCH (default dev-manu).
default_onto() {
  local up
  up="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  case "$up" in
    origin/*) printf '%s' "${up#origin/}"; return 0 ;;
  esac
  printf '%s' "${VT_BASE_BRANCH:-dev-manu}"
}
