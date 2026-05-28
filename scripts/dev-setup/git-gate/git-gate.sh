#!/bin/bash
# git-gate: PATH-shim that prompts for a password before destructive git
# subcommands, then forwards to the real git for everything else.
#
# Install with ./install.sh (sibling script). Configure your password via
# one of (precedence high → low):
#   1) export GIT_GATE_PASS="..."   in your shell init
#   2) security add-generic-password -s git-gate -a "$USER" -w 'yourpass'   (macOS only)
#   3) the hardcoded default below — please change.
#
# Non-interactive / agent contexts (no TTY) cannot read /dev/tty, so the gate
# accepts the password via the GIT_GATE_PASS_ATTEMPT env var instead:
#
#   GIT_GATE_PASS_ATTEMPT='<password>' git <destructive subcommand>
#
# When the agent is blocked it MUST surface the block to the user and ask
# for the password — it MUST NOT call git through an alternate binary path
# or manipulate PATH to circumvent this gate.

REAL_GIT=""
for cand in /opt/homebrew/bin/git /usr/local/bin/git /usr/bin/git /opt/local/bin/git; do
  if [ -x "$cand" ] && [ "$cand" != "${BASH_SOURCE[0]}" ]; then
    REAL_GIT="$cand"; break
  fi
done
[ -n "$REAL_GIT" ] || { echo "git-gate: cannot find real git" >&2; exit 127; }

# Preserve the original argv so we can forward it unchanged to real git later.
# Then strip git's global options ahead of the subcommand so that callers like
# `git -C <path> worktree add ...` or `git --git-dir=... worktree add ...` are
# detected and gated correctly. Without this, `$1` is `-C` (not `worktree`),
# every post-action block below is skipped, and bootstrap_added_worktree never
# runs — that defeats the whole pnpm fast-worktree path.
ORIG_ARGS=("$@")

while [ $# -gt 0 ]; do
  case "$1" in
    # Global options that take a separate value
    -C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)
      shift 2 || break ;;
    # Same options in --opt=value form, plus value-less global flags
    --git-dir=*|--work-tree=*|--namespace=*|--exec-path=*|--super-prefix=*)
      shift ;;
    -p|-P|--paginate|--no-pager|--bare|--no-replace-objects|\
    --literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|\
    --no-optional-locks|--html-path|--man-path|--info-path|--version|--help)
      shift ;;
    # Unknown leading flag — assume it's another global option, skip it
    -*)
      shift ;;
    # First positional → the subcommand
    *)
      break ;;
  esac
done

sub="${1:-}"
sub_arg="${2:-}"
rest="${*:2}"
reason=""
suggestion=""

worktree_add_path_arg() {
  local expect_option_value=0
  local after_separator=0
  local arg
  for arg in "${@:3}"; do
    if [ "$after_separator" -eq 1 ]; then
      printf '%s\n' "$arg"
      return 0
    fi
    if [ "$expect_option_value" -eq 1 ]; then
      expect_option_value=0
      continue
    fi
    case "$arg" in
      --)
        after_separator=1
        ;;
      -b|-B|--orphan|--reason)
        expect_option_value=1
        ;;
      -*)
        ;;
      *)
        printf '%s\n' "$arg"
        return 0
        ;;
    esac
  done
}

# Bootstrap a freshly-added worktree.
#
# Steps:
#   1. Symlink .env from the main checkout (secrets the worktree needs).
#   2. Install deps on the DEVBOX, not locally.
#
# Why deps go on the devbox, not the Mac:
#   - mutagen-vt-wts.yml excludes **/node_modules from the Mac→devbox sync,
#     so local node_modules never reaches the remote where tests run.
#   - postinstall rebuilds native modules for darwin/arm64 (Electron ABI),
#     which is wrong on the Linux devbox even if it were synced.
#   - scripts/run-remote.mjs + install-vitest-shim.mjs route `npx vitest`
#     and tier-1 checks to ssh on the devbox; they need node_modules
#     relative to /root/vt-wts/<name>/, not the Mac path.
#
# On a warm pnpm content-addressed store the remote install is sub-second
# (hardlinks only, no network).
bootstrap_added_worktree() {
  local wt_path="$1"
  [ -n "$wt_path" ] || return 0

  local wt_abs
  case "$wt_path" in
    /*) wt_abs="$wt_path" ;;
    *)  wt_abs="$(pwd -P)/$wt_path" ;;
  esac
  wt_abs="$(cd "$wt_abs" 2>/dev/null && pwd -P || printf '%s' "$wt_abs")"
  echo "git-gate: worktree path: $wt_abs" >&2

  # Use -C against the new worktree itself, not the gate's cwd. The gate is on
  # PATH and may be invoked from a cwd that isn't a git repo (e.g. an agent's
  # shell rooted in an unrelated directory) — `git worktree list` without -C
  # then returns empty and the .env lookup below silently fails.
  local main_repo
  main_repo="$("$REAL_GIT" -C "$wt_abs" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')"

  if [ -n "$main_repo" ] && [ -f "$main_repo/.env" ] && [ ! -e "$wt_abs/.env" ]; then
    ln -snf "$main_repo/.env" "$wt_abs/.env"
    echo "git-gate: linked .env from main checkout" >&2
  fi

  if [ ! -f "$wt_abs/pnpm-workspace.yaml" ]; then
    return 0
  fi

  # Resolve devbox host (env var wins, else .env in the main checkout)
  local remote_host="${VT_REMOTE_HOST:-}"
  if [ -z "$remote_host" ] && [ -n "$main_repo" ] && [ -f "$main_repo/.env" ]; then
    remote_host="$(awk -F= '/^VT_REMOTE_HOST=/{sub(/^VT_REMOTE_HOST=/,""); print; exit}' "$main_repo/.env")"
    remote_host="${remote_host%\"}"; remote_host="${remote_host#\"}"
    remote_host="${remote_host%\'}"; remote_host="${remote_host#\'}"
  fi

  if [ -z "$remote_host" ]; then
    echo "git-gate: no VT_REMOTE_HOST found; skipping devbox pnpm install" >&2
    echo "git-gate: run-remote.mjs will retry dependency readiness before tests" >&2
    return 0
  fi

  # Push the new worktree to the devbox before trying to install in it
  if command -v mutagen >/dev/null 2>&1; then
    echo "git-gate: flushing mutagen vt-wts sync so devbox sees the new worktree" >&2
    mutagen sync flush vt-wts >/dev/null 2>&1 \
      || echo "git-gate: warning: mutagen sync flush vt-wts failed; ssh install may race" >&2
  fi

  # Reject anything that isn't a plain worktree name. Defensive against
  # command injection via the path argument.
  local wt_name
  wt_name="$(basename "$wt_abs")"
  if ! [[ "$wt_name" =~ ^[A-Za-z0-9_.-]+$ ]] || [ "$wt_name" = "." ] || [ "$wt_name" = ".." ]; then
    echo "git-gate: worktree name '$wt_name' is not a plain safe name; skipping devbox install" >&2
    return 0
  fi

  echo "git-gate: pnpm install --prefer-offline on devbox at /root/vt-wts/$wt_name" >&2
  if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$remote_host" \
        "cd /root/vt-wts/$wt_name && pnpm install --prefer-offline" >&2; then
    echo "git-gate: warning: devbox pnpm install failed for $wt_name" >&2
    echo "git-gate: run-remote.mjs will retry dependency readiness before tests" >&2
  fi
}

case "$sub" in
  reset)
    [[ "$rest" =~ (^|[[:space:]])--hard([[:space:]]|$) ]] && { reason="reset --hard destroys uncommitted changes"; suggestion="make a new commit that reverts, or use 'git restore --source=<ref> -- <file>' for specific files"; }
    ;;
  stash)
    [[ -z "$rest" || "$rest" =~ ^(push|save|-) ]] && { reason="stash hides your working-tree changes"; suggestion="commit unrelated changes to a scratch branch ('git checkout -b scratch && git commit -am wip && git checkout -'), or copy files aside with cp and 'git checkout -- <file>', then restore after"; }
    ;;
  checkout|switch)
    [[ ! " $rest " =~ [[:space:]]--[[:space:]] ]] && { reason="$sub changes branch / overwrites working tree"; suggestion="commit or copy aside any working-tree changes first, then switch"; }
    ;;
  restore)
    reason="restore overwrites working-tree files"; suggestion="copy the file aside first ('cp <file> /tmp/'), then restore"
    ;;
  clean)
    [[ "$rest" =~ -[a-zA-Z]*f ]] && { reason="clean -f deletes untracked files"; suggestion="move untracked files to /tmp/ instead of deleting"; }
    ;;
  branch)
    [[ "$rest" =~ -[a-zA-Z]*D ]] && { reason="branch -D force-deletes a branch"; suggestion="use 'git branch -d' (safe delete); if it refuses, the branch has unmerged work — merge or tag it first"; }
    ;;
  push)
    [[ "$rest" =~ (^|[[:space:]])(--force|--force-with-lease|-f)([[:space:]]|$) ]] && { reason="force-push overwrites remote history"; suggestion="pull/rebase and push normally; only force-push your own feature branch with explicit user approval"; }
    ;;
  # worktree is intentionally NOT gated — add/remove/list/prune all allowed.
  # See post-action block below for `worktree add` normalization.
esac

# --- Post-action: `git worktree add` → normalize admin pointers to relative ---
# Absolute paths in .git/worktrees/<name>/gitdir are host-specific and break
# cross-host file sync (e.g. mac<->devbox via mutagen). Relative pointers are
# host-portable. `worktree repair --relative-paths` rewrites both sides of
# the pointer pair and is idempotent. Best-effort: failure does not affect
# the underlying add's exit code.
#
# Dependency readiness is prewarmed asynchronously below. The command boundary
# still enforces readiness before remote commands, so a failed prewarm cannot
# make later execution unsafe.
if [ "$sub" = "worktree" ] && [ "$sub_arg" = "add" ]; then
  wt_path="$(worktree_add_path_arg "$@")"
  echo "git-gate: running git worktree add" >&2
  "$REAL_GIT" "${ORIG_ARGS[@]}"
  ec=$?
  if [ $ec -eq 0 ]; then
    echo "git-gate: normalizing worktree git metadata to relative paths" >&2
    if "$REAL_GIT" worktree repair --relative-paths >/dev/null 2>&1; then
      echo "git-gate: worktree git metadata normalized" >&2
    else
      echo "git-gate: warning: git worktree repair --relative-paths failed; command-boundary repair will retry" >&2
    fi
    if [ "${VT_GIT_GATE_SKIP_WORKTREE_PREWARM:-}" = "1" ]; then
      echo "git-gate: skipping dependency prewarm; caller owns worktree hooks" >&2
    else
      bootstrap_added_worktree "$wt_path"
    fi
    echo "git-gate: worktree add post-setup complete" >&2
  else
    echo "git-gate: git worktree add failed with exit code $ec" >&2
  fi
  exit $ec
fi

# --- Post-action: `git worktree remove` → ssh-clean matching dirs on devbox ---
# Mutagen two-way-resolved refuses to delete a beta directory that contains
# "untracked" content — i.e. ignored files like .git/worktrees/<n>/index and
# .worktrees/<n>/{node_modules,dist,test-results,playwright-report-*}.
# The deletion deadlocks until the stale paths on beta are cleared manually.
# We pre-empt by ssh-rm'ing them ourselves so mutagen sees no remote conflict.
if [ "$sub" = "worktree" ] && [ "$sub_arg" = "remove" ]; then
  wt_path=""
  for arg in "${@:3}"; do
    case "$arg" in
      -*) ;;
      *)  wt_path="$arg"; break ;;
    esac
  done

  "$REAL_GIT" "${ORIG_ARGS[@]}"
  ec=$?

  if [ $ec -eq 0 ] && [ -n "$wt_path" ]; then
    echo "git-gate: git worktree remove succeeded for $wt_path" >&2
    wt_name="$(basename "$wt_path")"
    # Reject anything that isn't a plain worktree name. Defensive against
    # command injection via the path argument and against accidental clobbers.
    if [[ "$wt_name" =~ ^[A-Za-z0-9_.-]+$ ]] && [ "$wt_name" != "." ] && [ "$wt_name" != ".." ]; then
      remote_host="${VT_REMOTE_HOST:-}"
      if [ -z "$remote_host" ]; then
        main_repo="$("$REAL_GIT" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')"
        [ -n "$main_repo" ] && [ -f "$main_repo/.env" ] && \
          remote_host="$(awk -F= '/^VT_REMOTE_HOST=/{sub(/^VT_REMOTE_HOST=/,""); print; exit}' "$main_repo/.env")"
      fi
      if [ -n "$remote_host" ]; then
        echo "git-gate: removing matching remote worktree residue on $remote_host" >&2
        remote_root="/root/voicetree-public"
        ssh -o BatchMode=yes -o ConnectTimeout=5 "$remote_host" \
          "rm -rf '$remote_root/.git/worktrees/$wt_name' '$remote_root/.worktrees/$wt_name'" \
          >/dev/null 2>&1 \
          && echo "git-gate: remote worktree residue removed for $wt_name" >&2 \
          || echo "git-gate: warning: failed to ssh-clean $wt_name on $remote_host — drift may follow; run 'mutagen sync list vt-remote' to check" >&2
      else
        echo "git-gate: no VT_REMOTE_HOST found; skipping remote residue cleanup" >&2
      fi
    else
      echo "git-gate: worktree name '$wt_name' is not a plain safe name; skipping remote cleanup" >&2
    fi
  elif [ $ec -ne 0 ]; then
    echo "git-gate: git worktree remove failed with exit code $ec" >&2
  else
    echo "git-gate: worktree remove path not detected; skipping remote cleanup" >&2
  fi

  exit $ec
fi

if [ -n "$reason" ]; then
  {
    echo ""
    echo "  ✗ git-gate: BLOCKED"
    echo "    command: git ${ORIG_ARGS[*]}"
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

  pass=""
  if { exec 3</dev/tty; } 2>/dev/null; then
    read -rsp "    password: " pass <&3 || pass=""
    exec 3<&-
    echo "" >&2
  elif [ -n "${GIT_GATE_PASS_ATTEMPT:-}" ]; then
    pass="$GIT_GATE_PASS_ATTEMPT"
  else
    {
      echo "  ✗ git-gate: BLOCKED (no TTY)"
      echo ""
      echo "    [MESSAGE FROM USER]: achieve your goal non-destructively"
      echo "    with other git commands — other agents share this checkout."
      [ -n "$suggestion" ] && echo "    try: $suggestion"
      echo ""
      echo "    Only ask the user for the password if you have no other"
      echo "    way of performing your goal cleanly."
      echo ""
      echo "    If the user provides it, retry the command with the password in"
      echo "    the GIT_GATE_PASS_ATTEMPT environment variable, e.g.:"
      echo ""
      echo "      GIT_GATE_PASS_ATTEMPT='<password>' git ${ORIG_ARGS[*]}"
      echo ""
      echo "    Do NOT call git through any other path or binary. Do NOT modify"
      echo "    PATH to circumvent this gate. If you cannot get the password,"
      echo "    surface the blocked command to the user and stop."
      echo ""
      echo "  ✗ git-gate: REJECTED — the command above did NOT run (no TTY, no GIT_GATE_PASS_ATTEMPT)"
    } >&2
    exit 1
  fi

  if [ "$pass" != "$expected" ]; then
    {
      echo "    wrong password — aborted."
      echo "  ✗ git-gate: REJECTED — the command above did NOT run (wrong password)"
    } >&2
    exit 1
  fi
  # one-shot: clear the attempt so re-invocations require fresh authorization
  unset GIT_GATE_PASS_ATTEMPT
fi

exec "$REAL_GIT" "${ORIG_ARGS[@]}"
