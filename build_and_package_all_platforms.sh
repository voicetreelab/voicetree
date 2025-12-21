#!/bin/bash
# Complete build and package script for VoiceTree - ALL PLATFORMS
# Delegates to platform-specific scripts for actual builds
#
# Usage: ./build_and_package_all_platforms.sh [options]
#   --publish       Upload all builds to GitHub releases
#   --macos-arm     Build only macOS ARM64 (default on Apple Silicon)
#   --macos-intel   Build only macOS Intel x86_64
#   --linux         Build only Linux ARM64 (requires OrbStack)
#   --parallel      Run independent builds in parallel (experimental)
#
# Platform scripts used:
#   - macOS ARM:   ./build_and_package_arm.sh
#   - macOS Intel: ./build_and_package_intel.sh
#   - Linux:       ./build_and_package_linux.sh (via OrbStack)

set -e  # Exit on error

# Parse arguments
PUBLISH=false
BUILD_MACOS_ARM=false
BUILD_MACOS_INTEL=false
BUILD_LINUX=false
PARALLEL=false
SPECIFIC_BUILD=false

for arg in "$@"; do
    case $arg in
        --publish)
            PUBLISH=true
            shift
            ;;
        --macos-arm)
            BUILD_MACOS_ARM=true
            SPECIFIC_BUILD=true
            shift
            ;;
        --macos-intel)
            BUILD_MACOS_INTEL=true
            SPECIFIC_BUILD=true
            shift
            ;;
        --linux)
            BUILD_LINUX=true
            SPECIFIC_BUILD=true
            shift
            ;;
        --parallel)
            PARALLEL=true
            shift
            ;;
    esac
done

# If no specific builds requested, build all
if [ "$SPECIFIC_BUILD" = false ]; then
    BUILD_MACOS_ARM=true
    BUILD_MACOS_INTEL=true
    BUILD_LINUX=true
fi

echo "============================================================"
echo "VoiceTree Multi-Platform Build & Package Script"
echo "============================================================"
echo ""
echo "Build targets:"
[ "$BUILD_MACOS_ARM" = true ] && echo "  - macOS ARM64"
[ "$BUILD_MACOS_INTEL" = true ] && echo "  - macOS Intel x86_64"
[ "$BUILD_LINUX" = true ] && echo "  - Linux ARM64"
echo ""
[ "$PUBLISH" = true ] && echo "Publishing: ENABLED (GitHub Releases)"
[ "$PARALLEL" = true ] && echo "Parallel builds: ENABLED"
echo ""

# Check we're in the VoiceTree directory
if [ ! -f "server.py" ]; then
    echo "Error: This script must be run from the VoiceTree root directory"
    exit 1
fi

# Get absolute path for OrbStack
VOICETREE_DIR="$(pwd)"

# Check for required tools
check_prerequisites() {
    echo "Checking prerequisites..."

    if [ "$BUILD_MACOS_INTEL" = true ]; then
        if [ ! -f "/usr/local/bin/brew" ]; then
            echo "Error: x86_64 Homebrew not found. Required for Intel build."
            echo "Install with: arch -x86_64 /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
            exit 1
        fi
        if [ ! -f "/usr/local/bin/uv" ]; then
            echo "Error: x86_64 uv not found. Required for Intel build."
            echo "Install with: arch -x86_64 /usr/local/bin/brew install uv"
            exit 1
        fi
    fi

    if [ "$BUILD_LINUX" = true ]; then
        if ! command -v orb &> /dev/null; then
            echo "Error: OrbStack CLI (orb) not found. Required for Linux build."
            echo "Install OrbStack from: https://orbstack.dev/"
            exit 1
        fi
        # Check if Ubuntu VM exists
        if ! orb list | grep -q "ubuntu"; then
            echo "Error: OrbStack Ubuntu VM not found."
            echo "Create one with: orb create ubuntu ubuntu"
            exit 1
        fi
    fi

    echo "Prerequisites check passed!"
    echo ""
}

check_prerequisites

# Track build results
BUILD_RESULTS=()

# Build macOS ARM64
build_macos_arm() {
    echo "============================================================"
    echo "Building macOS ARM64..."
    echo "============================================================"

    PUBLISH_ARG=""
    [ "$PUBLISH" = true ] && PUBLISH_ARG="--publish"

    if ./build_and_package_arm.sh $PUBLISH_ARG; then
        # ARM script now outputs directly to dist/electron-arm/
        echo "macOS ARM64 build complete: dist/electron-arm/"
        BUILD_RESULTS+=("macOS ARM64: SUCCESS")
    else
        echo "macOS ARM64 build failed"
        BUILD_RESULTS+=("macOS ARM64: FAILED")
        return 1
    fi
}

# Build macOS Intel x86_64
build_macos_intel() {
    echo "============================================================"
    echo "Building macOS Intel x86_64..."
    echo "============================================================"

    PUBLISH_ARG=""
    [ "$PUBLISH" = true ] && PUBLISH_ARG="--publish"

    if ./build_and_package_intel.sh $PUBLISH_ARG; then
        echo "macOS Intel build complete: dist/electron-intel/"
        BUILD_RESULTS+=("macOS Intel: SUCCESS")
    else
        echo "macOS Intel build failed"
        BUILD_RESULTS+=("macOS Intel: FAILED")
        return 1
    fi
}

# Build Linux ARM64 (via OrbStack)
build_linux() {
    echo "============================================================"
    echo "Building Linux ARM64 (via OrbStack)..."
    echo "============================================================"

    PUBLISH_ARG=""
    [ "$PUBLISH" = true ] && PUBLISH_ARG="--publish"

    # Run the Linux build script inside OrbStack Ubuntu
    if orb -m ubuntu bash -c "
        source ~/.local/bin/env 2>/dev/null || true
        cd '$VOICETREE_DIR'
        ./build_and_package_linux.sh $PUBLISH_ARG
    "; then
        if [ -d "dist/electron-linux" ]; then
            APPIMAGE=$(find dist/electron-linux -name "*.AppImage" 2>/dev/null | head -1)
            if [ -n "$APPIMAGE" ]; then
                echo "Linux ARM64 build complete: $APPIMAGE"
                BUILD_RESULTS+=("Linux ARM64: SUCCESS")
            else
                echo "Linux build completed but no AppImage found"
                BUILD_RESULTS+=("Linux ARM64: PARTIAL (no AppImage)")
            fi
        else
            echo "Linux ARM64 build failed - no output directory"
            BUILD_RESULTS+=("Linux ARM64: FAILED")
            return 1
        fi
    else
        echo "Linux ARM64 build failed"
        BUILD_RESULTS+=("Linux ARM64: FAILED")
        return 1
    fi
}

# Execute builds
if [ "$PARALLEL" = true ]; then
    echo "Running builds in parallel..."
    echo "(Note: parallel mode may have resource conflicts)"
    echo ""

    # Start builds in background
    PIDS=()

    if [ "$BUILD_MACOS_ARM" = true ]; then
        build_macos_arm &
        PIDS+=($!)
    fi

    if [ "$BUILD_MACOS_INTEL" = true ]; then
        build_macos_intel &
        PIDS+=($!)
    fi

    if [ "$BUILD_LINUX" = true ]; then
        build_linux &
        PIDS+=($!)
    fi

    # Wait for all builds
    FAILED=0
    for PID in "${PIDS[@]}"; do
        if ! wait $PID; then
            FAILED=$((FAILED + 1))
        fi
    done

    if [ $FAILED -gt 0 ]; then
        echo "Warning: $FAILED build(s) failed"
    fi
else
    # Sequential builds (safer, recommended)
    if [ "$BUILD_MACOS_ARM" = true ]; then
        build_macos_arm || true
    fi

    if [ "$BUILD_MACOS_INTEL" = true ]; then
        build_macos_intel || true
    fi

    if [ "$BUILD_LINUX" = true ]; then
        build_linux || true
    fi
fi

# Final report
echo ""
echo "============================================================"
echo "BUILD SUMMARY"
echo "============================================================"
for RESULT in "${BUILD_RESULTS[@]}"; do
    echo "  $RESULT"
done
echo ""

# List artifacts
echo "Artifacts created:"
if [ -d "dist/electron-arm" ]; then
    DMG=$(find dist/electron-arm -name "voicetree-arm64.dmg" 2>/dev/null | head -1)
    [ -n "$DMG" ] && echo "  - macOS ARM64 DMG: $DMG"
fi

if [ -d "dist/electron-intel" ]; then
    DMG=$(find dist/electron-intel -name "voicetree-x64.dmg" 2>/dev/null | head -1)
    [ -n "$DMG" ] && echo "  - macOS Intel DMG: $DMG"
fi

if [ -d "dist/electron-linux" ]; then
    APPIMAGE=$(find dist/electron-linux -name "*.AppImage" 2>/dev/null | head -1)
    [ -n "$APPIMAGE" ] && echo "  - Linux AppImage: $APPIMAGE"
fi

echo ""

if [ "$PUBLISH" = true ]; then
    echo "All artifacts published to GitHub Releases!"

    # Update Homebrew tap with multi-arch cask
    echo ""
    echo "============================================================"
    echo "Updating Homebrew tap with multi-arch cask..."
    echo "============================================================"

    cd frontend/webapp
    VERSION=$(node -p "require('./package.json').version")
    cd ../..

    # Find DMGs with architecture-specific names
    ARM_DMG=$(find dist/electron-arm -name "voicetree-arm64.dmg" 2>/dev/null | head -1)
    INTEL_DMG=$(find dist/electron-intel -name "voicetree-x64.dmg" 2>/dev/null | head -1)

    if [ -n "$ARM_DMG" ] && [ -n "$INTEL_DMG" ]; then
        ARM_SHA256=$(shasum -a 256 "$ARM_DMG" | awk '{print $1}')
        INTEL_SHA256=$(shasum -a 256 "$INTEL_DMG" | awk '{print $1}')

        echo "ARM64 DMG: $ARM_DMG"
        echo "  SHA256: $ARM_SHA256"
        echo "Intel DMG: $INTEL_DMG"
        echo "  SHA256: $INTEL_SHA256"

        # Clone, update, and push homebrew tap
        TEMP_TAP=$(mktemp -d)
        git clone https://github.com/voicetreelab/homebrew-voicetree.git "$TEMP_TAP"

        # Generate multi-arch cask
        cat > "$TEMP_TAP/Casks/voicetree.rb" << EOF
cask "voicetree" do
  version "$VERSION"

  on_arm do
    sha256 "$ARM_SHA256"
    url "https://github.com/voicetreelab/voicetree/releases/download/v#{version}/voicetree-arm64.dmg"
  end

  on_intel do
    sha256 "$INTEL_SHA256"
    url "https://github.com/voicetreelab/voicetree/releases/download/v#{version}/voicetree-x64.dmg"
  end

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
        git commit -m "Update VoiceTree to v$VERSION (multi-arch)" || echo "No changes to commit"
        git push
        cd -
        rm -rf "$TEMP_TAP"

        echo "Homebrew tap updated to v$VERSION with multi-arch support"
    else
        echo "Warning: Could not find both architecture DMGs for Homebrew tap update"
        [ -z "$ARM_DMG" ] && echo "  - Missing ARM64 DMG (voicetree-arm64.dmg)"
        [ -z "$INTEL_DMG" ] && echo "  - Missing Intel DMG (voicetree-x64.dmg)"
        echo "Homebrew tap was not updated."
    fi
else
    echo "To publish all builds, run: ./build_and_package_all_platforms.sh --publish"
fi

echo ""
echo "Done!"
