#!/bin/bash
# Installer for git-gate. Copies git-gate.sh → ~/bin/git, marks it executable,
# and tells you what (if anything) to add to your shell init.
#
# Does NOT auto-edit your rc files — prints the line you should add yourself.

set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SRC_DIR/git-gate.sh"
DEST_DIR="$HOME/bin"
DEST="$DEST_DIR/git"

[ -f "$SRC" ] || { echo "git-gate.sh missing next to install.sh" >&2; exit 1; }

mkdir -p "$DEST_DIR"

# Refuse to overwrite an existing $DEST unless it's a previous git-gate install
if [ -e "$DEST" ] && ! grep -q "git-gate" "$DEST" 2>/dev/null; then
  echo "refuse: $DEST exists and is not a git-gate shim." >&2
  echo "       move it aside and re-run, or install elsewhere." >&2
  exit 1
fi

install -m 755 "$SRC" "$DEST"
echo "✓ installed $DEST"

# Detect the real git that the shim will forward to
REAL_GIT=""
for cand in /opt/homebrew/bin/git /usr/local/bin/git /usr/bin/git /opt/local/bin/git; do
  if [ -x "$cand" ] && [ "$cand" != "$DEST" ]; then REAL_GIT="$cand"; break; fi
done
[ -n "$REAL_GIT" ] && echo "✓ will forward to $REAL_GIT" || echo "! no real git found in usual locations"

# PATH check — does ~/bin come before the real git's directory?
case ":$PATH:" in
  *":$DEST_DIR:"*) on_path=1 ;;
  *) on_path=0 ;;
esac

shell_name="$(basename "${SHELL:-bash}")"
case "$shell_name" in
  zsh)  rc="$HOME/.zshrc" ;;
  bash) rc="$HOME/.bashrc" ;;
  *)    rc="your shell init file" ;;
esac

echo ""
if [ "$on_path" -eq 0 ]; then
  echo "→ Add this line near the top of $rc, then restart your shell:"
  echo ""
  echo "    export PATH=\"\$HOME/bin:\$PATH\""
  echo ""
else
  # Even if ~/bin is on PATH, it must come before the real git's dir
  IFS=':' read -ra parts <<<"$PATH"
  saw_dest=0; conflict=""
  for p in "${parts[@]}"; do
    [ "$p" = "$DEST_DIR" ] && saw_dest=1
    [ "$p" = "$(dirname "$REAL_GIT")" ] && [ "$saw_dest" -eq 0 ] && { conflict="$p"; break; }
  done
  if [ -n "$conflict" ]; then
    echo "! $DEST_DIR is on PATH but comes AFTER $conflict on your PATH."
    echo "  Move \$HOME/bin in front in $rc so the shim wins."
  else
    echo "✓ \$HOME/bin is on PATH ahead of the real git."
  fi
fi

echo "→ Set your password (pick one):"
echo ""
echo "  # (a) env var in $rc:"
echo "  export GIT_GATE_PASS=\"your_secret\""
echo ""
echo "  # (b) macOS keychain (no env-var leak):"
echo "  security add-generic-password -s git-gate -a \"\$USER\" -w 'your_secret'"
echo ""
echo "  # default until you set one: 'changeme'"
echo ""
echo "→ Verify after restarting your shell:"
echo "  which git    # expect: $DEST"
echo "  git status   # should pass through unchanged"
