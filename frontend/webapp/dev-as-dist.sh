#!/bin/bash

# This script runs your dev environment exactly as the distributed app would
# Catches distribution issues in seconds, not minutes

echo "🚀 Running development with production constraints..."
echo "This catches distribution issues BEFORE building"
echo "----------------------------------------"

# 1. Check if server exists in resources directory
SERVER_DEST="resources/server/voicetree-server"

if [ -f "$SERVER_DEST" ]; then
    echo "✓ Server already exists at $SERVER_DEST"
    chmod +x "$SERVER_DEST"
else
    # Try to copy from build output
    SERVER_SOURCE="../../dist/voicetree-server/voicetree-server"
    if [ -f "$SERVER_SOURCE" ]; then
        echo "✓ Copying server from $SERVER_SOURCE to $SERVER_DEST"
        mkdir -p resources/server
        cp -f "$SERVER_SOURCE" "$SERVER_DEST"
        chmod +x "$SERVER_DEST"
    else
        echo "❌ No server found. Run build_server.sh from project root first!"
        exit 1
    fi
fi

# 2. Run with production-like environment
echo "Starting with restricted PATH..."

# Save current Node absolutePath before restricting
NODE_PATH=$(which node)
NODE_DIR=$(dirname "$NODE_PATH")

# Minimal PATH like Finder gives to apps, but keep Node for Electron
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$NODE_DIR"

# Clear dev-only environment variables
unset NODE_ENV
unset ELECTRON_IS_DEV

# 3. Start Electron with production-like settings
echo "PATH: $PATH"
echo "Starting Electron..."

# This simulates how the app will spawn the server - with restricted PATH
# The server spawn will fail if it depends on anything not in the minimal PATH
npx electron . --no-sandbox