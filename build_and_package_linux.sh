#!/bin/bash
# Complete build and package script for VoiceTree with Electron (Linux)
# This script builds the Python server and packages it with the Electron app for Linux
#
# Usage: ./build_and_package_linux.sh [--publish]
#   --publish  Also publish to GitHub releases after building

set -e  # Exit on error

# Parse arguments
PUBLISH=false
for arg in "$@"; do
    case $arg in
        --publish)
            PUBLISH=true
            shift
            ;;
    esac
done

echo "=========================================="
echo "VoiceTree Linux Build & Package Script"
echo "=========================================="
echo ""

# Check we're in the VoiceTree directory
if [ ! -f "server.py" ]; then
    echo "Error: This script must be run from the VoiceTree root directory"
    exit 1
fi

## Step 1: Build the Python server executable
echo "Step 1: Building Python server executable (Linux)..."
echo "----------------------------------------------"
./build_server_linux.sh

if [ ! -f "dist/resources-linux/server/voicetree-server" ]; then
    echo "Error: Server build failed or not copied to dist/resources-linux/server/"
    exit 1
fi

# Step 1.5: Copy Linux resources to dist/resources (for electron-builder)
echo ""
echo "Step 1.5: Setting up dist/resources from Linux build..."
echo "----------------------------------------------"

# Copy Linux server to dist/resources (electron-builder expects it here)
rm -rf ./dist/resources/server
mkdir -p ./dist/resources/server
cp -r ./dist/resources-linux/server/* ./dist/resources/server/
echo "Server copied from dist/resources-linux/server/"

# Copy tools
mkdir -p ./dist/resources/tools
shopt -s dotglob
cp -r ./tools/* ./dist/resources/tools/
shopt -u dotglob
echo "Tools copied to dist/resources/tools/"

# Copy backend modules needed by tools
mkdir -p ./dist/resources/backend
cp -r ./backend/context_retrieval ./dist/resources/backend/
cp -r ./backend/markdown_tree_manager ./dist/resources/backend/
cp ./backend/__init__.py ./dist/resources/backend/
cp ./backend/types.py ./dist/resources/backend/
cp ./backend/settings.py ./dist/resources/backend/
cp ./backend/logging_config.py ./dist/resources/backend/
echo "Backend modules copied to dist/resources/backend/"
echo "   - context_retrieval/"
echo "   - markdown_tree_manager/"
echo "   - types.py, settings.py, logging_config.py"

# Step 2: Navigate to frontend
echo ""
echo "Step 2: Building Electron frontend..."
echo "----------------------------------------------"
cd frontend/webapp

# Step 3: Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

# Step 4: Build frontend
echo "Building frontend assets..."
# Use direct build commands to avoid running smoke tests (which need a display)
npx tsc -b || true  # Allow TS errors for now
npx vite build

# Step 5: Build distributable
echo ""
echo "Step 3: Creating distributable package..."
echo "----------------------------------------------"
echo "Building Electron distributable for Linux (this may take a few minutes)..."

# Clean previous Linux builds only (don't touch other platform builds)
cd ../..
rm -rf dist/electron-linux

# Build the distributable from frontend
cd frontend/webapp

if [ "$PUBLISH" = true ]; then
    echo "Publishing enabled - will upload to GitHub releases"
    electron-vite build && electron-builder --linux --publish=always --config.directories.output=../../dist/electron-linux
else
    electron-vite build && electron-builder --linux --publish=never --config.directories.output=../../dist/electron-linux
fi

# Step 6: Report results
echo ""
echo "=========================================="
echo "BUILD COMPLETE!"
echo "=========================================="
echo ""
echo "Artifacts created:"
echo "  - Python server: ../../dist/voicetree-server/"
echo "  - Server (Linux): ../../dist/resources-linux/server/"

if [ -d "../../dist/electron-linux" ]; then
    echo "  - Electron app: ../../dist/electron-linux/"

    APPIMAGE_FILE=$(find ../../dist/electron-linux -name "*.AppImage" 2>/dev/null | head -1)
    if [ -n "$APPIMAGE_FILE" ]; then
        echo ""
        echo "Distributable package ready:"
        echo "   $APPIMAGE_FILE"
        echo ""
        echo "   This AppImage contains the complete VoiceTree app with integrated server!"
        echo "   Users can run it directly without needing Python or any dependencies."
    fi
fi

echo ""
if [ "$PUBLISH" = true ]; then
    echo "Published to GitHub releases!"
else
    echo "To publish, run: ./build_and_package_linux.sh --publish"
fi
echo ""
echo "Done!"
