#!/bin/bash
#
# Pre-push hook: runs Stage 1 + Stage 2 locally before allowing push.
# Mirrors the CI pipeline in .github/workflows/stage1-checks.yml.
# Bypass with: git push --no-verify
#

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WEBAPP="$REPO_ROOT/webapp"
LOG_DIR="$REPO_ROOT/health-dashboard/reports"
LOG_FILE="$LOG_DIR/pre-push.log"
mkdir -p "$LOG_DIR"
: > "$LOG_FILE"

exec > >(tee -a "$LOG_FILE") 2>&1

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
fail() {
  printf "\033[1;31m✗ %s\033[0m\n" "$1"
  printf "\033[1;31m  Full output: %s\033[0m\n" "$LOG_FILE"
  exit 1
}
pass() { printf "\033[1;32m✓ %s\033[0m\n" "$1"; }

bold "═══ Pre-push: Stage 1 + Stage 2 local verification ═══"
echo "Log file: $LOG_FILE"
echo ""

# ── Pre-flight: CLAUDE.md / AGENTS.md must be byte-identical ──────────
bold "Pre-flight: CLAUDE.md / AGENTS.md sync"
if ! diff -q "$REPO_ROOT/CLAUDE.md" "$REPO_ROOT/AGENTS.md" >/dev/null 2>&1; then
  echo "CLAUDE.md and AGENTS.md differ. They must be identical."
  echo "Reconcile them (e.g. cp CLAUDE.md AGENTS.md), commit, then push again."
  echo "Bypass with: git push --no-verify"
  fail "CLAUDE.md / AGENTS.md out of sync"
fi
pass "CLAUDE.md / AGENTS.md in sync"

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
RESOURCE_HEAVY_VITEST_FILES=(
  "packages/systems/graph-db-server/tests/vt-graphd-bin.test.ts"
  "webapp/src/shell/edge/main/runtime/mcp-server/integration-tests/fakeAgentSendMessageE2E.test.ts"
)
RESOURCE_HEAVY_VITEST_EXCLUDES=()
for test_file in "${RESOURCE_HEAVY_VITEST_FILES[@]}"; do
  RESOURCE_HEAVY_VITEST_EXCLUDES+=(--exclude "$test_file")
done
npx vitest run --reporter=verbose "${RESOURCE_HEAVY_VITEST_EXCLUDES[@]}" || fail "Unit tests failed"
npx vitest run --reporter=verbose --maxWorkers=1 "${RESOURCE_HEAVY_VITEST_FILES[@]}" || fail "Resource-heavy integration tests failed"
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
# Use the canonical workspace script: it wraps playwright in xvfb-run on
# headless Linux (e.g. Onidel) via the measures run-with-xvfb-if-needed runner.
bold "Stage 2: Tier 1 Electron smoke tests"
(cd "$WEBAPP" && npm run pretest:e2e:tier1) || fail "Fake agent build failed"
(cd "$WEBAPP" && npm run test:e2e:tier1:run -- --reporter=line) || fail "Tier 1 Electron smoke tests failed"
pass "Tier 1 Electron smoke tests"

# ── Stage 2d: Tier 1 Browser smoke tests ──────────────────────────────
bold "Stage 2: Tier 1 Browser smoke tests"
(cd "$WEBAPP" && npx playwright test --config=playwright-ci-smoke.config.ts --reporter=line) || fail "Tier 1 Browser smoke tests failed"
pass "Tier 1 Browser smoke tests"

echo ""
bold "═══ All Stage 1 + Stage 2 checks passed ═══"
