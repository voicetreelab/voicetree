#!/bin/bash
# Build script for VoiceTree server executable for Intel (x86_64) on Apple Silicon
# This runs under Rosetta 2 to produce an Intel-compatible binary

set -e  # Exit on error

echo "Building VoiceTree Server Executable (Intel x86_64)..."
echo "======================================================="

# Check if running on Apple Silicon
if [ "$(uname -m)" != "arm64" ]; then
    echo "Warning: This script is designed for Apple Silicon Macs."
    echo "On Intel Macs, use build_server.sh instead."
fi

# Check for x86_64 Homebrew installation
X86_BREW="/usr/local/bin/brew"
if [ ! -f "$X86_BREW" ]; then
    echo ""
    echo "ERROR: x86_64 Homebrew not found at /usr/local/bin/brew"
    echo ""
    echo "To install x86_64 Homebrew, run:"
    echo '  arch -x86_64 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    echo ""
    echo "Then install uv:"
    echo "  arch -x86_64 /usr/local/bin/brew install uv"
    exit 1
fi

# Check for x86_64 uv
X86_UV="/usr/local/bin/uv"
if [ ! -f "$X86_UV" ]; then
    echo ""
    echo "ERROR: x86_64 uv not found at /usr/local/bin/uv"
    echo ""
    echo "To install, run:"
    echo "  arch -x86_64 /usr/local/bin/brew install uv"
    exit 1
fi

# Check for x86_64 Python
X86_PYTHON="/usr/local/bin/python3.13"
if [ ! -f "$X86_PYTHON" ]; then
    echo ""
    echo "ERROR: x86_64 Python not found at /usr/local/bin/python3.13"
    echo ""
    echo "To install, run:"
    echo "  arch -x86_64 /usr/local/bin/brew install python@3.13"
    exit 1
fi

echo "Using x86_64 uv at: $X86_UV"
arch -x86_64 $X86_UV --version
echo "Using x86_64 Python at: $X86_PYTHON"
arch -x86_64 $X86_PYTHON --version

# Step 1: Create isolated UV environment (x86_64)
echo ""
echo "Step 1: Creating isolated x86_64 UV environment..."
arch -x86_64 $X86_UV venv .venv-server-intel --python $X86_PYTHON --clear

# Step 2: Install server dependencies
echo "Step 2: Installing server dependencies..."
arch -x86_64 $X86_UV pip install --python .venv-server-intel -r requirements-server.txt

# Step 3: Install PyInstaller in the same environment
echo "Step 3: Installing PyInstaller..."
arch -x86_64 $X86_UV pip install --python .venv-server-intel pyinstaller

# Step 4: Clean previous Intel builds (don't touch ARM builds)
echo "Step 4: Cleaning previous Intel builds..."
rm -rf out/build-intel/ out/dist-intel/ out/resources-intel/

# Step 5: Build with PyInstaller (under Rosetta) - use separate dirs to avoid conflicts
echo "Step 5: Building executable with PyInstaller (x86_64)..."
arch -x86_64 .venv-server-intel/bin/python -m PyInstaller scripts/server.spec --clean --distpath out/dist-intel --workpath out/build-intel

# Verify architecture
echo ""
echo "Verifying binary architecture..."
file ./out/dist-intel/voicetree-server/voicetree-server
ARCH=$(file ./out/dist-intel/voicetree-server/voicetree-server | grep -o "x86_64" || echo "")
if [ -z "$ARCH" ]; then
    echo "WARNING: Binary may not be x86_64. Check the output above."
else
    echo "Confirmed: Binary is x86_64 (Intel)"
fi

# Step 6: Copy to out/resources-intel
echo ""
echo "Step 6: Copying executable to out/resources-intel/server..."
mkdir -p ./out/resources-intel/server
cp -r ./out/dist-intel/voicetree-server/* ./out/resources-intel/server/
echo "Copied to out/resources-intel/server/"

# Step 7: Fix Python.framework structure for code signing
echo "Step 7: Fixing Python.framework structure (replace duplicates with symlinks)..."
# PyInstaller creates duplicate directories instead of proper macOS framework symlink structure
# Fix 1: Replace Versions/Current directory with symlink to 3.13
rm -rf out/resources-intel/server/_internal/Python.framework/Versions/Current
ln -s 3.13 out/resources-intel/server/_internal/Python.framework/Versions/Current
# Fix 2: Replace Python binary with symlink to Versions/Current/Python
rm -f out/resources-intel/server/_internal/Python.framework/Python
ln -s Versions/Current/Python out/resources-intel/server/_internal/Python.framework/Python
# Fix 3: Replace Resources directory with symlink to Versions/Current/Resources
rm -rf out/resources-intel/server/_internal/Python.framework/Resources
ln -s Versions/Current/Resources out/resources-intel/server/_internal/Python.framework/Resources
echo "Created proper framework symlink structure"

# Step 8: Display results
echo ""
echo "Build complete!"
echo "==============="
echo "Server executable (Intel x86_64): ./out/dist-intel/voicetree-server/voicetree-server"
echo "Copied to: ./out/resources-intel/server/"
echo ""
echo "Next steps:"
echo "  1. Test standalone server: arch -x86_64 ./out/dist-intel/voicetree-server/voicetree-server"
echo "  2. Build full Intel app: ./scripts/build_and_package_intel.sh"
echo ""
echo "The Intel server is ready to be bundled with the Electron app!"
