#!/bin/bash
# Delegates to npm run test:local - capture-ci-checks --tier<=1.
# Bypass with: git push --no-verify
set -euo pipefail
exec npm run test:local
