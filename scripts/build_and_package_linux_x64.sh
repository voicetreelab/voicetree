#!/bin/bash
# Complete build and package script for VoiceTree with Electron (Linux x86_64)
# This script builds the Python server and packages it with the Electron app for Linux x64
# Uses an isolated staging folder to avoid macOS node_modules symlink issues
#
# Usage: ./build_and_package_linux_x64.sh [--publish]
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
echo "VoiceTree Linux x86_64 Build & Package Script"
echo "=========================================="
echo ""

# Check we're in the VoiceTree directory
if [ ! -f "server.py" ]; then
    echo "Error: This script must be run from the VoiceTree root directory"
    exit 1
fi

## Step 1: Build the Python server executable
echo "Step 1: Building Python server executable (Linux x86_64)..."
echo "----------------------------------------------"
./scripts/build_server_linux_x64.sh

if [ ! -f "out/resources-linux-x64/server/voicetree-server" ]; then
    echo "Error: Server build failed or not copied to out/resources-linux-x64/server/"
    exit 1
fi

# Step 1.5: Copy agent tools and backend modules to out/resources-linux-x64
echo ""
echo "Step 1.5: Copying agent tools and backend modules to out/resources-linux-x64..."
echo "----------------------------------------------"

# Copy tools
mkdir -p ./out/resources-linux-x64/tools
shopt -s dotglob
cp -r ./tools/* ./out/resources-linux-x64/tools/
shopt -u dotglob
echo "Tools copied to out/resources-linux-x64/tools/"

# Copy backend modules needed by tools
mkdir -p ./out/resources-linux-x64/backend
cp -r ./backend/context_retrieval ./out/resources-linux-x64/backend/
cp -r ./backend/markdown_tree_manager ./out/resources-linux-x64/backend/
cp ./backend/__init__.py ./out/resources-linux-x64/backend/
cp ./backend/types.py ./out/resources-linux-x64/backend/
cp ./backend/logging_config.py ./out/resources-linux-x64/backend/
echo "Backend modules copied to out/resources-linux-x64/backend/"

# Step 2: Create isolated staging folder for Linux x64 build
# This prevents issues with macOS node_modules symlinks (e.g., node-pty -> .venv)
echo ""
echo "Step 2: Creating isolated staging folder for Linux x64 build..."
echo "----------------------------------------------"

STAGING_DIR="build-linux-x64-staging"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

# Copy webapp to staging (excluding node_modules for fresh install)
echo "Copying webapp to staging folder..."
mkdir -p "$STAGING_DIR/webapp"
tar -cf - -C webapp --exclude='node_modules' --exclude='dist' --exclude='dist-electron' . | tar -xf - -C "$STAGING_DIR/webapp"

# Set up out structure that electron-builder expects (../../out/resources from webapp)
mkdir -p "$STAGING_DIR/out"
cp -r out/resources-linux-x64 "$STAGING_DIR/out/resources"

# Copy .env if it exists
if [ -f "webapp/.env" ]; then
    cp webapp/.env "$STAGING_DIR/webapp/.env"
    # Export GH_TOKEN for publishing
    export $(grep -E '^GH_TOKEN=' webapp/.env | xargs)
fi

# Step 3: Install dependencies in staging (fresh Linux-native node_modules)
echo ""
echo "Step 3: Installing dependencies (fresh Linux-native node_modules)..."
echo "----------------------------------------------"
cd "$STAGING_DIR/webapp"

# Fresh install ensures Linux-native binaries without macOS symlinks
echo "Running npm ci for fresh Linux install..."
npm ci

# Step 4: Build frontend
echo ""
echo "Step 4: Building frontend assets..."
echo "----------------------------------------------"

# Add node_modules/.bin to PATH
export PATH="$PWD/node_modules/.bin:$PATH"

# Build with electron-vite
electron-vite build

# Step 5: Build distributable
echo ""
echo "Step 5: Creating distributable package..."
echo "----------------------------------------------"
echo "Building Electron distributable for Linux x86_64 (this may take a few minutes)..."

# Capture exit code so mv always runs even if publish fails
BUILD_EXIT_CODE=0
if [ "$PUBLISH" = true ]; then
    echo "Publishing enabled - will upload to GitHub releases"
    electron-builder --linux --publish=always || BUILD_EXIT_CODE=$?
else
    electron-builder --linux --publish=never || BUILD_EXIT_CODE=$?
fi

# Move back to project root
cd ..

# Always move the output to linux-x64-specific folder (even if publish failed)
# Note: electron-builder outputs to ../../out/electron (relative to webapp),
# which resolves to VoiceTree/out/electron even from staging directory
rm -rf out/electron-linux-x64
if [ -d "out/electron" ]; then
    mv out/electron out/electron-linux-x64
fi

# Exit with original code if build/publish failed
if [ $BUILD_EXIT_CODE -ne 0 ]; then
    echo "Build or publish step failed with exit code $BUILD_EXIT_CODE"
    # Clean up staging before exit
    rm -rf "$STAGING_DIR"
    exit $BUILD_EXIT_CODE
fi

# Clean up staging folder
echo "Cleaning up staging folder..."
rm -rf "$STAGING_DIR"

# Step 6: Report results
echo ""
echo "=========================================="
echo "BUILD COMPLETE! (Linux x86_64)"
echo "=========================================="
echo ""
echo "Artifacts created:"
echo "  - Python server: out/dist-linux-x64/voicetree-server/"
echo "  - Server in resources: out/resources-linux-x64/server/"

if [ -d "out/electron-linux-x64" ]; then
    echo "  - Electron app: out/electron-linux-x64/"

    APPIMAGE_FILE=$(find out/electron-linux-x64 -name "*.AppImage" 2>/dev/null | head -1)
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
    echo "To publish, run: ./scripts/build_and_package_linux_x64.sh --publish"
fi
echo ""
echo "Done!"
