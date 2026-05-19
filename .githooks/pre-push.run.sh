#!/bin/bash
# Thin wrapper: runs the real pre-push and records duration + status to the
# health dashboard. Bypass with `git push --no-verify`.
set -e
REPO_ROOT="$(git rev-parse --show-toplevel)"
exec node --no-warnings=ExperimentalWarning --experimental-strip-types \
  "$REPO_ROOT/scripts/record-run.mjs" \
  --id=git-pre-push \
  --name="Git pre-push (Stage 1 + Stage 2)" \
  --category=Hook \
  --display=".githooks/pre-push" \
  -- "$REPO_ROOT/.githooks/pre-push.impl.sh" "$@"
