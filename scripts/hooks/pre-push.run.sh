#!/bin/bash
# Wraps the real pre-push impl in record-run so duration + status land on the
# health dashboard. Runs on whichever machine run-remote.mjs lands on (laptop
# or dev box). Paths are cwd-relative — git invokes hooks with cwd = repo root.
set -e
exec node --no-warnings=ExperimentalWarning --experimental-strip-types \
  packages/measures/src/_runners/record-run.ts \
  --id=git-pre-push \
  --name="Git pre-push (tier <=1)" \
  --category=Hook \
  --display="scripts/hooks/pre-push" \
  -- bash scripts/hooks/pre-push.impl.sh "$@"
