#!/bin/bash

# Set VOICETREE_ROOT to current directory if not already set
export VOICETREE_ROOT="${VOICETREE_ROOT:-$(pwd)}"

# Track overall status
EXIT_CODE=0

echo "Running type safety check..."
python tools/check_typing.py --exclude-tests || EXIT_CODE=1

echo ""
echo "Running MyPy..."
mypy backend/ --exclude backend/tests/ || EXIT_CODE=1

echo ""
echo "Running Ruff..."
ruff check backend/ --exclude backend/tests/ || EXIT_CODE=1

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ All checks passed!"
else
    echo ""
    echo "❌ Some checks failed. Please fix the issues above."
fi

exit $EXIT_CODE