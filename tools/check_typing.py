#!/usr/bin/env python3
"""
Dead simple string literal dict key checker.
"""

import subprocess
import sys
from pathlib import Path


def main():
    """Check for string literal dict keys using ripgrep."""
    import os

    voicetree_root = os.getenv('VOICETREE_ROOT', os.getcwd())
    backend_dir = Path(voicetree_root) / 'backend'

    print("=" * 60)
    print("Checking for string literal dict keys")
    print("=" * 60)

    # Use ripgrep to find pattern: word['string'] or word["string"]
    # \w+\[['""][^'"]+['"]\]
    result = subprocess.run(
        [
            '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/arm64-darwin/rg',
            r"\w+\[['\"][^'\"]+['\"]\]",  # Matches: variable['key'] or variable["key"]
            str(backend_dir),
            '--type', 'py',
            '--glob', '!tests/',  # Exclude tests
            '--glob', '!test_*.py',
            '-n'  # Show line numbers
        ],
        capture_output=True,
        text=True
    )

    if result.returncode == 0:
        # Found violations
        lines = result.stdout.strip().split('\n')
        print(f"\n❌ Found {len(lines)} string literal dict key violations:\n")

        # Show first 20 violations
        for line in lines:
            print(f"  {line}")

        print("\n💡 Fix: Use TypedDict, dataclass, pydantic (at api boundaries / user input) or variable keys instead")
        return 1
    else:
        print("\n✅ No string literal dict keys found!")
        return 0


if __name__ == "__main__":
    sys.exit(main())