#!/bin/bash
# Build script for Voicetree server executable using UV and PyInstaller

set -e  # Exit on error

echo "Building Voicetree Server Executable..."
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

# Step 4: Clean previous ARM builds (don't touch Intel/Linux builds)
echo "Step 4: Cleaning previous ARM builds..."
rm -rf out/build-arm/ out/dist-arm/ out/resources/

# Step 5: Build with PyInstaller - use separate dirs to avoid conflicts with Intel/Linux
echo "Step 5: Building executable with PyInstaller..."
# PyInstaller must run INSIDE the venv to see all dependencies
.venv-server/bin/python -m PyInstaller scripts/server.spec --clean --distpath out/dist-arm --workpath out/build-arm

# Step 6: Copy to out/resources
echo "Step 6: Copying executable to out/resources/server..."
mkdir -p ./out/resources/server
cp -r ./out/dist-arm/voicetree-server/* ./out/resources/server/
echo "Copied to out/resources/server/"

# Step 7: Fix Python.framework structure for code signing
echo "Step 7: Fixing Python.framework structure (replace duplicates with symlinks)..."
# PyInstaller creates duplicate directories instead of proper macOS framework symlink structure:
#   - Versions/Current/ is a duplicate directory (should be symlink to 3.13)
#   - Python is a duplicate binary (should be symlink to Versions/Current/Python)
#   - Resources is a duplicate directory (should be symlink to Versions/Current/Resources)
# This causes "bundle format is ambiguous" error during code signing
# Fix 1: Replace Versions/Current directory with symlink to 3.13
rm -rf out/resources/server/_internal/Python.framework/Versions/Current
ln -s 3.13 out/resources/server/_internal/Python.framework/Versions/Current
# Fix 2: Replace Python binary with symlink to Versions/Current/Python
rm -f out/resources/server/_internal/Python.framework/Python
ln -s Versions/Current/Python out/resources/server/_internal/Python.framework/Python
# Fix 3: Replace Resources directory with symlink to Versions/Current/Resources
rm -rf out/resources/server/_internal/Python.framework/Resources
ln -s Versions/Current/Resources out/resources/server/_internal/Python.framework/Resources
echo "✅ Created proper framework symlink structure"

# Step 8: Display results
echo ""
echo "Build complete!"
echo "==============="
echo "✅ Server executable built: ./out/dist-arm/voicetree-server/voicetree-server"
echo "✅ Copied to: ./out/resources/server/"
echo ""
echo "Next steps:"
echo "  1. Test standalone server: ./out/dist-arm/voicetree-server/voicetree-server"
echo "  2. Build full app: ./scripts/build_and_package_arm.sh"
echo ""
echo "The server is now ready to be bundled with the Electron app!"