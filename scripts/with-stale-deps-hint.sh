#!/usr/bin/env bash
# Runs the given command. On non-zero exit, scans the combined output for
# module-resolution errors that typically mean node_modules is out of sync
# with package.json (e.g. after a pull or branch switch). If matched, prints
# a one-line hint suggesting `npm install`. Otherwise stays silent.
set -uo pipefail

tmp=$(mktemp -t vt-stale-deps-hint.XXXXXX)
trap 'rm -f "$tmp"' EXIT

"$@" 2>&1 | tee "$tmp"
status=${PIPESTATUS[0]}

if [ "$status" -ne 0 ] && grep -qE 'Cannot find package|Cannot find module|ERR_MODULE_NOT_FOUND|legacyMainResolve' "$tmp"; then
  printf '\n\033[33mHint: node_modules may be stale — try `npm install` and rerun.\033[0m\n' >&2
fi

exit "$status"
