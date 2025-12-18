#!/bin/bash
# Complete build and package script for VoiceTree with Electron
# This script builds the Python server and packages it with the Electron app
#
# Usage: ./build_and_package_all.sh [--publish]
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
./build_server.sh

if [ ! -f "dist/resources/server/voicetree-server" ]; then
    echo "❌ Error: Server build failed or not copied to dist/resources/server/"
    exit 1
fi

# Step 1.5: Copy agent tools and backend modules to dist resources
echo ""
echo "📦 Step 1.5: Copying agent tools and backend modules to dist/resources..."
echo "----------------------------------------------"

# Copy tools
mkdir -p ./dist/resources/tools
shopt -s dotglob
cp -r ./tools/* ./dist/resources/tools/
shopt -u dotglob
echo "✅ Tools copied to dist/resources/tools/"

# Copy backend modules needed by tools
mkdir -p ./dist/resources/backend
cp -r ./backend/context_retrieval ./dist/resources/backend/
cp -r ./backend/markdown_tree_manager ./dist/resources/backend/
cp ./backend/__init__.py ./dist/resources/backend/
cp ./backend/types.py ./dist/resources/backend/
cp ./backend/settings.py ./dist/resources/backend/
cp ./backend/logging_config.py ./dist/resources/backend/
echo "✅ Backend modules copied to dist/resources/backend/"
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

# Clean previous builds in root
cd ../..
rm -rf dist/electron

# Build the distributable from frontend
cd frontend/webapp

# Load environment variables for code signing and notarization
if [ -f ".env" ]; then
  echo "Loading Apple code signing credentials from .env..."
  export $(grep -E '^(APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID)=' .env | xargs)
fi

# Update file modification times to satisfy codesign timestamp validation
echo "Updating file timestamps for codesign..."
cd ../..
find dist/resources -type f -exec touch {} +
cd frontend/webapp
echo "✅ File timestamps updated"

if [ "$PUBLISH" = true ]; then
    echo "Publishing enabled - will upload to GitHub releases"
    npm run electron:dist-and-publish
else
    npm run electron:dist
fi

# Step 7: Report results
echo ""
echo "=========================================="
echo "✅ BUILD COMPLETE!"
echo "=========================================="
echo ""
echo "Artifacts created:"
echo "  • Python server: ../../dist/voicetree-server/"
echo "  • Server in resources: ../../dist/resources/server/"

if [ -d "../../dist/electron" ]; then
    echo "  • Electron app: ../../dist/electron/"

    # List the actual built files
    if [ "$(uname)" == "Darwin" ]; then
        DMG_FILE=$(find ../../dist/electron -name "*.dmg" 2>/dev/null | head -1)
        if [ -n "$DMG_FILE" ]; then
            echo ""
            echo "🎉 Distributable package ready:"
            echo "   $DMG_FILE"
            echo ""
            echo "   This DMG contains the complete VoiceTree app with integrated server!"
            echo "   Users can install it without needing Python or any dependencies."
        fi
    elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
        APPIMAGE_FILE=$(find ../../dist/electron -name "*.AppImage" 2>/dev/null | head -1)
        if [ -n "$APPIMAGE_FILE" ]; then
            echo ""
            echo "🎉 Distributable package ready:"
            echo "   $APPIMAGE_FILE"
        fi
    elif [ "$(expr substr $(uname -s) 1 10)" == "MINGW32_NT" ] || [ "$(expr substr $(uname -s) 1 10)" == "MINGW64_NT" ]; then
        EXE_FILE=$(find ../../dist/electron -name "*.exe" 2>/dev/null | head -1)
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

    # Update Homebrew tap
    echo ""
    echo "🍺 Updating Homebrew tap..."
    echo "----------------------------------------------"

    # Get version from package.json
    VERSION=$(node -p "require('./package.json').version")

    # Get SHA256 of the DMG
    DMG_PATH=$(find ../../dist/electron -name "voicetree.dmg" 2>/dev/null | head -1)
    if [ -n "$DMG_PATH" ]; then
        SHA256=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')

        # Clone, update, and push homebrew tap
        TEMP_TAP=$(mktemp -d)
        git clone https://github.com/voicetreelab/homebrew-voicetree.git "$TEMP_TAP"

        # Update the cask file
        cat > "$TEMP_TAP/Casks/voicetree.rb" << EOF
cask "voicetree" do
  version "$VERSION"
  sha256 "$SHA256"

  url "https://github.com/voicetreelab/voicetree/releases/download/v#{version}/voicetree.dmg"
  name "VoiceTree"
  desc "Transform voice into navigable concept graphs"
  homepage "https://github.com/voicetreelab/voicetree"

  depends_on macos: ">= :monterey"

  app "VoiceTree.app"

  zap trash: [
    "~/Library/Application Support/VoiceTree",
    "~/Library/Preferences/com.voicetree.webapp.plist",
  ]
end
EOF

        cd "$TEMP_TAP"
        git add -A
        git commit -m "Update VoiceTree to v$VERSION" || echo "No changes to commit"
        git push
        cd -
        rm -rf "$TEMP_TAP"

        echo "✅ Homebrew tap updated to v$VERSION"
    else
        echo "⚠️  Could not find DMG to calculate SHA256"
    fi
else
    echo "To publish, run: ./build_and_package_all.sh --publish"
fi
echo ""
echo "Done! 🚀"