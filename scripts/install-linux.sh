#!/bin/bash
# VoiceTree Linux installer
# Downloads and installs the latest VoiceTree AppImage for your architecture
#
# Usage: curl -fsSL https://raw.githubusercontent.com/voicetreelab/voicetree-releases/main/scripts/install-linux.sh | bash

set -e

REPO="voicetreelab/voicetree"
INSTALL_DIR="${HOME}/.local/bin"

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
    x86_64)  ARCH_SUFFIX="" ;;
    aarch64) ARCH_SUFFIX="-arm64" ;;
    *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Get latest release
echo "Fetching latest release..."
LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
VERSION=${LATEST#v}

if [ -z "$VERSION" ]; then
    echo "Error: Could not fetch latest version"
    exit 1
fi

# Download AppImage
FILENAME="VoiceTree-${VERSION}${ARCH_SUFFIX}.AppImage"
URL="https://github.com/$REPO/releases/download/$LATEST/$FILENAME"

echo "Downloading VoiceTree $VERSION for $ARCH..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$URL" -o "$INSTALL_DIR/voicetree"
chmod +x "$INSTALL_DIR/voicetree"

echo ""
echo "VoiceTree installed to $INSTALL_DIR/voicetree"
echo "Run with: voicetree"

# Check PATH
case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
        echo ""
        echo "Note: $INSTALL_DIR is not in your PATH"
        echo "Add it with: export PATH=\"$INSTALL_DIR:\$PATH\""
        echo "Or add this line to your ~/.bashrc or ~/.zshrc"
        ;;
esac
