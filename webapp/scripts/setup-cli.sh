#!/usr/bin/env bash
# Sets up `vt` and `voicetree` CLI commands on PATH.
# Creates symlinks in /usr/local/bin (requires sudo if needed) or ~/.local/bin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_VT="$WEBAPP_DIR/bin/vt"

# Ensure the wrapper is executable
chmod +x "$BIN_VT"

# Prefer /usr/local/bin if writable, otherwise fall back to ~/.local/bin
if [ -w /usr/local/bin ]; then
    INSTALL_DIR="/usr/local/bin"
elif sudo -n true 2>/dev/null; then
    INSTALL_DIR="/usr/local/bin"
    USE_SUDO=1
else
    INSTALL_DIR="$HOME/.local/bin"
    mkdir -p "$INSTALL_DIR"
fi

install_link() {
    local cmd="$1"
    local target="$INSTALL_DIR/$cmd"
    if [ -e "$target" ] || [ -L "$target" ]; then
        rm -f "$target"
    fi
    if [ "${USE_SUDO:-0}" = "1" ]; then
        sudo ln -s "$BIN_VT" "$target"
    else
        ln -s "$BIN_VT" "$target"
    fi
    echo "  $target -> $BIN_VT"
}

echo "Installing vt CLI..."
install_link vt
install_link voicetree
echo "Done."

# Warn if install dir is not on PATH
case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
        echo ""
        echo "Note: $INSTALL_DIR is not on your PATH. Add it:"
        echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
        ;;
esac
