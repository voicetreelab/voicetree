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
# Releases >= the multi-arch transition publish arch-suffixed names
# (voicetree-x64.AppImage / voicetree-arm64.AppImage). Older releases
# only have voicetree.AppImage. Try the new name first; for x86_64,
# fall back to the legacy name so this script keeps working against
# both old and new releases.
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)  APPIMAGE="voicetree-x64.AppImage"; APPIMAGE_FALLBACK="voicetree.AppImage" ;;
    aarch64) APPIMAGE="voicetree-arm64.AppImage"; APPIMAGE_FALLBACK="" ;;
    *) error "Unsupported architecture: $ARCH. Linux AppImage is available for x86_64 and aarch64." ;;
esac

BASE_URL="https://github.com/$REPO/releases/latest/download"

info "Downloading Voicetree..."
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

if ! curl -fsSL -o "$TMPDIR/voicetree.AppImage" "$BASE_URL/$APPIMAGE"; then
    if [ -n "$APPIMAGE_FALLBACK" ] && curl -fsSL -o "$TMPDIR/voicetree.AppImage" "$BASE_URL/$APPIMAGE_FALLBACK"; then
        :
    else
        error "Download failed. Tried $BASE_URL/$APPIMAGE${APPIMAGE_FALLBACK:+ and $BASE_URL/$APPIMAGE_FALLBACK}."
    fi
fi

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

success "Voicetree installed successfully!"
echo "Run with: voicetree"
