#!/bin/bash
# git-gate: PATH-shim that prompts for a password before destructive git
# subcommands, then forwards to the real git for everything else.
#
# Install with ./install.sh (sibling script). Configure your password via
# one of (precedence high → low):
#   1) export GIT_GATE_PASS="..."   in your shell init
#   2) security add-generic-password -s git-gate -a "$USER" -w 'yourpass'   (macOS only)
#   3) the hardcoded default below — please change.

REAL_GIT=""
for cand in /opt/homebrew/bin/git /usr/local/bin/git /usr/bin/git /opt/local/bin/git; do
  if [ -x "$cand" ] && [ "$cand" != "${BASH_SOURCE[0]}" ]; then
    REAL_GIT="$cand"; break
  fi
done
[ -n "$REAL_GIT" ] || { echo "git-gate: cannot find real git" >&2; exit 127; }

sub="${1:-}"
rest="${*:2}"
reason=""

case "$sub" in
  reset)
    [[ "$rest" =~ (^|[[:space:]])--hard([[:space:]]|$) ]] && reason="reset --hard destroys uncommitted changes"
    ;;
  stash)
    [[ -z "$rest" || "$rest" =~ ^(push|save|-) ]] && reason="stash hides your working-tree changes"
    ;;
  checkout|switch)
    # branch switch: no '--' file separator => not a file restore
    [[ ! " $rest " =~ [[:space:]]--[[:space:]] ]] && reason="$sub changes branch / overwrites working tree"
    ;;
  restore)
    reason="restore overwrites working-tree files"
    ;;
  clean)
    [[ "$rest" =~ -[a-zA-Z]*f ]] && reason="clean -f deletes untracked files"
    ;;
  rebase)
    reason="rebase rewrites history"
    ;;
  branch)
    [[ "$rest" =~ -[a-zA-Z]*D ]] && reason="branch -D force-deletes a branch"
    ;;
  push)
    [[ "$rest" =~ (^|[[:space:]])(--force|--force-with-lease|-f)([[:space:]]|$) ]] && reason="force-push overwrites remote history"
    ;;
  # worktree is intentionally NOT gated — add/remove/list/prune all allowed
esac

if [ -n "$reason" ]; then
  {
    echo ""
    echo "  ╔══════════════════════════════════════════════════════════════════╗"
    echo "  ║  git-gate: BLOCKED                                               ║"
    echo "  ╚══════════════════════════════════════════════════════════════════╝"
    echo "    command: git $*"
    echo "    reason:  $reason"
    echo ""
    echo "    Think before you run destructive git commands."
    echo "    Other agents may be working in this repo right now."
    echo "    Prefer multiple commits to get where you want — not destructive"
    echo "    rewrites that stomp on parallel work."
    echo ""
  } >&2

  expected="${GIT_GATE_PASS:-$(security find-generic-password -s git-gate -a "$USER" -w 2>/dev/null)}"
  expected="${expected:-changeme}"

  if ! read -rsp "    password: " pass < /dev/tty 2>/dev/null; then
    echo "    no tty — aborted." >&2
    exit 1
  fi
  echo "" >&2

  if [ "$pass" != "$expected" ]; then
    echo "    wrong password — aborted." >&2
    exit 1
  fi
fi

exec "$REAL_GIT" "$@"
