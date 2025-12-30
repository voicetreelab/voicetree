#!/bin/bash
# Build script for VoiceTree server executable on Linux x86_64 using UV and PyInstaller
# This is a Linux x64-specific version that skips macOS framework fixes

set -e  # Exit on error

echo "Building VoiceTree Server Executable (Linux x86_64)..."
echo "======================================================="

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

# Step 4: Clean previous builds (Linux x64-specific only)
echo "Step 4: Cleaning previous Linux x64 builds..."
rm -rf out/build-linux-x64/
rm -rf out/dist-linux-x64/
rm -rf out/resources-linux-x64/

# Step 5: Build with PyInstaller
echo "Step 5: Building executable with PyInstaller..."
# PyInstaller must run INSIDE the venv to see all dependencies
.venv-server/bin/python -m PyInstaller scripts/server.spec --clean --distpath out/dist-linux-x64 --workpath out/build-linux-x64

# Step 6: Copy to out/resources-linux-x64
echo "Step 6: Copying executable to out/resources-linux-x64/server..."
mkdir -p ./out/resources-linux-x64/server
cp -r ./out/dist-linux-x64/voicetree-server/* ./out/resources-linux-x64/server/
echo "Copied to out/resources-linux-x64/server/"

# Step 7: Skip macOS Python.framework fixes (not needed on Linux)
echo "Step 7: Skipping Python.framework fixes (Linux doesn't use .framework bundles)"

# Step 8: Display results
echo ""
echo "Build complete!"
echo "==============="
echo "Server executable built: ./out/dist-linux-x64/voicetree-server/voicetree-server"
echo "Copied to: ./out/resources-linux-x64/server/"
echo ""
echo "Next steps:"
echo "  1. Test standalone server: ./out/dist-linux-x64/voicetree-server/voicetree-server"
echo "  2. Build full app: ./scripts/build_and_package_linux_x64.sh"
echo ""
echo "The server is now ready to be bundled with the Electron app!"
