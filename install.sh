#!/bin/sh
set -e

REPO="voicetreelab/voicetree"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { printf "${BLUE}==>${NC} %s\n" "$1"; }
success() { printf "${GREEN}==>${NC} %s\n" "$1"; }
error() { printf "${RED}Error:${NC} %s\n" "$1" >&2; exit 1; }

# Check OS
OS="$(uname -s)"
case "$OS" in
    Linux) ;;
    *) error "This installer only supports Linux. For macOS, use: brew tap voicetreelab/voicetree && brew install voicetree" ;;
esac

# Check architecture
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64) ;;
    *) error "Unsupported architecture: $ARCH. Linux AppImage is only available for x86_64." ;;
esac

# Download AppImage
URL="https://github.com/$REPO/releases/latest/download/voicetree.AppImage"

info "Downloading VoiceTree..."
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL -o "$TMPDIR/voicetree.AppImage" "$URL" || error "Download failed. Check if release exists: $URL"

# Install
info "Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
mv "$TMPDIR/voicetree.AppImage" "$INSTALL_DIR/voicetree"
chmod +x "$INSTALL_DIR/voicetree"

# Check if in PATH
case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
        echo ""
        info "Add $INSTALL_DIR to your PATH:"
        echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
        echo ""
        ;;
esac

success "VoiceTree installed successfully!"
echo "Run with: voicetree"
