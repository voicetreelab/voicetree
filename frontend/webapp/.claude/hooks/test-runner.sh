#!/bin/bash

# Test runner hook for Claude Code
# Runs tests and provides concise feedback, blocking Claude if tests fail

PROJECT_ROOT="/Users/bobbobby/repos/VoiceTree/frontend/webapp"
cd "$PROJECT_ROOT"

# Check if there are any source code changes that would require testing
has_source_changes() {
    local unstaged=$(git diff --name-only -- '*.js' '*.jsx' '*.ts' '*.tsx' '*.json' '*.html' '*.css' 2>/dev/null)
    local staged=$(git diff --cached --name-only -- '*.js' '*.jsx' '*.ts' '*.tsx' '*.json' '*.html' '*.css' 2>/dev/null)

    if [[ -n "$unstaged" ]] || [[ -n "$staged" ]]; then
        return 0
    else
        return 1
    fi
}

# Exit if no source changes
if ! has_source_changes; then
    echo "ℹ️ No source code changes detected, skipping tests"
    exit 0
fi

all_passed=true

# Run unit tests
echo "Running unit tests..."
if npx vitest run 2>&1; then
    echo "✅ Unit tests passed"
else
    echo "❌ Unit tests failed"
    all_passed=false
fi

# Run e2e test
echo ""
echo "Running system e2e test..."

# Build for electron tests
if ! npm run build:test >/dev/null 2>&1; then
    echo "❌ Build failed"
    all_passed=false
else
    # Run the e2e test
    if npx playwright test tests/e2e/full-app/electron-sys-e2e.spec.ts --config=playwright-electron.config.ts --headed=false >/dev/null 2>&1; then
        echo "✅ E2E test passed"
    else
        echo "❌ E2E test failed"
        all_passed=false
    fi
fi

# Final summary
echo ""
echo "=================================================="
if $all_passed; then
    echo "✅ All tests passed!"
    exit 0
else
    echo "❌ Some tests failed!"
    echo ""
    echo "Tests must pass before stopping. Please review and fix the failures."
    exit 2
fi