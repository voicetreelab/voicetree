#!/bin/bash
# Build both ARM64 and x86_64 macOS artifacts in a single electron-builder run.
# This keeps latest-mac.yml containing both architectures.

set -e

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

echo "==============================================="
echo "Voicetree macOS Universal Build & Package Script"
echo "==============================================="
echo ""

# Check we're in the VoiceTree directory
if [ ! -f "server.py" ]; then
    echo "Error: This script must be run from the Voicetree root directory"
    exit 1
fi

# Step 1: Build ARM64 server (resources go to out/resources)
echo "Step 1: Building ARM64 server..."
echo "----------------------------------------------"
./scripts/build_server.sh

if [ ! -d "out/resources/server" ]; then
    echo "Error: ARM64 server build failed (out/resources/server missing)"
    exit 1
fi

# Step 1.5: Copy tools and backend modules to out/resources
echo ""
echo "Step 1.5: Copying tools and backend modules..."
echo "----------------------------------------------"

mkdir -p ./out/resources/tools
shopt -s dotglob
cp -r ./tools/* ./out/resources/tools/
shopt -u dotglob

mkdir -p ./out/resources/backend
cp -r ./backend/context_retrieval ./out/resources/backend/
cp -r ./backend/markdown_tree_manager ./out/resources/backend/
cp ./backend/__init__.py ./out/resources/backend/
cp ./backend/types.py ./out/resources/backend/
cp ./backend/settings.py ./out/resources/backend/
cp ./backend/logging_config.py ./out/resources/backend/

echo "Tools and backend modules copied to out/resources/"

# Step 2: Build Intel server (resources go to out/resources-intel)
echo ""
echo "Step 2: Building Intel (x86_64) server..."
echo "----------------------------------------------"
./scripts/build_server_intel.sh

if [ ! -d "out/resources-intel/server" ]; then
    echo "Error: Intel server build failed (out/resources-intel/server missing)"
    exit 1
fi

# Step 3: Build the Electron app for both architectures
echo ""
echo "Step 3: Building Electron app (arm64 + x64)..."
echo "----------------------------------------------"

rm -rf out/electron

cd webapp

if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

echo "Building frontend assets..."
npm run electron:build

# Load credentials
if [ -f ".env" ]; then
  echo "Loading credentials from .env..."
  export $(grep -E '^(APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID|GH_TOKEN)=' .env | xargs)
fi

if [ "$PUBLISH" = true ]; then
    echo "Publishing enabled - will upload to GitHub releases"
    npx electron-builder --mac --arm64 --x64 --publish=always
else
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    npx electron-builder --mac --arm64 --x64 --config -c.mac.identity=null --publish=never
fi

echo ""
echo "=========================================="
echo "BUILD COMPLETE! (macOS universal)"
echo "=========================================="
