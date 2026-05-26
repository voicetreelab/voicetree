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

sub="${1:-}"
rest="${*:2}"
reason=""
merge_assertion=""   # non-empty → use this password instead of GIT_GATE_PASS

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

prewarm_remote_added_worktree_ready_async() {
  local wt_path="$1"
  if [ -z "$wt_path" ]; then
    echo "git-gate: worktree add path not detected; skipping async dependency prewarm" >&2
    return 0
  fi

  local wt_abs
  case "$wt_path" in
    /*) wt_abs="$wt_path" ;;
    *)  wt_abs="$(pwd -P)/$wt_path" ;;
  esac
  wt_abs="$(cd "$wt_abs" 2>/dev/null && pwd -P || printf '%s' "$wt_abs")"
  echo "git-gate: worktree path: $wt_abs" >&2

  local main_repo
  main_repo="$("$REAL_GIT" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')"
  if [ -z "$main_repo" ]; then
    echo "git-gate: warning: could not detect main worktree; command-boundary readiness will retry" >&2
    return 0
  fi

  local remote_runner="$main_repo/scripts/run-remote.mjs"
  if [ ! -f "$remote_runner" ]; then
    echo "git-gate: warning: missing remote runner: $remote_runner" >&2
    echo "git-gate: command-boundary readiness will retry before remote commands" >&2
    return 0
  fi

  local log_name
  log_name="$(basename "$wt_abs" | tr -c 'A-Za-z0-9_.-' '_')"
  local log_file="${TMPDIR:-/tmp}/voicetree-worktree-prewarm-${log_name}.log"

  echo "git-gate: prewarming remote worktree dependencies asynchronously" >&2
  echo "git-gate: dependency prewarm log: $log_file" >&2
  nohup sh -c 'cd "$1" && exec node "$2" true' sh "$wt_abs" "$remote_runner" >"$log_file" 2>&1 &
}

case "$sub" in
  merge)
    # --continue / --abort are conflict-resolution steps, not new merges — let through
    if [[ ! "$rest" =~ (^|[[:space:]])(--continue|--abort|--quit)([[:space:]]|$) ]]; then
      target_branch="$(echo "$rest" | tr -s ' ' | cut -d' ' -f1)"
      current_branch="$(git -C "${GIT_DIR:-.}" symbolic-ref --short HEAD 2>/dev/null || echo "unknown")"
      # Only gate merges performed in the MAIN worktree (primary checkout
      # tied directly to .git/). Merges in linked worktrees (`.worktrees/*`,
      # created via `git worktree add`) are cheap-to-revert local integration
      # steps and pass through.
      # Detection: in the main worktree, --git-dir and --git-common-dir resolve
      # to the same path. In a linked worktree, --git-dir points inside
      # <repo>/.git/worktrees/<name>/ while --git-common-dir is the shared .git.
      gd="$("$REAL_GIT" rev-parse --git-dir 2>/dev/null)"
      gcd="$("$REAL_GIT" rev-parse --git-common-dir 2>/dev/null)"
      gd_abs="$(cd "$gd" 2>/dev/null && pwd -P)"
      gcd_abs="$(cd "$gcd" 2>/dev/null && pwd -P)"
      if [ -n "$gd_abs" ] && [ "$gd_abs" = "$gcd_abs" ]; then
        reason="merging ${target_branch:-branch} into ${current_branch} (main worktree)"
        merge_assertion="yes_tests_and_measures_green"
      fi
    fi
    ;;
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
if [ "$sub" = "worktree" ] && [ "${2:-}" = "add" ]; then
  wt_path="$(worktree_add_path_arg "$@")"
  echo "git-gate: running git worktree add" >&2
  "$REAL_GIT" "$@"
  ec=$?
  if [ $ec -eq 0 ]; then
    echo "git-gate: normalizing worktree git metadata to relative paths" >&2
    if "$REAL_GIT" worktree repair --relative-paths >/dev/null 2>&1; then
      echo "git-gate: worktree git metadata normalized" >&2
    else
      echo "git-gate: warning: git worktree repair --relative-paths failed; command-boundary repair will retry" >&2
    fi
    if [ "${VT_GIT_GATE_SKIP_WORKTREE_PREWARM:-}" = "1" ]; then
      echo "git-gate: skipping async dependency prewarm; caller owns worktree hooks" >&2
    else
      prewarm_remote_added_worktree_ready_async "$wt_path"
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
if [ "$sub" = "worktree" ] && [ "${2:-}" = "remove" ]; then
  wt_path=""
  for arg in "${@:3}"; do
    case "$arg" in
      -*) ;;
      *)  wt_path="$arg"; break ;;
    esac
  done

  "$REAL_GIT" "$@"
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
  if [ -n "$merge_assertion" ]; then
    {
      echo ""
      echo "  ╔══════════════════════════════════════════════════════════════════╗"
      echo "  ║  git-gate: MERGE BLOCKED                                         ║"
      echo "  ╚══════════════════════════════════════════════════════════════════╝"
      echo "    command: git $*"
      echo ""
      echo "    Before merging, confirm ALL of the following:"
      echo ""
      echo "      1. \`npm run test\` passes in this worktree"
      echo "      2. Tier 1 e2e tests are green"
      echo "      3. Complexity measures have not regressed"
      echo ""
      echo "    If all green, type the assertion password to proceed:"
      echo "      yes_tests_and_measures_green"
      echo ""
    } >&2
    expected="$merge_assertion"
  else
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
      if [ "$sub" = "rebase" ]; then
        echo ""
        echo "    Merge does not require a password in linked worktrees."
        echo "    It is preferred for conflict resolution because it is non-destructive."
      fi
      echo ""
    } >&2
    expected="${GIT_GATE_PASS:-$(security find-generic-password -s git-gate -a "$USER" -w 2>/dev/null)}"
    expected="${expected:-changeme}"
  fi

  pass=""
  if { exec 3</dev/tty; } 2>/dev/null; then
    read -rsp "    password: " pass <&3 || pass=""
    exec 3<&-
    echo "" >&2
  elif [ -n "${GIT_GATE_PASS_ATTEMPT:-}" ]; then
    pass="$GIT_GATE_PASS_ATTEMPT"
  else
    {
      echo "  ╔══════════════════════════════════════════════════════════════════╗"
      echo "  ║  git-gate: BLOCKED — no TTY (agent / non-interactive context)    ║"
      echo "  ╚══════════════════════════════════════════════════════════════════╝"
      echo ""
      echo "    Ask the user for the password."
      echo ""
      echo "    If the user provides it, retry the command with the password in"
      echo "    the GIT_GATE_PASS_ATTEMPT environment variable, e.g.:"
      echo ""
      echo "      GIT_GATE_PASS_ATTEMPT='<password>' git $*"
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

exec "$REAL_GIT" "$@"
