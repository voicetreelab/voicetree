#!/usr/bin/env bash
# install.sh — install git-gate on this machine.
#
# Drops the wrapper at $HOME/bin/git and puts $HOME/bin at the front of PATH so
# `git` resolves to the wrapper. Which shell-init files are wired, and how the
# gate password is stored, are platform-specific:
#   - macOS : zsh init (~/.zshrc, ~/.zprofile); password in the login keychain.
#   - Linux : bash init (~/.bashrc, ~/.profile); password via an
#             `export GIT_GATE_PASS=...` line, supplied non-interactively with
#             GIT_GATE_SETUP_PASS so the installer stays scriptable on headless
#             dev boxes.
#
# Idempotent: re-running updates the wrapper without re-prompting for things
# that are already configured.
#
# Usage:
#   bash scripts/dev-setup/git-gate/install.sh                 # macOS: prompts for password
#   bash scripts/dev-setup/git-gate/install.sh --no-password   # skip password setup
#   GIT_GATE_SETUP_PASS='secret' bash .../install.sh           # Linux: set gate password

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/git-gate.sh"
DEST_DIR="$HOME/bin"
DEST="$DEST_DIR/git"
SKIP_PASSWORD=0

# Shell-init wiring is platform-specific: git-gate works by shadowing the real
# `git` with $HOME/bin/git earliest on PATH, so the PATH line must land in the
# files the platform's default login/interactive shell actually reads.
case "$(uname -s)" in
  Darwin)
    # macOS default shell is zsh; the Homebrew git at /opt/homebrew/bin must be
    # shadowed too, so $HOME/bin is placed ahead of it.
    SHELL_INIT_FILES=("$HOME/.zshrc" "$HOME/.zprofile")
    PATH_LINE='export PATH="$HOME/bin:/opt/homebrew/bin:$PATH:$HOME/.claude/local"'
    # Mac-authored worktrees live at the canonical sibling root $HOME/vt-wts —
    # this is the live mutagen `vt-wts-synced` alpha (Mac $HOME/vt-wts ↔ devbox
    # /root/vt-wts-synced; mutagen syncs CONTENTS, so the two ends differ in
    # basename) AND git-gate's own built-in default. The app computes the same
    # root when git-gate is absent, so app / git-gate / mirror all converge here.
    VT_WORKTREE_ROOT_VALUE="$HOME/vt-wts"
    ;;
  *)
    # Linux/dev boxes default to bash; the real git already lives on PATH under
    # /usr/bin, so prepending $HOME/bin is sufficient to shadow it.
    SHELL_INIT_FILES=("$HOME/.bashrc" "$HOME/.profile")
    PATH_LINE='export PATH="$HOME/bin:$PATH"'
    # Remote/dev-box worktrees are locally authored and NOT mirrored, so they
    # live under the plain (suffix-less) root.
    VT_WORKTREE_ROOT_VALUE="$HOME/vt-wts"
    ;;
esac

for arg in "$@"; do
  case "$arg" in
    --no-password) SKIP_PASSWORD=1 ;;
    -h|--help)
      sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "install.sh: unknown flag: $arg" >&2; exit 64 ;;
  esac
done

[ -f "$SRC" ] || { echo "install.sh: source wrapper not found at $SRC" >&2; exit 1; }

echo "→ install.sh: writing wrapper to $DEST"
mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST"
chmod 755 "$DEST"

# Ensure $HOME/bin is first on PATH in each shell-init file the platform reads.
# (PATH_LINE + SHELL_INIT_FILES were resolved per-OS above.)
ensure_git_gate_path() {
  local shell_file="$1"
  if [ -f "$shell_file" ] && grep -qE '^export PATH="?[$]HOME/bin:' "$shell_file"; then
    echo "→ install.sh: PATH already routes through \$HOME/bin first in $shell_file (skip)"
    return 0
  fi

  echo "→ install.sh: appending PATH line to $shell_file"
  {
    echo ""
    echo "# git-gate shim: \$HOME/bin must come first so git resolves to the wrapper"
    echo "$PATH_LINE"
  } >> "$shell_file"
}

# Idempotently maintain a single managed `export VT_WORKTREE_ROOT=...` line so
# the git-gate wrapper knows WHERE to place worktrees on this machine. The
# marker comment lets re-runs replace the value in place rather than appending.
ensure_vt_worktree_root_env() {
  local shell_file="$1" root="$2"
  local marker="# git-gate worktree root (managed by install.sh)"
  touch "$shell_file"
  if grep -qF "$marker" "$shell_file"; then
    grep -vF "$marker" "$shell_file" | grep -v '^export VT_WORKTREE_ROOT=' > "$shell_file.gitgate.tmp"
    mv "$shell_file.gitgate.tmp" "$shell_file"
  fi
  {
    echo ""
    echo "$marker"
    printf 'export VT_WORKTREE_ROOT=%q\n' "$root"
  } >> "$shell_file"
}

# Close the non-login / non-interactive gap. The shell-init files above only
# prepend $HOME/bin for interactive & login shells, but agents are spawned via
# `ssh host "<cmd>"` — a non-login, non-interactive shell that never sources
# them, so the gate is invisible to them. On Linux, /etc/environment is applied
# by pam_env to EVERY ssh session (including bare command execution), so it is
# the one lever that reaches spawned agents. Prepend $HOME/bin to its PATH.
# (macOS has no /etc/environment and its agents run in shells that source the
# init files above, so this is Linux-only.)
ensure_git_gate_path_etc_environment() {
  [ "$(uname -s)" = "Linux" ] || return 0
  local env_file="/etc/environment" bindir="$HOME/bin"
  if ! { [ -w "$env_file" ] || [ -w "$(dirname "$env_file")" ]; }; then
    echo "→ install.sh: cannot write $env_file (need root); skipping non-login PATH setup" >&2
    return 0
  fi
  local current
  current="$(grep -E '^[[:space:]]*PATH=' "$env_file" 2>/dev/null | head -1 \
    | sed -E 's/^[[:space:]]*PATH=//; s/^"//; s/"$//')"
  [ -n "$current" ] || current="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  case "$current:" in
    "$bindir:"*)
      echo "→ install.sh: $bindir already first in $env_file PATH (skip)"
      return 0 ;;
  esac
  # Drop any non-leading occurrence of bindir, then prepend it (idempotent:
  # repeated runs converge to bindir-first without duplicates).
  local deduped
  deduped="$(printf ':%s:' "$current" | sed "s#:$bindir:#:#g; s#^:##; s#:\$##")"
  local tmp="$env_file.gitgate.tmp"
  grep -vE '^[[:space:]]*PATH=' "$env_file" 2>/dev/null > "$tmp" || true
  echo "PATH=\"$bindir:$deduped\"" >> "$tmp"
  cat "$tmp" > "$env_file"   # cat (not mv) to preserve $env_file's perms/owner
  rm -f "$tmp"
  echo "→ install.sh: prepended $bindir to PATH in $env_file (gates non-login/agent shells)"
}

for init_file in "${SHELL_INIT_FILES[@]}"; do
  ensure_git_gate_path "$init_file"
  ensure_vt_worktree_root_env "$init_file" "$VT_WORKTREE_ROOT_VALUE"
done
ensure_git_gate_path_etc_environment
echo "→ install.sh: set VT_WORKTREE_ROOT=$VT_WORKTREE_ROOT_VALUE in ${SHELL_INIT_FILES[*]}"

# Idempotently maintain a single managed `export GIT_GATE_PASS=...` line in a
# shell-init file (Linux password storage). The marker comment lets re-runs
# replace the value in place rather than appending duplicates.
ensure_git_gate_pass_env() {
  local shell_file="$1" secret="$2"
  local marker="# git-gate password (managed by install.sh)"
  touch "$shell_file"
  if grep -qF "$marker" "$shell_file"; then
    grep -vF "$marker" "$shell_file" | grep -v '^export GIT_GATE_PASS=' > "$shell_file.gitgate.tmp"
    mv "$shell_file.gitgate.tmp" "$shell_file"
  fi
  {
    echo ""
    echo "$marker"
    printf 'export GIT_GATE_PASS=%q\n' "$secret"
  } >> "$shell_file"
}

# Password setup — platform-specific store.
if [ "$SKIP_PASSWORD" -eq 1 ]; then
  echo "→ install.sh: skipping password setup (--no-password)"
elif [ "$(uname -s)" = "Darwin" ]; then
  if ! command -v security >/dev/null 2>&1; then
    echo "→ install.sh: 'security' unavailable — skipping keychain setup."
  elif security find-generic-password -s git-gate -a "$USER" -w >/dev/null 2>&1; then
    echo "→ install.sh: keychain entry 'git-gate' already exists (skip)"
    echo "   To change it: security delete-generic-password -s git-gate -a \"\$USER\""
    echo "                 security add-generic-password -s git-gate -a \"\$USER\" -w '<new-password>'"
  else
    echo ""
    read -rsp "  Set git-gate password (or empty to skip): " pass
    echo ""
    if [ -n "$pass" ]; then
      security add-generic-password -s git-gate -a "$USER" -w "$pass"
      echo "→ install.sh: stored password in keychain (service=git-gate, account=$USER)"
    else
      echo "→ install.sh: no password set — wrapper falls back to GIT_GATE_PASS env var or 'changeme'"
    fi
    unset pass
  fi
else
  # Linux / other: store the gate password as an env export in shell init.
  # Write to EVERY init file, not just one: a login shell reads ~/.profile while
  # an interactive shell reads ~/.bashrc, and the gate needs GIT_GATE_PASS in
  # whichever one launched it (mirrors the PATH wiring above).
  if [ -n "${GIT_GATE_SETUP_PASS:-}" ]; then
    for init_file in "${SHELL_INIT_FILES[@]}"; do
      ensure_git_gate_pass_env "$init_file" "$GIT_GATE_SETUP_PASS"
    done
    echo "→ install.sh: wrote GIT_GATE_PASS to ${SHELL_INIT_FILES[*]} (open a new shell to load it)"
    unset GIT_GATE_SETUP_PASS
  else
    echo "→ install.sh: no GIT_GATE_SETUP_PASS provided — the gate will use the"
    echo "   GIT_GATE_PASS env var if present, otherwise the 'changeme' default."
    echo "   Set a real password with:"
    echo "     GIT_GATE_SETUP_PASS='your-password' bash scripts/dev-setup/git-gate/install.sh"
  fi
fi

echo ""
echo "✔ git-gate installed."
echo ""
echo "Next steps:"
echo "  1. Open a NEW terminal (existing shells inherit the old PATH)."
echo "  2. Verify the shim is on PATH:    which git    →    $DEST"
echo "  3. Try a destructive command, e.g.   git checkout -b test-gate    — you should be prompted."
echo ""
echo "Agent / non-interactive usage:"
echo "  Destructive commands fail in no-TTY contexts unless the agent supplies the password:"
echo "    GIT_GATE_PASS_ATTEMPT='<password>' git <destructive subcommand>"
echo "  Agents must surface the block to the user and request the password — never bypass by calling the real git directly or editing PATH."
