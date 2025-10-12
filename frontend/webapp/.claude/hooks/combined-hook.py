#!/usr/bin/env python3
import subprocess
import sys

# Read stdin once
stdin_data = sys.stdin.read()

# Run test-runner.sh
result1 = subprocess.run(
    ['.claude/hooks/test-runner.sh'],
    input=stdin_data,
    text=True,
    capture_output=True
)

# Print output from first hook
if result1.stdout:
    print(result1.stdout, end='')
if result1.stderr:
    print(result1.stderr, end='', file=sys.stderr)

# Run file-check-runner.sh
result2 = subprocess.run(
    ['.claude/hooks/file-check-runner.sh'],
    input=stdin_data,
    text=True,
    capture_output=True
)

# Print output from second hook
if result2.stdout:
    print(result2.stdout, end='')
if result2.stderr:
    print(result2.stderr, end='', file=sys.stderr)

# Return 0 if both succeeded, 2 otherwise
sys.exit(0 if (result1.returncode == 0 and result2.returncode == 0) else 2)
