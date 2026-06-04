#!/usr/bin/env bash
# install.sh — put the machine-LOCAL dev-flow commands (vt-sync / vt-pr /
# vt-worktree) AND the product CLI `vt` on PATH.
#
# Symlinks them into $HOME/bin and ensures $HOME/bin is first on PATH — for
# interactive/login shells (shell-init) AND for the non-login ssh command shells
# that spawned agents run in (Linux /etc/environment, applied by pam_env to every
# ssh session). Idempotent. _common.sh is sourced from the repo via symlink
# resolution, not installed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DEST_DIR="${VT_BIN_DIR:-$HOME/bin}"
mkdir -p "$DEST_DIR"

for cmd in vt-sync vt-pr vt-worktree; do
  src="$SCRIPT_DIR/$cmd"
  [ -f "$src" ] || { echo "install.sh: missing helper $src" >&2; exit 1; }
  chmod +x "$src"
  ln -sfn "$src" "$DEST_DIR/$cmd"
  echo "→ dev-flow: $DEST_DIR/$cmd -> $src"
done

# The product CLI `vt` lives in the voicetree-cli package (not in dev-flow/), but
# it must be on PATH for the same dev workflow: the Mac runs it locally, and the
# remote box's `vt` forwards every invocation back to the Mac. Its bin wrapper
# resolves symlinks to find its own package dir, so linking it from $HOME/bin is
# safe — it still runs the live monorepo TS sources via tsx.
vt_cli="$REPO_ROOT/packages/systems/voicetree-cli/bin/vt"
[ -f "$vt_cli" ] || { echo "install.sh: missing product CLI $vt_cli" >&2; exit 1; }
chmod +x "$vt_cli"
ln -sfn "$vt_cli" "$DEST_DIR/vt"
echo "→ vt CLI: $DEST_DIR/vt -> $vt_cli"

# --- ensure $HOME/bin is on PATH ---------------------------------------------
# Which shell-init files to wire is platform-specific (the dev-flow commands must
# be found by the platform's default login/interactive shell).
case "$(uname -s)" in
  Darwin) SHELL_INIT_FILES=("$HOME/.zshrc" "$HOME/.zprofile");;
  *)      SHELL_INIT_FILES=("$HOME/.bashrc" "$HOME/.profile");;
esac
PATH_LINE='export PATH="$HOME/bin:$PATH"'
PATH_MARKER='# vt dev-flow: $HOME/bin on PATH (managed by dev-flow/install.sh)'

ensure_path_shell_init() {
  local shell_file="$1"
  if [ -f "$shell_file" ] && grep -qE '^export PATH="?[$]HOME/bin:' "$shell_file"; then
    echo "→ install.sh: PATH already routes through \$HOME/bin in $shell_file (skip)"
    return 0
  fi
  { echo ""; echo "$PATH_MARKER"; echo "$PATH_LINE"; } >> "$shell_file"
  echo "→ install.sh: appended \$HOME/bin PATH line to $shell_file"
}

# Non-login / non-interactive gap: agents are spawned via `ssh host "<cmd>"`,
# which never sources the shell-init files. On Linux, /etc/environment is applied
# by pam_env to EVERY ssh session (including bare command execution), so it is the
# one lever that reaches spawned agents. (macOS agents run via the Mac launchers
# that ssh to the VM, so this is Linux-only.)
ensure_path_etc_environment() {
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
    "$bindir:"*) echo "→ install.sh: $bindir already first in $env_file PATH (skip)"; return 0 ;;
  esac
  local deduped tmp
  deduped="$(printf ':%s:' "$current" | sed "s#:$bindir:#:#g; s#^:##; s#:\$##")"
  tmp="$env_file.devflow.tmp"
  grep -vE '^[[:space:]]*PATH=' "$env_file" 2>/dev/null > "$tmp" || true
  echo "PATH=\"$bindir:$deduped\"" >> "$tmp"
  cat "$tmp" > "$env_file"   # cat (not mv) to preserve perms/owner
  rm -f "$tmp"
  echo "→ install.sh: prepended $bindir to PATH in $env_file (reaches non-login/agent shells)"
}

for init_file in "${SHELL_INIT_FILES[@]}"; do ensure_path_shell_init "$init_file"; done
ensure_path_etc_environment

echo "✔ dev-flow commands installed into $DEST_DIR (open a NEW shell to pick up PATH)."
