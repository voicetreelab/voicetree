#!/bin/bash
#
# Pre-push hook: runs Stage 1 + Stage 2 locally before allowing push.
# Mirrors the CI pipeline in .github/workflows/stage1-checks.yml.
# Bypass with: git push --no-verify
#

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WEBAPP="$REPO_ROOT/webapp"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
fail() { printf "\033[1;31m✗ %s\033[0m\n" "$1"; exit 1; }
pass() { printf "\033[1;32m✓ %s\033[0m\n" "$1"; }

bold "═══ Pre-push: Stage 1 + Stage 2 local verification ═══"
echo ""

# ── Stage 1a: Lint ─────────────────────────────────────────────────────
bold "Stage 1: Lint"
npm run lint --prefix "$REPO_ROOT" || fail "Lint failed"
pass "Lint"

# ── Stage 1b: Typecheck ───────────────────────────────────────────────
bold "Stage 1: Typecheck"
npx tsc --noEmit --project "$WEBAPP/tsconfig.json" || fail "Typecheck failed"
pass "Typecheck"

# ── Stage 1c: E2E taxonomy check ──────────────────────────────────────
bold "Stage 1: E2E taxonomy check"
npm run check:e2e-taxonomy --prefix "$REPO_ROOT" || fail "E2E taxonomy check failed"
pass "E2E taxonomy check"

# ── Stage 1d: Unit & integration tests ────────────────────────────────
bold "Stage 1: Unit & integration tests"
npx vitest run --reporter=verbose || fail "Unit tests failed"
pass "Unit & integration tests"

# ── Stage 2a: Electron build ──────────────────────────────────────────
bold "Stage 2: Electron build"
(cd "$WEBAPP" && npx electron-vite build) || fail "Electron build failed"
pass "Electron build"

# ── Stage 2b: Rebuild native modules ──────────────────────────────────
bold "Stage 2: Rebuild native modules"
(cd "$WEBAPP" && npx @electron/rebuild --only node-pty,electron-trackpad-detect) || fail "Native module rebuild failed"
pass "Native module rebuild"

# ── Stage 2c: Tier 1 E2E smoke tests ─────────────────────────────────
bold "Stage 2: Tier 1 Electron smoke tests"
(cd "$WEBAPP" && npx playwright test --config=playwright-tier1-system.config.ts --reporter=line) || fail "Tier 1 Electron smoke tests failed"
pass "Tier 1 Electron smoke tests"

# ── Stage 2d: Tier 1 Browser smoke tests ──────────────────────────────
bold "Stage 2: Tier 1 Browser smoke tests"
(cd "$WEBAPP" && npx playwright test --config=playwright-ci-smoke.config.ts --reporter=line) || fail "Tier 1 Browser smoke tests failed"
pass "Tier 1 Browser smoke tests"

echo ""
bold "═══ All Stage 1 + Stage 2 checks passed ═══"
