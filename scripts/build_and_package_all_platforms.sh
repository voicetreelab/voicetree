#!/bin/bash
# Complete build and package script for Voicetree - ALL PLATFORMS
# Builds macOS universal (arm64 + x86_64), Linux ARM64, and Linux x86_64.
#
# Usage: ./build_and_package_all_platforms.sh [--publish]
#
# Platform scripts used:
#   - macOS universal: ./scripts/build_and_package_mac_universal.sh
#   - Linux ARM64:     ./scripts/build_and_package_linux.sh (via OrbStack ARM VM)
#   - Linux x86_64:    ./scripts/build_and_package_linux_x64.sh (via OrbStack x64 VM)
#
# For single-platform builds, use the individual scripts in scripts/.

set -e  # Exit on error

# Parse arguments
PUBLISH=false
for arg in "$@"; do
    case $arg in
        --publish)
            PUBLISH=true
            shift
            ;;
        *)
            echo "Error: Unknown option: $arg"
            exit 1
            ;;
    esac
done

echo "============================================================"
echo "Voicetree Multi-Platform Build & Package Script"
echo "============================================================"
echo ""
echo "Build targets:"
echo "  - macOS Universal (arm64 + x86_64)"
echo "  - Linux ARM64"
echo "  - Linux x86_64"
echo ""
[ "$PUBLISH" = true ] && echo "Publishing: ENABLED (GitHub Releases)"
echo ""

# Check we're in the VoiceTree directory
if [ ! -f "server.py" ]; then
    echo "Error: This script must be run from the Voicetree root directory"
    exit 1
fi

# Get absolute path for OrbStack
VOICETREE_DIR="$(pwd)"

# Check for required tools (non-fatal - just track what's available)
CAN_BUILD_MACOS=true
CAN_BUILD_LINUX_ARM64=true
CAN_BUILD_LINUX_X64=true

check_prerequisites() {
    echo "Checking prerequisites..."

    # macOS universal build requirements
    if [ ! -f "/usr/local/bin/brew" ]; then
        echo "Warning: x86_64 Homebrew not found. Skipping macOS build."
        echo "  Install with: arch -x86_64 /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        CAN_BUILD_MACOS=false
    elif [ ! -f "/usr/local/bin/uv" ]; then
        echo "Warning: x86_64 uv not found. Skipping macOS build."
        echo "  Install with: arch -x86_64 /usr/local/bin/brew install uv"
        CAN_BUILD_MACOS=false
    fi

    # Linux build requirements
    if ! command -v orb &> /dev/null; then
        echo "Warning: OrbStack CLI (orb) not found. Skipping Linux builds."
        echo "  Install OrbStack from: https://orbstack.dev/"
        CAN_BUILD_LINUX_ARM64=false
        CAN_BUILD_LINUX_X64=false
    else
        # Check if Ubuntu ARM VM exists
        if ! orb list | grep -q "ubuntu"; then
            echo "Warning: OrbStack Ubuntu ARM VM not found. Skipping Linux ARM64 build."
            echo "  Create one with: orb create ubuntu ubuntu"
            CAN_BUILD_LINUX_ARM64=false
        fi
        # Check if Ubuntu x64 VM exists
        if ! orb list | grep -q "ubuntu-x64"; then
            echo "Warning: OrbStack Ubuntu x64 VM not found. Skipping Linux x64 build."
            echo "  Create one with: orb create --arch amd64 ubuntu ubuntu-x64"
            CAN_BUILD_LINUX_X64=false
        fi
    fi

    if [ "$CAN_BUILD_MACOS" = false ] && [ "$CAN_BUILD_LINUX_ARM64" = false ] && [ "$CAN_BUILD_LINUX_X64" = false ]; then
        echo "Error: No build targets available. Please set up at least one platform."
        exit 1
    fi

    echo "Prerequisites check complete."
    echo ""
}

check_prerequisites

# Build macOS Universal
build_macos_universal() {
    echo "============================================================"
    echo "Building macOS Universal (arm64 + x86_64)..."
    echo "============================================================"

    PUBLISH_ARG=""
    [ "$PUBLISH" = true ] && PUBLISH_ARG="--publish"

    if ./scripts/build_and_package_mac_universal.sh $PUBLISH_ARG; then
        if [ ! -d "out/electron" ]; then
            echo "macOS universal build completed but no out/electron output found"
            return 1
        fi
        rm -rf out/electron-mac-universal
        mv out/electron out/electron-mac-universal
        echo "macOS universal build complete: out/electron-mac-universal/"
        return 0
    fi

    echo "macOS universal build failed"
    return 1
}

# Build Linux ARM64 (via OrbStack ARM VM)
build_linux_arm64() {
    echo "============================================================"
    echo "Building Linux ARM64 (via OrbStack)..."
    echo "============================================================"

    PUBLISH_ARG=""
    [ "$PUBLISH" = true ] && PUBLISH_ARG="--publish"

    if orb -m ubuntu bash -c "
        source ~/.local/bin/env 2>/dev/null || true
        cd '$VOICETREE_DIR'
        ./scripts/build_and_package_linux.sh $PUBLISH_ARG
    "; then
        APPIMAGE=$(find out/electron-linux -name "*.AppImage" 2>/dev/null | head -1)
        if [ -n "$APPIMAGE" ]; then
            echo "Linux ARM64 build complete: $APPIMAGE"
            return 0
        fi
        echo "Linux ARM64 build completed but no AppImage found in out/electron-linux"
        return 1
    fi

    echo "Linux ARM64 build failed"
    return 1
}

# Build Linux x86_64 (via OrbStack x64 VM)
build_linux_x64() {
    echo "============================================================"
    echo "Building Linux x86_64 (via OrbStack)..."
    echo "============================================================"

    PUBLISH_ARG=""
    [ "$PUBLISH" = true ] && PUBLISH_ARG="--publish"

    if orb -m ubuntu-x64 bash -c "
        source ~/.local/bin/env 2>/dev/null || true
        cd '$VOICETREE_DIR'
        ./scripts/build_and_package_linux_x64.sh $PUBLISH_ARG
    "; then
        APPIMAGE=$(find out/electron-linux-x64 -name "*.AppImage" 2>/dev/null | head -1)
        if [ -n "$APPIMAGE" ]; then
            echo "Linux x86_64 build complete: $APPIMAGE"
            return 0
        fi
        echo "Linux x86_64 build completed but no AppImage found in out/electron-linux-x64"
        return 1
    fi

    echo "Linux x86_64 build failed"
    return 1
}

# Execute builds (only for available platforms)
BUILD_RESULTS=()
BUILD_SUCCEEDED=0
BUILD_FAILED=0

if [ "$CAN_BUILD_MACOS" = true ]; then
    if build_macos_universal; then
        BUILD_RESULTS+=("macOS Universal: SUCCESS")
        ((BUILD_SUCCEEDED++))
    else
        BUILD_RESULTS+=("macOS Universal: FAILED")
        ((BUILD_FAILED++))
    fi
else
    BUILD_RESULTS+=("macOS Universal: SKIPPED (prerequisites not met)")
fi

if [ "$CAN_BUILD_LINUX_ARM64" = true ]; then
    if build_linux_arm64; then
        BUILD_RESULTS+=("Linux ARM64: SUCCESS")
        ((BUILD_SUCCEEDED++))
    else
        BUILD_RESULTS+=("Linux ARM64: FAILED")
        ((BUILD_FAILED++))
    fi
else
    BUILD_RESULTS+=("Linux ARM64: SKIPPED (prerequisites not met)")
fi

if [ "$CAN_BUILD_LINUX_X64" = true ]; then
    if build_linux_x64; then
        BUILD_RESULTS+=("Linux x86_64: SUCCESS")
        ((BUILD_SUCCEEDED++))
    else
        BUILD_RESULTS+=("Linux x86_64: FAILED")
        ((BUILD_FAILED++))
    fi
else
    BUILD_RESULTS+=("Linux x86_64: SKIPPED (prerequisites not met)")
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

DMG=$(find out/electron-mac-universal -name "voicetree-arm64.dmg" 2>/dev/null | head -1)
[ -n "$DMG" ] && echo "  - macOS ARM64 DMG: $DMG"

DMG=$(find out/electron-mac-universal -name "voicetree-x64.dmg" 2>/dev/null | head -1)
[ -n "$DMG" ] && echo "  - macOS Intel DMG: $DMG"

APPIMAGE=$(find out/electron-linux -name "*.AppImage" 2>/dev/null | head -1)
[ -n "$APPIMAGE" ] && echo "  - Linux ARM64 AppImage: $APPIMAGE"

APPIMAGE_X64=$(find out/electron-linux-x64 -name "*.AppImage" 2>/dev/null | head -1)
[ -n "$APPIMAGE_X64" ] && echo "  - Linux x86_64 AppImage: $APPIMAGE_X64"

echo ""
echo "Succeeded: $BUILD_SUCCEEDED, Failed: $BUILD_FAILED"
echo ""

if [ "$BUILD_SUCCEEDED" -eq 0 ]; then
    echo "All builds failed. No artifacts to publish."
    exit 1
fi

if [ "$PUBLISH" = true ]; then
    echo "Artifacts published to GitHub Releases!"

    # Update Homebrew tap with multi-arch cask
    echo ""
    echo "============================================================"
    echo "Updating Homebrew tap with multi-arch cask..."
    echo "============================================================"

    cd webapp
    VERSION=$(node -p "require('./package.json').version")
    cd ..

    ARM_DMG=$(find out/electron-mac-universal -name "voicetree-arm64.dmg" 2>/dev/null | head -1)
    INTEL_DMG=$(find out/electron-mac-universal -name "voicetree-x64.dmg" 2>/dev/null | head -1)

    if [ -z "$ARM_DMG" ] || [ -z "$INTEL_DMG" ]; then
        echo "Skipping Homebrew tap update (macOS DMGs not available)"
        [ -z "$ARM_DMG" ] && echo "  - Missing ARM64 DMG (voicetree-arm64.dmg)"
        [ -z "$INTEL_DMG" ] && echo "  - Missing Intel DMG (voicetree-x64.dmg)"
    else

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
    cat > "$TEMP_TAP/Casks/voicetree.rb" << CASK_EOF
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

  name "Voicetree"
  desc "Transform voice into navigable concept graphs"
  homepage "https://github.com/voicetreelab/voicetree"

  depends_on macos: ">= :monterey"

  app "Voicetree.app"

  postflight do
    system_command "/usr/bin/open", args: ["#{appdir}/Voicetree.app"]
  end

  zap trash: [
    "~/Library/Application Support/VoiceTree",
    "~/Library/Preferences/com.voicetree.webapp.plist",
  ]
end
CASK_EOF

    cd "$TEMP_TAP"
    git add -A
    git commit -m "Update Voicetree to v$VERSION (multi-arch)" || echo "No changes to commit"
    git push
    cd -
    rm -rf "$TEMP_TAP"

    echo "Homebrew tap updated to v$VERSION with multi-arch support"
    fi
else
    echo "To publish all builds, run: ./scripts/build_and_package_all_platforms.sh --publish"
fi

echo ""
if [ "$BUILD_FAILED" -gt 0 ]; then
    echo "Done with $BUILD_FAILED failed build(s)."
    exit 1
else
    echo "Done!"
fi
