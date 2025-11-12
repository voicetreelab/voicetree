#!/bin/bash
# Build script for VoiceTree server executable using UV and PyInstaller

set -e  # Exit on error

echo "Building VoiceTree Server Executable..."
echo "======================================="

# Step 1: Create isolated UV environment
echo "Step 1: Creating isolated UV environment..."
uv venv .venv-server --python 3.13 --clear

# Step 2: Install server dependencies
echo "Step 2: Installing server dependencies..."
uv pip install --python .venv-server -r requirements-server.txt

# Step 3: Install PyInstaller in the same environment
echo "Step 3: Installing PyInstaller..."
uv pip install --python .venv-server pyinstaller

# Step 4: Clean previous builds
echo "Step 4: Cleaning previous builds..."
rm -rf build/ dist/

# Step 5: Build with PyInstaller
echo "Step 5: Building executable with PyInstaller..."
# PyInstaller must run INSIDE the venv to see all dependencies
.venv-server/bin/python -m PyInstaller server.spec --clean

# Step 6: Fix Python.framework structure for code signing
echo "Step 6: Fixing Python.framework structure (replace duplicate with symlink)..."
# PyInstaller creates both Python.framework/Python and Python.framework/Versions/3.13/Python
# This causes "bundle format is ambiguous" error during code signing
# Replace the duplicate binary with a proper symlink to match macOS framework structure
rm -f dist/voicetree-server/_internal/Python.framework/Python
ln -s Versions/Current/Python dist/voicetree-server/_internal/Python.framework/Python
echo "✅ Created proper framework symlink structure"

# Step 7: Copy to root dist resources
echo "Step 7: Copying executable to root dist/resources/server..."
mkdir -p ./dist/resources/server
cp -r ./dist/voicetree-server/* ./dist/resources/server/
echo "Copied to dist/resources/server/"

# Step 8: Display results
echo ""
echo "Build complete!"
echo "==============="
echo "✅ Server executable built: ./dist/voicetree-server/voicetree-server"
echo "✅ Copied to root dist: ./dist/resources/server/"
echo ""
echo "Next steps:"
echo "  1. Test standalone server: ./dist/voicetree-server/voicetree-server"
echo "  2. Build full app: ./build_and_package_all.sh"
echo ""
echo "The server is now ready to be bundled with the Electron app!"