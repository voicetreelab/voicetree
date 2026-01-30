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
./scripts/build_server_intel.sh

if [ ! -f "out/resources-intel/server/voicetree-server" ]; then
    echo "Error: Server build failed or not copied to out/resources-intel/server/"
    exit 1
fi

# Step 1.5: Copy agent tools and backend modules to out/resources-intel
echo ""
echo "Step 1.5: Copying agent tools and backend modules to out/resources-intel..."
echo "----------------------------------------------"

# Copy tools
mkdir -p ./out/resources-intel/tools
shopt -s dotglob
cp -r ./tools/* ./out/resources-intel/tools/
shopt -u dotglob
echo "Tools copied to out/resources-intel/tools/"

# Copy backend modules needed by tools
mkdir -p ./out/resources-intel/backend
cp -r ./backend/context_retrieval ./out/resources-intel/backend/
cp -r ./backend/markdown_tree_manager ./out/resources-intel/backend/
cp ./backend/__init__.py ./out/resources-intel/backend/
cp ./backend/types.py ./out/resources-intel/backend/
cp ./backend/settings.py ./out/resources-intel/backend/
cp ./backend/logging_config.py ./out/resources-intel/backend/
echo "Backend modules copied to out/resources-intel/backend/"

# Step 2: Create isolated staging folder for Intel build
# This prevents corrupting the ARM node_modules in webapp
echo ""
echo "Step 2: Creating isolated staging folder for Intel build..."
echo "----------------------------------------------"

STAGING_DIR="build-intel-staging"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

# Copy webapp to staging (excluding node_modules for fresh install)
echo "Copying webapp to staging folder..."
rsync -a --exclude='node_modules' webapp/ "$STAGING_DIR/webapp/"

# Set up out structure that electron-builder expects (../../out/resources from webapp)
mkdir -p "$STAGING_DIR/out"
cp -r out/resources-intel "$STAGING_DIR/out/resources"

# Copy .env if it exists (for code signing credentials)
if [ -f "webapp/.env" ]; then
    cp webapp/.env "$STAGING_DIR/webapp/.env"
fi

# Step 3: Install dependencies and rebuild for x64 in staging
echo ""
echo "Step 3: Installing dependencies and rebuilding for x64..."
echo "----------------------------------------------"
cd "$STAGING_DIR/webapp"

# Fresh install ensures correct architecture
echo "Running npm ci for fresh x64 install..."
npm ci

# Rebuild native modules for x64
echo "Rebuilding native modules for x64..."
arch -x86_64 npm rebuild --arch=x64

# Step 4: Build frontend
echo ""
echo "Step 4: Building frontend assets..."
npm run electron:build

# Step 5: Build distributable for Intel
echo ""
echo "Step 5: Creating Intel distributable package..."
echo "----------------------------------------------"
echo "Building Electron distributable for x64 (this may take a few minutes)..."

# Update file modification times for codesign
echo "Updating file timestamps for codesign..."
find ../out/resources -type f -exec touch {} +
echo "File timestamps updated"

# Load environment variables for code signing and notarization
if [ -f ".env" ]; then
  echo "Loading credentials from .env..."
  export $(grep -E '^(APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID|GH_TOKEN)=' .env | xargs)
fi

# Capture exit code so mv always runs even if publish fails
BUILD_EXIT_CODE=0
if [ "$PUBLISH" = true ]; then
    echo "Publishing enabled - will upload to GitHub releases"
    npx electron-builder --mac --x64 --publish=always || BUILD_EXIT_CODE=$?
else
    # Build for x64 architecture without code signing for local testing
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    npx electron-builder --mac --x64 --config -c.mac.identity=null --publish=never || BUILD_EXIT_CODE=$?
fi

# Move back to project root
cd ..

# Always move the output to intel-specific folder (even if publish failed)
# Note: electron-builder outputs to ../../out/electron (relative to webapp),
# which resolves to VoiceTree/out/electron even from staging directory
rm -rf out/electron-intel
if [ -d "out/electron" ]; then
    mv out/electron out/electron-intel
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

# Restore ARM resources if they exist
if [ -d "out/resources-arm" ]; then
    rm -rf out/resources
    cp -r out/resources-arm out/resources
fi

# Step 6: Report results
echo ""
echo "=========================================="
echo "BUILD COMPLETE! (Intel x86_64)"
echo "=========================================="
echo ""
echo "Artifacts created:"
echo "  - Python server (Intel): out/dist-intel/voicetree-server/"
echo "  - Server in resources: out/resources-intel/server/"

if [ -d "out/electron-intel" ]; then
    echo "  - Electron app (Intel): out/electron-intel/"

    # List the actual built files
    DMG_FILE=$(find out/electron-intel -name "voicetree-x64.dmg" 2>/dev/null | head -1)
    if [ -n "$DMG_FILE" ]; then
        echo ""
        echo "Distributable package ready:"
        echo "   $DMG_FILE"
        echo ""
        echo "   This Intel DMG can be installed on Intel Macs or ARM Macs via Rosetta."

        # Show architecture of the main binary
        APP_PATH=$(find out/electron-intel -name "*.app" -type d 2>/dev/null | head -1)
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
    echo "To publish, run: ./scripts/build_and_package_intel.sh --publish"
fi
echo ""
echo "Done!"
