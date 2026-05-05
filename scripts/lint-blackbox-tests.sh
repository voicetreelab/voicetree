#!/usr/bin/env bash
# Fails if any test file has >50% of its assertions on mock calls.
# This enforces black-box testing: assert on outputs, not implementation.
#
# Usage: ./scripts/lint-blackbox-tests.sh [--threshold 50]

set -euo pipefail

THRESHOLD="${1:-50}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXIT_CODE=0
VIOLATIONS=0

while IFS= read -r f; do
  total=$(grep -c "expect(" "$f" 2>/dev/null || true)
  total="${total:-0}"
  [ "$total" -eq 0 ] && continue

  mock_asserts=$(grep -c -E "toHaveBeenCalled|toHaveBeenNthCalled|toHaveBeenLastCalled|mock[.]calls|mock[.]results" "$f" 2>/dev/null || true)
  mock_asserts="${mock_asserts:-0}"

  pct=$((mock_asserts * 100 / total))
  if [ "$pct" -gt "$THRESHOLD" ]; then
    rel="${f#"$REPO_ROOT/"}"
    echo "FAIL: ${pct}% mock assertions (${mock_asserts}/${total}) in ${rel}"
    EXIT_CODE=1
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(find "$REPO_ROOT/packages" "$REPO_ROOT/webapp/src" \( -name "*.test.ts" -o -name "*.test.tsx" \) -type f)

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "OK: all test files have ≤${THRESHOLD}% mock-call assertions"
else
  echo ""
  echo "FAILED: ${VIOLATIONS} test file(s) exceed ${THRESHOLD}% mock-call assertion threshold."
  echo "Tests should be black-box: call the function, assert on the output."
  echo "See CLAUDE.md for the testing philosophy."
fi

exit "$EXIT_CODE"
