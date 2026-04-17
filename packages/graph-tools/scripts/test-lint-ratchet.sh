#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SEED_FILE="${REPO_ROOT}/packages/graph-model/src/SEED_VIOLATION.ts"
TARGET_PATH="packages/graph-model/src/SEED_VIOLATION.ts"
ESLINT_BIN="${REPO_ROOT}/webapp/node_modules/.bin/eslint"
ESLINT_CONFIG="${REPO_ROOT}/webapp/eslint.config.js"
EXPECTED_MESSAGE="Cytoscape must stay out of @vt/graph-model and @vt/graph-tools"

cleanup() {
  rm -f "${SEED_FILE}"
}

trap cleanup EXIT

if [[ -e "${SEED_FILE}" ]]; then
  echo "Refusing to overwrite existing seed file: ${SEED_FILE}" >&2
  exit 1
fi

mkdir -p "$(dirname "${SEED_FILE}")"
cat <<'EOF' > "${SEED_FILE}"
import cytoscape from 'cytoscape'
export const x = cytoscape
EOF

set +e
OUTPUT="$(
  cd "${REPO_ROOT}" && \
  "${ESLINT_BIN}" \
    --no-error-on-unmatched-pattern \
    --config "${ESLINT_CONFIG}" \
    "${TARGET_PATH}" \
    2>&1
)"
STATUS=$?
set -e

printf '%s\n' "${OUTPUT}"

if [[ ${STATUS} -eq 0 ]]; then
  echo "Expected eslint to fail on the seeded cytoscape import." >&2
  exit 1
fi

if [[ "${OUTPUT}" != *"${TARGET_PATH}"* ]]; then
  echo "Lint output did not reference ${TARGET_PATH}." >&2
  exit 1
fi

if [[ "${OUTPUT}" != *"no-restricted-imports"* ]]; then
  echo "Lint output did not include no-restricted-imports." >&2
  exit 1
fi

if [[ "${OUTPUT}" != *"${EXPECTED_MESSAGE}"* ]]; then
  echo "Lint output did not include the expected Cytoscape restriction message." >&2
  exit 1
fi

cleanup
trap - EXIT

if [[ -e "${SEED_FILE}" ]]; then
  echo "Seed file cleanup failed: ${SEED_FILE}" >&2
  exit 1
fi

echo "Verified lint ratchet for ${TARGET_PATH}."
