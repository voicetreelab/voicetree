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

# VT_SYNC=1 short-circuits the ENTIRE gate (D3). The read-only-base sync daemon
# (vt-sync-base.sh) and the first-run base configuration run their own git with
# this set: they must never hit the read-only base guard, the checkout/reset
# reason logic, or any password prompt (they run with no TTY and would deadlock).
# This is the single blessed bypass — and it is intentionally the very first
# thing the gate does, before any argv parsing or reason logic.
if [ "${VT_SYNC:-}" = "1" ]; then
  exec "$REAL_GIT" "$@"
fi

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

# Leading args consumed above are git's global options (e.g. `-C <repo>`); keep
# them so the worktree-add admission check below can re-resolve the repo even
# when the gate is invoked from a cwd that isn't the repository.
GATE_GLOBAL_OPTS=("${ORIG_ARGS[@]:0:${#ORIG_ARGS[@]} - $#}")

sub="${1:-}"
sub_arg="${2:-}"
rest="${*:2}"
reason=""
suggestion=""

# --- D5 read-only base guard ------------------------------------------------
# The MAIN worktree of a voicetree clone is the read-only fast-forward cache of
# origin (the "base"). All editing happens in linked worktrees; integration
# happens via origin. Refuse ref-moving subcommands in the base with a helpful
# message. Detection is structural and machine-independent:
#   - main worktree:   git-dir == git-common-dir
#   - linked worktree: they differ → always allowed (never gated here)
# and confirmed to be a voicetree clone via the origin URL, so unrelated repos
# (e.g. brain) are untouched. The sync daemon is already exempt via VT_SYNC=1.
gate_base_branch() { printf '%s' "${VT_BASE_BRANCH:-dev-manu}"; }

in_voicetree_base() {
  local gd cd url
  gd="$("$REAL_GIT" "${GATE_GLOBAL_OPTS[@]}" rev-parse --git-dir 2>/dev/null)" || return 1
  cd="$("$REAL_GIT" "${GATE_GLOBAL_OPTS[@]}" rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -n "$gd" ] && [ "$gd" = "$cd" ] || return 1
  url="$("$REAL_GIT" "${GATE_GLOBAL_OPTS[@]}" remote get-url origin 2>/dev/null)" || return 1
  # Match the voicetree[-public] repo at a path boundary (covers https, ssh, and
  # local-path origins) so a repo merely ending in "...voicetree.git" can't false
  # positive. The trailing .git is optional (local clones may omit it).
  case "$url" in
    */voicetree.git|*/voicetree|*/voicetree-public.git|*/voicetree-public) return 0 ;;
    *) return 1 ;;
  esac
}

# Emit the read-only-base block message (with a divergence-recovery hint) and exit.
deny_base_edit() {
  local base_top
  base_top="$("$REAL_GIT" "${GATE_GLOBAL_OPTS[@]}" rev-parse --show-toplevel 2>/dev/null || true)"
  {
    echo ""
    echo "  ✗ git-gate: BLOCKED — this checkout is the origin cache (read-only base)."
    echo "    command: git ${ORIG_ARGS[*]}"
    echo ""
    echo "    The base is a read-only fast-forward cache of origin/$(gate_base_branch)."
    echo "    Editing happens in a worktree; integration happens via origin —"
    echo "    the base only ever fast-forwards. Never commit/merge/rebase/pull/revert here."
    echo ""
    if [ "$sub" = pull ] || [ "$sub" = fetch ]; then
      echo "    To UPDATE this base to origin, do NOT use 'git $sub' — run:"
      echo "      vt-sync                         # fast-forwards the base to origin (the only safe way)"
      echo "    A 2-3 min timer also keeps it current automatically; you rarely need to."
      echo ""
    fi
    echo "    Work in a worktree instead:"
    echo "      vt-worktree <name> [<branch>]   # or: git worktree add -b <name> <name> origin/<branch>"
    echo "    Then land it:"
    echo "      vt-land \"msg\"                   # quick fast-forward push to the integration branch"
    echo "      vt-pr                           # open a PR for reviewed work"
    echo ""
    echo "    If the base has already diverged from origin, re-pin it with:"
    echo "      VT_SYNC=1 git -C ${base_top:-<base>} reset --hard origin/$(gate_base_branch)"
    echo ""
  } >&2
  exit 1
}

# `git apply` cannot move a ref, but a real apply dirties the read-only base (the
# daemon then refuses to fast-forward). Treat apply as mutating UNLESS it carries
# only a read-only inspection flag — `--check` / `--stat` / `--numstat` /
# `--summary` touch nothing, so tooling that probes patches must stay unblocked.
# A bare `-R` (reverse-apply) DOES write the tree, so it remains gated.
apply_is_readonly() {
  local a
  for a in "$@"; do
    case "$a" in
      --check|--stat|--numstat|--summary) return 0 ;;
    esac
  done
  return 1
}

# D5 read-only base guard. `pull` (= fetch+merge) and `revert` (= a commit) both
# move the base ref and were the everyday muscle-memory bypasses of the original
# list; `update-ref` rewrites the ref directly. All are gated here. The sync
# daemon and configure-base reach these paths with VT_SYNC=1 (whole-gate bypass,
# handled at the very top) so the legitimate fast-forward is never blocked.
case "$sub" in
  commit|merge|rebase|reset|cherry-pick|am|pull|revert|update-ref)
    in_voicetree_base && deny_base_edit
    ;;
  apply)
    if in_voicetree_base && ! apply_is_readonly "${@:2}"; then deny_base_edit; fi
    ;;
esac

# Per-machine worktree root. This wrapper is the ONE place that owns worktree
# PLACEMENT: callers pass a bare name and we put the tree here. The default
# matches the admission checker's default basename (vt-wts); install.sh writes
# the per-machine value ($HOME/vt-wts on both Linux and macOS).
gate_worktree_root() {
  printf '%s' "${VT_WORKTREE_ROOT:-$HOME/vt-wts}"
}

# Print the 1-based index of the destination positional within the passed args
# (the stripped `worktree add ...` argv). The caller reads the value back with
# `${!idx}` and can REWRITE that element for placement enforcement. Empty if no
# destination positional is present. Scanning starts at $3 (after `worktree add`).
worktree_add_path_index() {
  local i=3 n=$#
  local expect_option_value=0
  local after_separator=0
  local arg
  while [ "$i" -le "$n" ]; do
    arg="${!i}"
    if [ "$after_separator" -eq 1 ]; then
      printf '%s\n' "$i"
      return 0
    fi
    if [ "$expect_option_value" -eq 1 ]; then
      expect_option_value=0
      i=$((i + 1))
      continue
    fi
    case "$arg" in
      --)            after_separator=1 ;;
      -b|-B|--orphan|--reason) expect_option_value=1 ;;
      -*)            ;;
      *)             printf '%s\n' "$i"; return 0 ;;
    esac
    i=$((i + 1))
  done
}

# Bootstrap a freshly-added worktree.
#
# Steps:
#   1. Symlink .env from the main checkout (secrets the worktree needs).
#   2. Run the same async setup router VT-managed worktrees use.
#
# Mac-role worktrees install both local and remote deps. Remote-role worktrees
# install only the current worktree deps.
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

  local async_hook="$main_repo/scripts/git/worktree/on-created-async.sh"
  if [ ! -x "$async_hook" ]; then
    echo "git-gate: async worktree hook missing at $async_hook; skipping dependency setup" >&2
    return 0
  fi

  local wt_name
  wt_name="$(basename "$wt_abs")"
  echo "git-gate: running async worktree dependency setup for $wt_name" >&2
  if ! "$async_hook" "$wt_abs" "$wt_name"; then
    echo "git-gate: warning: async worktree dependency setup failed for $wt_name" >&2
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
  # --- PRE-action: admission control ----------------------------------------
  # Refuse to pile up worktrees: block the add when merged/idle trees await
  # cleanup, so agents tidy up instead of accumulating dead worktrees. The
  # check is detection-only and self-service (its message tells the agent to
  # clean up itself). Opt out with VT_GIT_GATE_SKIP_ADMISSION=1.
  if [ "${VT_GIT_GATE_SKIP_ADMISSION:-}" != "1" ]; then
    repo_top="$("$REAL_GIT" "${GATE_GLOBAL_OPTS[@]}" rev-parse --show-toplevel 2>/dev/null)"
    admission="$repo_top/scripts/git/worktree/worktree-admission-check.sh"
    if [ -n "$repo_top" ] && [ -x "$admission" ]; then
      admission_ec=0
      # Run inside the repo (the check relies on cwd) and scope it to the
      # basename of this machine's worktree root.
      ( cd "$repo_top" && VT_WT_SIBLING_DIR_NAME="$(basename "$(gate_worktree_root)")" "$admission" ) >&2 \
        || admission_ec=$?
      if [ "$admission_ec" -eq 1 ]; then
        echo "" >&2
        echo "  ✗ git-gate: BLOCKED git worktree add — clean up the worktree(s) above, then retry." >&2
        exit 1
      fi
      # ec >= 2 is a checker setup error (already reported); fail open so a
      # broken check never wedges legitimate worktree creation.
    fi
  fi

  # --- PLACEMENT enforcement ------------------------------------------------
  # The wrapper owns WHERE worktrees live: rewrite the destination to
  # <worktree-root>/<basename-of-given-path> so callers (the VoiceTree app,
  # agents, plain `git worktree add -b x x`) never need to know the convention.
  # Escape hatch: VT_GIT_GATE_NO_PLACEMENT=1 honors the caller's explicit path.
  given_idx="$(worktree_add_path_index "$@")"
  if [ "${VT_GIT_GATE_NO_PLACEMENT:-}" = "1" ]; then
    # Honor the caller's explicit destination path (no placement rewrite).
    wt_path="${given_idx:+${!given_idx}}"
  elif [ -n "$given_idx" ]; then
    given_path="${!given_idx}"
    wt_root="$(gate_worktree_root)"
    wt_path="$wt_root/$(basename "$given_path")"
    mkdir -p "$wt_root"
    # Replace the destination positional in the stripped argv, then rebuild
    # the full real-git argv as <global opts> + <rewritten subcommand args>.
    rewritten=("$@")
    rewritten[$((given_idx - 1))]="$wt_path"
    ORIG_ARGS=("${GATE_GLOBAL_OPTS[@]}" "${rewritten[@]}")
    echo "git-gate: placement → $wt_path" >&2
  else
    # No destination positional found — leave argv untouched (real git will
    # error on its own, which is the correct surface for a malformed add).
    wt_path=""
  fi
  echo "git-gate: running git worktree add" >&2
  "$REAL_GIT" "${ORIG_ARGS[@]}"
  ec=$?
  if [ $ec -eq 0 ]; then
    echo "git-gate: normalizing worktree git metadata" >&2
    # Repair the new worktree's admin pointers. Two robustness points:
    #  1. Run with `-C <worktree>`, not the gate's cwd: callers commonly invoke
    #     `git -C <repo> worktree add <abs-path>` from a cwd that is not a git
    #     repo (agent/login shells rooted at $HOME), where a bare repair no-ops.
    #  2. `--relative-paths` (host-portable pointers, needed for mutagen
    #     cross-host sync) only exists on git >= 2.48. Try it first, then fall
    #     back to a plain repair — absolute pointers are fine for worktrees that
    #     never sync across hosts (e.g. the VM-local /root/vt-wts trees).
    repair_dir="${wt_path:-.}"
    if "$REAL_GIT" -C "$repair_dir" worktree repair --relative-paths >/dev/null 2>&1; then
      echo "git-gate: worktree git metadata normalized (relative paths)" >&2
    elif "$REAL_GIT" -C "$repair_dir" worktree repair >/dev/null 2>&1; then
      echo "git-gate: worktree git metadata repaired (this git lacks --relative-paths; pointers left absolute)" >&2
    else
      echo "git-gate: warning: git worktree repair failed; command-boundary repair will retry" >&2
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

  # Capture main_repo BEFORE the remove. Once the worktree is gone the
  # path-anchored `git worktree list` lookup below can't find a git context;
  # using -C against the to-be-removed worktree also keeps the gate working
  # when its own cwd is not a git repo (e.g. agent shell rooted elsewhere).
  main_repo=""
  if [ -n "$wt_path" ]; then
    main_repo="$("$REAL_GIT" -C "$wt_path" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')"
  fi

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
        # main_repo was captured above before the worktree was removed
        [ -n "$main_repo" ] && [ -f "$main_repo/.env" ] && \
          remote_host="$(awk -F= '/^VT_REMOTE_HOST=/{sub(/^VT_REMOTE_HOST=/,""); print; exit}' "$main_repo/.env")"
      fi
      if [ -n "$remote_host" ]; then
        echo "git-gate: removing matching remote worktree residue on $remote_host" >&2
        # The vt-remote full-repo mutagen replica (/root/vtrepo-synced) is retired
        # under the single-source model; only the vt-wts-synced worktree mirror remains.
        remote_wts_root="/root/vt-wts-synced"
        ssh -o BatchMode=yes -o ConnectTimeout=5 "$remote_host" \
          "rm -rf '$remote_wts_root/$wt_name'" \
          >/dev/null 2>&1 \
          && echo "git-gate: remote worktree residue removed for $wt_name" >&2 \
          || echo "git-gate: warning: failed to ssh-clean $wt_name on $remote_host — drift may follow; run 'mutagen sync list vt-wts-synced' to check" >&2
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
    # When the destructive command targets the read-only base cache, the real
    # fix is not "do it non-destructively here" — it is "do not work here at
    # all". Redirect the agent to a worktree off the base before anything else.
    if in_voicetree_base; then
      echo "    This checkout is the read-only origin cache (base) — you must NOT"
      echo "    edit, rewrite, or discard changes in it. Move your work onto a"
      echo "    worktree off the base and make the change there instead:"
      echo "      vt-worktree <name>            # new worktree off origin/$(gate_base_branch)"
      echo "      cd <printed path>             # then redo your change + vt-land \"msg\""
      echo "    If a stray edit is already sitting in the base, do not try to"
      echo "    restore/checkout it away — re-pin the whole base to origin:"
      echo "      VT_SYNC=1 git reset --hard origin/$(gate_base_branch)"
      echo ""
    fi
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
