#!/usr/bin/env bash
# install.sh — install git-gate on this machine.
#
# Drops the wrapper at $HOME/bin/git, ensures $HOME/bin is at the front of PATH
# in ~/.zshrc, and (optionally) stores a password in the macOS keychain so the
# wrapper can read it via `security find-generic-password`.
#
# Idempotent: re-running updates the wrapper without re-prompting for things
# that are already configured.
#
# Usage:
#   bash scripts/dev-setup/git-gate/install.sh           # interactive, prompts for password
#   bash scripts/dev-setup/git-gate/install.sh --no-password   # skip password setup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/git-gate.sh"
DEST_DIR="$HOME/bin"
DEST="$DEST_DIR/git"
ZSHRC="$HOME/.zshrc"
ZPROFILE="$HOME/.zprofile"
SKIP_PASSWORD=0

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

# Ensure $HOME/bin is on PATH ahead of /opt/homebrew/bin. Interactive zsh reads
# ~/.zshrc, while login non-interactive shells such as agent command runners may
# read ~/.zprofile without reading ~/.zshrc.
PATH_LINE='export PATH="$HOME/bin:/opt/homebrew/bin:$PATH:$HOME/.claude/local"'

ensure_git_gate_path() {
  local shell_file="$1"
  if [ -f "$shell_file" ] && grep -qE '^export PATH="?[$]HOME/bin:' "$shell_file"; then
    echo "→ install.sh: PATH already routes through \$HOME/bin first in $shell_file (skip)"
    return 0
  fi

  echo "→ install.sh: appending PATH line to $shell_file"
  {
    echo ""
    echo "# git-gate shim: \$HOME/bin must precede /opt/homebrew/bin so git resolves to the wrapper"
    echo "$PATH_LINE"
  } >> "$shell_file"
}

ensure_git_gate_path "$ZSHRC"
ensure_git_gate_path "$ZPROFILE"

# Password setup (macOS keychain).
if [ "$SKIP_PASSWORD" -eq 1 ]; then
  echo "→ install.sh: skipping password setup (--no-password)"
elif ! command -v security >/dev/null 2>&1; then
  echo "→ install.sh: 'security' command not available — skipping keychain setup."
  echo "   On non-macOS, set the password via your shell init:"
  echo "     export GIT_GATE_PASS='your-password'    # in ~/.zshrc or equivalent"
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
    echo "→ install.sh: no password set — wrapper will fall back to GIT_GATE_PASS env var or 'changeme'"
  fi
  unset pass
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
echo "  Agents must surface the block to the user and request the password — never bypass via /opt/homebrew/bin/git."
