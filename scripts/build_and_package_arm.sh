#!/bin/bash
# Complete build and package script for VoiceTree with Electron
# This script builds the Python server and packages it with the Electron app
#
# Usage: ./build_and_package_arm.sh [--publish]
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
echo "VoiceTree Complete Build & Package Script"
echo "=========================================="
echo ""

# Check we're in the VoiceTree directory
if [ ! -f "server.py" ]; then
    echo "❌ Error: This script must be run from the VoiceTree root directory"
    exit 1
fi

## Step 1: Build the Python server executable
#echo "📦 Step 1: Building Python server executable..."
#echo "----------------------------------------------"
./scripts/build_server.sh

if [ ! -f "out/resources/server/voicetree-server" ]; then
    echo "❌ Error: Server build failed or not copied to out/resources/server/"
    exit 1
fi

# Verify ARM architecture
echo "Verifying binary architecture..."
ARCH=$(file out/resources/server/voicetree-server | grep -o "arm64" || echo "")
if [ -z "$ARCH" ]; then
    echo "WARNING: Binary may not be arm64. Check the output above."
else
    echo "✅ Confirmed: Binary is arm64 (ARM)"
fi

# Step 1.5: Copy agent tools and backend modules to out/resources
echo ""
echo "📦 Step 1.5: Copying agent tools and backend modules to out/resources..."
echo "----------------------------------------------"

# Copy tools
mkdir -p ./out/resources/tools
shopt -s dotglob
cp -r ./tools/* ./out/resources/tools/
shopt -u dotglob
echo "✅ Tools copied to out/resources/tools/"

# Copy backend modules needed by tools
mkdir -p ./out/resources/backend
cp -r ./backend/context_retrieval ./out/resources/backend/
cp -r ./backend/markdown_tree_manager ./out/resources/backend/
cp ./backend/__init__.py ./out/resources/backend/
cp ./backend/types.py ./out/resources/backend/
cp ./backend/settings.py ./out/resources/backend/
cp ./backend/logging_config.py ./out/resources/backend/
echo "✅ Backend modules copied to out/resources/backend/"
echo "   - context_retrieval/"
echo "   - markdown_tree_manager/"
echo "   - types.py, settings.py, logging_config.py"

# NOTE electron/tools-setup.ts COPIES THIS TO ~/Library/"Application\ Support"/

# Step 2: Navigate to frontend
echo ""
echo "📱 Step 2: Building Electron frontend..."
echo "----------------------------------------------"
cd frontend/webapp

# Step 3: Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

# Step 4: Build frontend
echo "Building frontend assets..."
npm run build:test  # Using build:test to skip TypeScript errors for now

# Step 5: Test that everything works
#echo ""
#echo "🧪 Step 3: Testing integrated app..."
#echo "----------------------------------------------"
#echo "Starting Electron with integrated server for 10 seconds..."

## Start Electron in background
#npm run electron:prod &
#ELECTRON_PID=$!
#
## Wait and test
#sleep 15
#
#
## Check if server is responding
#if curl -s http://localhost:8001/health > /dev/null 2>&1; then
#    echo "✅ Server health check passed!"
#    HEALTH_RESPONSE=$(curl -s http://localhost:8001/health)
#    echo "   Response: $HEALTH_RESPONSE"
#else
#    echo "❌ Server health check failed"
#    # Kill Electron and all child processes
#    pkill -P $ELECTRON_PID 2>/dev/null || true
#    kill $ELECTRON_PID 2>/dev/null || true
#fi
#
## Kill test instance - kill all child processes first, then Electron
#pkill -P $ELECTRON_PID 2>/dev/null || true
#kill $ELECTRON_PID 2>/dev/null || true
#echo "Test completed successfully"
#
# Step 6: Build distributable
echo ""
echo "📦 Step 4: Creating distributable package..."
echo "----------------------------------------------"
echo "Building Electron distributable (this may take a few minutes)..."

# Clean previous ARM builds in root
cd ../..
rm -rf out/electron-arm
rm -rf out/electron  # Also clean main electron folder to avoid mixing with other platform artifacts

# Build the distributable from frontend
cd frontend/webapp

# Load environment variables for code signing and notarization
if [ -f ".env" ]; then
  echo "Loading credentials from .env..."
  export $(grep -E '^(APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID|GH_TOKEN)=' .env | xargs)
fi

# Update file modification times to satisfy codesign timestamp validation
echo "Updating file timestamps for codesign..."
cd ../..
find out/resources -type f -exec touch {} +
cd frontend/webapp
echo "✅ File timestamps updated"

# Capture exit code so mv always runs even if publish fails
BUILD_EXIT_CODE=0
if [ "$PUBLISH" = true ]; then
    echo "Publishing enabled - will upload to GitHub releases"
    npm run electron:dist-and-publish || BUILD_EXIT_CODE=$?
else
    npm run electron:dist || BUILD_EXIT_CODE=$?
fi

# Always move the output to arm-specific folder (even if publish failed)
cd ../..
if [ -d "out/electron" ]; then
    mv out/electron out/electron-arm
fi

# Exit with original code if build/publish failed
if [ $BUILD_EXIT_CODE -ne 0 ]; then
    echo "Build or publish step failed with exit code $BUILD_EXIT_CODE"
    exit $BUILD_EXIT_CODE
fi

cd frontend/webapp

# Step 7: Report results
echo ""
echo "=========================================="
echo "✅ BUILD COMPLETE!"
echo "=========================================="
echo ""
echo "Artifacts created:"
echo "  • Python server: ../../out/dist-arm/voicetree-server/"
echo "  • Server in resources: ../../out/resources/server/"

if [ -d "../../out/electron-arm" ]; then
    echo "  • Electron app: ../../out/electron-arm/"

    # List the actual built files
    if [ "$(uname)" == "Darwin" ]; then
        DMG_FILE=$(find ../../out/electron-arm -name "voicetree-arm64.dmg" 2>/dev/null | head -1)
        if [ -n "$DMG_FILE" ]; then
            echo ""
            echo "🎉 Distributable package ready:"
            echo "   $DMG_FILE"
            echo ""
            echo "   This DMG contains the complete VoiceTree app with integrated server!"
            echo "   Users can install it without needing Python or any dependencies."
        fi
    elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
        APPIMAGE_FILE=$(find ../../out/electron-arm -name "*.AppImage" 2>/dev/null | head -1)
        if [ -n "$APPIMAGE_FILE" ]; then
            echo ""
            echo "🎉 Distributable package ready:"
            echo "   $APPIMAGE_FILE"
        fi
    elif [ "$(expr substr $(uname -s) 1 10)" == "MINGW32_NT" ] || [ "$(expr substr $(uname -s) 1 10)" == "MINGW64_NT" ]; then
        EXE_FILE=$(find ../../out/electron-arm -name "*.exe" 2>/dev/null | head -1)
        if [ -n "$EXE_FILE" ]; then
            echo ""
            echo "🎉 Distributable package ready:"
            echo "   $EXE_FILE"
        fi
    fi
fi

echo ""
if [ "$PUBLISH" = true ]; then
    echo "Published to GitHub releases!"
    echo ""
    echo "Note: Homebrew tap update is now handled by build_and_package_all_platforms.sh"
    echo "      to support multi-arch cask generation."
else
    echo "To publish, run: ./scripts/build_and_package_arm.sh --publish"
fi
echo ""
echo "Done! 🚀"
