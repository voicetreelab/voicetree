#!/bin/bash
# Test script for macOS manifest merge
# Tests the yq command used in release.yml to merge ARM64 and x64 manifests

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

echo "Running manifest merge tests in $TEST_DIR"

# Create test manifest files
mkdir -p "$TEST_DIR/manifest-mac-arm64"
mkdir -p "$TEST_DIR/manifest-mac-x64"

cat > "$TEST_DIR/manifest-mac-arm64/latest-mac.yml" << 'EOF'
version: 1.9.21
files:
  - url: Voicetree-1.9.21-arm64-mac.zip
    sha512: rpo0SzVgdNCFi7hhjF0G5OXcVJE1tzy0oKgledt8m4bXqdiEeXioAuTsFFNZQWpimJMu8bAI7Hjr2s2raRoRJw==
    size: 302027208
  - url: voicetree-arm64.dmg
    sha512: LTPQm5N12VfTvmEHpR3jmaEs81VcLDZcCMxH0FjsPziJ7wAGdNkjjxZxDXPv2FsVx6N53V9G4NMrIWNiXiNm1w==
    size: 311782710
path: Voicetree-1.9.21-arm64-mac.zip
sha512: rpo0SzVgdNCFi7hhjF0G5OXcVJE1tzy0oKgledt8m4bXqdiEeXioAuTsFFNZQWpimJMu8bAI7Hjr2s2raRoRJw==
releaseDate: '2026-01-11T09:25:04.591Z'
EOF

cat > "$TEST_DIR/manifest-mac-x64/latest-mac.yml" << 'EOF'
version: 1.9.21
files:
  - url: Voicetree-1.9.21-mac.zip
    sha512: tmAB/Le2J+PX+3CAK35JPtLxW0Bjt2p2/+xEFiyIv67AHG+v9/gs4ifESTUJ7iqKvv0Egb5nSjPRRjCPfXC7Wg==
    size: 318241925
  - url: voicetree-x64.dmg
    sha512: e4/fgzgR3xGy5K9v/2IVzCUwZT1PFRArQCaj+bGeDv8MyEFTmwEAxwHDxnDOleR5QMJ5BPz/UcQU9KILIx/X/w==
    size: 328163002
path: Voicetree-1.9.21-mac.zip
sha512: tmAB/Le2J+PX+3CAK35JPtLxW0Bjt2p2/+xEFiyIv67AHG+v9/gs4ifESTUJ7iqKvv0Egb5nSjPRRjCPfXC7Wg==
releaseDate: '2026-01-11T09:31:54.660Z'
EOF

# Run the merge command (same as in release.yml)
cd "$TEST_DIR"
yq eval-all '
  (select(fileIndex == 0) | .files) as $arm |
  (select(fileIndex == 1) | .files) as $x64 |
  select(fileIndex == 0) |
  .files = ($arm + $x64)
' manifest-mac-arm64/latest-mac.yml manifest-mac-x64/latest-mac.yml > latest-mac.yml

# Test assertions
FAILED=0

echo ""
echo "=== Test Results ==="

# Test 1: Check file count
FILE_COUNT=$(yq '.files | length' latest-mac.yml)
if [ "$FILE_COUNT" -eq 4 ]; then
    echo -e "${GREEN}PASS${NC}: File count is 4"
else
    echo -e "${RED}FAIL${NC}: Expected 4 files, got $FILE_COUNT"
    FAILED=1
fi

# Test 2: Check version is preserved
VERSION=$(yq '.version' latest-mac.yml)
if [ "$VERSION" = "1.9.21" ]; then
    echo -e "${GREEN}PASS${NC}: Version preserved (1.9.21)"
else
    echo -e "${RED}FAIL${NC}: Expected version 1.9.21, got $VERSION"
    FAILED=1
fi

# Test 3: Check releaseDate is preserved
RELEASE_DATE=$(yq '.releaseDate' latest-mac.yml)
if [ "$RELEASE_DATE" = "2026-01-11T09:25:04.591Z" ]; then
    echo -e "${GREEN}PASS${NC}: releaseDate preserved"
else
    echo -e "${RED}FAIL${NC}: releaseDate not preserved, got $RELEASE_DATE"
    FAILED=1
fi

# Test 4: Check ARM64 zip is present
ARM_ZIP=$(yq '.files[] | select(.url == "Voicetree-1.9.21-arm64-mac.zip") | .url' latest-mac.yml)
if [ "$ARM_ZIP" = "Voicetree-1.9.21-arm64-mac.zip" ]; then
    echo -e "${GREEN}PASS${NC}: ARM64 zip present"
else
    echo -e "${RED}FAIL${NC}: ARM64 zip missing"
    FAILED=1
fi

# Test 5: Check ARM64 dmg is present
ARM_DMG=$(yq '.files[] | select(.url == "voicetree-arm64.dmg") | .url' latest-mac.yml)
if [ "$ARM_DMG" = "voicetree-arm64.dmg" ]; then
    echo -e "${GREEN}PASS${NC}: ARM64 dmg present"
else
    echo -e "${RED}FAIL${NC}: ARM64 dmg missing"
    FAILED=1
fi

# Test 6: Check x64 zip is present
X64_ZIP=$(yq '.files[] | select(.url == "Voicetree-1.9.21-mac.zip") | .url' latest-mac.yml)
if [ "$X64_ZIP" = "Voicetree-1.9.21-mac.zip" ]; then
    echo -e "${GREEN}PASS${NC}: x64 zip present"
else
    echo -e "${RED}FAIL${NC}: x64 zip missing"
    FAILED=1
fi

# Test 7: Check x64 dmg is present
X64_DMG=$(yq '.files[] | select(.url == "voicetree-x64.dmg") | .url' latest-mac.yml)
if [ "$X64_DMG" = "voicetree-x64.dmg" ]; then
    echo -e "${GREEN}PASS${NC}: x64 dmg present"
else
    echo -e "${RED}FAIL${NC}: x64 dmg missing"
    FAILED=1
fi

# Test 8: Verify output is valid YAML (not multi-document)
DOC_COUNT=$(yq 'documentIndex' latest-mac.yml 2>/dev/null | wc -l | tr -d ' ')
if [ "$DOC_COUNT" -eq 1 ]; then
    echo -e "${GREEN}PASS${NC}: Single YAML document"
else
    echo -e "${RED}FAIL${NC}: Expected single document, got $DOC_COUNT"
    FAILED=1
fi

# Test 9: Check sha512 hashes are preserved
ARM_SHA=$(yq '.files[0].sha512' latest-mac.yml)
if [ "$ARM_SHA" = "rpo0SzVgdNCFi7hhjF0G5OXcVJE1tzy0oKgledt8m4bXqdiEeXioAuTsFFNZQWpimJMu8bAI7Hjr2s2raRoRJw==" ]; then
    echo -e "${GREEN}PASS${NC}: SHA512 hashes preserved"
else
    echo -e "${RED}FAIL${NC}: SHA512 hash mismatch"
    FAILED=1
fi

echo ""
echo "=== Merged Manifest ==="
cat latest-mac.yml

echo ""
echo "=== Testing that OLD broken syntax produces invalid output ==="

# This is the OLD syntax that was in the workflow - it should NOT work
yq eval-all '
  {"version": .[0].version, "files": (.[0].files + .[1].files), "releaseDate": .[0].releaseDate}
' manifest-mac-arm64/latest-mac.yml manifest-mac-x64/latest-mac.yml > broken-manifest.yml 2>/dev/null || true

# Check if output contains multi-document separator (---) which indicates broken output
# Also check if version is null/missing
HAS_MULTI_DOC=$(grep -c "^---$" broken-manifest.yml 2>/dev/null || echo "0")
BROKEN_VERSION=$(yq -e '.version' broken-manifest.yml 2>/dev/null | head -1)

if [ "$HAS_MULTI_DOC" -gt 0 ] || [ "$BROKEN_VERSION" = "null" ] || [ -z "$BROKEN_VERSION" ]; then
    echo -e "${GREEN}PASS${NC}: Old syntax correctly produces invalid output (multi-doc=$HAS_MULTI_DOC, version=$BROKEN_VERSION)"
    echo "Broken manifest output:"
    cat broken-manifest.yml
else
    echo -e "${RED}FAIL${NC}: Old syntax unexpectedly worked - this test should show it's broken"
    echo "Broken manifest output:"
    cat broken-manifest.yml
    FAILED=1
fi

echo ""
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi
