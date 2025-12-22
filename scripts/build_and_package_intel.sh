#!/bin/bash
# Complete build and package script for VoiceTree Intel (x86_64) on Apple Silicon
# This script builds the Python server and packages it with the Electron app for Intel Macs
#
# Usage: ./build_and_package_intel.sh [--publish]
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

echo "=================================================="
echo "VoiceTree Intel (x86_64) Build & Package Script"
echo "=================================================="
echo ""

# Check we're in the VoiceTree directory
if [ ! -f "server.py" ]; then
    echo "Error: This script must be run from the VoiceTree root directory"
    exit 1
fi

# Check if running on Apple Silicon
if [ "$(uname -m)" != "arm64" ]; then
    echo "Warning: This script is designed for Apple Silicon Macs."
    echo "On Intel Macs, use build_and_package_arm.sh instead."
fi

## Step 1: Build the Python server executable (Intel)
echo "Step 1: Building Python server executable (Intel x86_64)..."
echo "----------------------------------------------"
./build_server_intel.sh

if [ ! -f "dist/resources-intel/server/voicetree-server" ]; then
    echo "Error: Server build failed or not copied to dist/resources-intel/server/"
    exit 1
fi

# Step 1.5: Copy agent tools and backend modules to dist resources
echo ""
echo "Step 1.5: Copying agent tools and backend modules to dist/resources-intel..."
echo "----------------------------------------------"

# Copy tools
mkdir -p ./dist/resources-intel/tools
shopt -s dotglob
cp -r ./tools/* ./dist/resources-intel/tools/
shopt -u dotglob
echo "Tools copied to dist/resources-intel/tools/"

# Copy backend modules needed by tools
mkdir -p ./dist/resources-intel/backend
cp -r ./backend/context_retrieval ./dist/resources-intel/backend/
cp -r ./backend/markdown_tree_manager ./dist/resources-intel/backend/
cp ./backend/__init__.py ./dist/resources-intel/backend/
cp ./backend/types.py ./dist/resources-intel/backend/
cp ./backend/settings.py ./dist/resources-intel/backend/
cp ./backend/logging_config.py ./dist/resources-intel/backend/
echo "Backend modules copied to dist/resources-intel/backend/"

# Step 2: Navigate to frontend
echo ""
echo "Step 2: Preparing Electron frontend for Intel build..."
echo "----------------------------------------------"
cd frontend/webapp

# Step 3: Clean and reinstall node_modules for x64 architecture
echo "Step 3: Rebuilding native modules for x64..."
echo "----------------------------------------------"

# Rebuild native modules (node-pty) for x64
# This uses electron-rebuild which handles cross-compilation
echo "Rebuilding node-pty and other native modules for x64..."
arch -x86_64 npm rebuild --arch=x64

# Step 4: Build frontend
echo ""
echo "Step 4: Building frontend assets..."
npm run electron:build  # Skip smoke tests - they run ARM Electron against x86_64 node-pty

# Step 5: Build distributable for Intel
echo ""
echo "Step 5: Creating Intel distributable package..."
echo "----------------------------------------------"
echo "Building Electron distributable for x64 (this may take a few minutes)..."

# Clean previous builds
cd ../..
rm -rf dist/electron-intel

# Update file modification times for codesign
echo "Updating file timestamps for codesign..."
find dist/resources-intel -type f -exec touch {} +
echo "File timestamps updated"

cd frontend/webapp

# Load environment variables for code signing and notarization
if [ -f ".env" ]; then
  echo "Loading Apple code signing credentials from .env..."
  export $(grep -E '^(APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID)=' .env | xargs)
fi

# Copy Intel resources to the standard location for electron-builder
# electron-builder expects resources at ../../dist/resources
echo "Preparing Intel resources for electron-builder..."
rm -rf ../../dist/resources
cp -r ../../dist/resources-intel ../../dist/resources

if [ "$PUBLISH" = true ]; then
    echo "Publishing enabled - will upload to GitHub releases"
    # Build for x64 architecture and publish
    npm run electron:build
    npx electron-builder --mac --x64 --publish=always
else
    # Build for x64 architecture without code signing for local testing
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    npm run electron:build
    npx electron-builder --mac --x64 --config -c.mac.identity=null --publish=never
fi

# Move the output to intel-specific folder
cd ../..
if [ -d "dist/electron" ]; then
    mv dist/electron dist/electron-intel
fi

# Restore ARM resources if they exist
if [ -d "dist/resources-arm" ]; then
    rm -rf dist/resources
    cp -r dist/resources-arm dist/resources
fi

# Step 6: Report results
echo ""
echo "=========================================="
echo "BUILD COMPLETE! (Intel x86_64)"
echo "=========================================="
echo ""
echo "Artifacts created:"
echo "  - Python server (Intel): dist/voicetree-server/"
echo "  - Server in resources: dist/resources-intel/server/"

if [ -d "dist/electron-intel" ]; then
    echo "  - Electron app (Intel): dist/electron-intel/"

    # List the actual built files
    DMG_FILE=$(find dist/electron-intel -name "voicetree-x64.dmg" 2>/dev/null | head -1)
    if [ -n "$DMG_FILE" ]; then
        echo ""
        echo "Distributable package ready:"
        echo "   $DMG_FILE"
        echo ""
        echo "   This Intel DMG can be installed on Intel Macs or ARM Macs via Rosetta."

        # Show architecture of the main binary
        APP_PATH=$(find dist/electron-intel -name "*.app" -type d 2>/dev/null | head -1)
        if [ -n "$APP_PATH" ]; then
            MAIN_BINARY="$APP_PATH/Contents/MacOS/VoiceTree"
            if [ -f "$MAIN_BINARY" ]; then
                echo ""
                echo "Binary architecture verification:"
                file "$MAIN_BINARY" | grep -o "x86_64\|arm64" || echo "   (could not determine)"
            fi
        fi
    fi
fi

echo ""
if [ "$PUBLISH" = true ]; then
    echo "Published to GitHub releases!"
else
    echo "To publish, run: ./build_and_package_intel.sh --publish"
fi
echo ""
echo "Done!"
