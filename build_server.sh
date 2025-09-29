#!/bin/bash
# Build script for VoiceTree server executable using UV and PyInstaller

set -e  # Exit on error

echo "Building VoiceTree Server Executable..."
echo "======================================="

# Step 1: Create isolated UV environment
echo "Step 1: Creating isolated UV environment..."
uv venv .venv-server --python 3.13

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

# Step 6: Copy to frontend resources
echo "Step 6: Copying executable to frontend resources..."
mkdir -p ../frontend/webapp/resources/server
cp -r ./dist/voicetree-server/* ../frontend/webapp/resources/server/
echo "Copied to frontend/webapp/resources/server/"

# Step 7: Display results
echo ""
echo "Build complete!"
echo "==============="
echo "✅ Server executable built: ./dist/voicetree-server/voicetree-server"
echo "✅ Copied to frontend: ../frontend/webapp/resources/server/"
echo ""
echo "Next steps:"
echo "  1. Test standalone server: ./dist/voicetree-server/voicetree-server"
echo "  2. Test in Electron: cd ../frontend/webapp && npm run electron:prod"
echo "  3. Build Electron app: cd ../frontend/webapp && npm run electron:dist"
echo ""
echo "The server is now ready to be bundled with the Electron app!"