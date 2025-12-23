#!/bin/bash
# Build script for VoiceTree server executable on Linux using UV and PyInstaller
# This is a Linux-specific version that skips macOS framework fixes

set -e  # Exit on error

echo "Building VoiceTree Server Executable (Linux)..."
echo "================================================"

# Ensure uv is in PATH (installed via astral.sh)
if [ -f "$HOME/.local/bin/env" ]; then
    source "$HOME/.local/bin/env"
fi

# Step 1: Create isolated UV environment
echo "Step 1: Creating isolated UV environment..."
uv venv .venv-server --python 3.13 --clear

# Step 2: Install server dependencies
echo "Step 2: Installing server dependencies..."
uv pip install --python .venv-server -r requirements-server.txt

# Step 3: Install PyInstaller in the same environment
echo "Step 3: Installing PyInstaller..."
uv pip install --python .venv-server pyinstaller

# Step 4: Clean previous builds (Linux-specific only)
echo "Step 4: Cleaning previous Linux builds..."
rm -rf out/build-linux/
rm -rf out/dist-linux/
rm -rf out/resources-linux/

# Step 5: Build with PyInstaller
echo "Step 5: Building executable with PyInstaller..."
# PyInstaller must run INSIDE the venv to see all dependencies
.venv-server/bin/python -m PyInstaller scripts/server.spec --clean --distpath out/dist-linux --workpath out/build-linux

# Step 6: Copy to out/resources-linux
echo "Step 6: Copying executable to out/resources-linux/server..."
mkdir -p ./out/resources-linux/server
cp -r ./out/dist-linux/voicetree-server/* ./out/resources-linux/server/
echo "Copied to out/resources-linux/server/"

# Step 7: Skip macOS Python.framework fixes (not needed on Linux)
echo "Step 7: Skipping Python.framework fixes (Linux doesn't use .framework bundles)"

# Step 8: Display results
echo ""
echo "Build complete!"
echo "==============="
echo "Server executable built: ./out/dist-linux/voicetree-server/voicetree-server"
echo "Copied to: ./out/resources-linux/server/"
echo ""
echo "Next steps:"
echo "  1. Test standalone server: ./out/dist-linux/voicetree-server/voicetree-server"
echo "  2. Build full app: ./scripts/build_and_package_linux.sh"
echo ""
echo "The server is now ready to be bundled with the Electron app!"
