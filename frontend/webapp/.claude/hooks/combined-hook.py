#!/usr/bin/env python3
import subprocess
import sys
import fcntl
import os
import time

# Define lock file absolutePath
LOCK_FILE = '/tmp/claude-hook-combined.lock'

# Read stdin once
stdin_data = sys.stdin.read()

# Try to acquire lock with timeout
lock_fd = None
lock_acquired = False
timeout = 180  # 3 minutes max wait
start_time = time.time()

try:
    # Open/create lock file
    lock_fd = open(LOCK_FILE, 'w')

    # Try to acquire exclusive lock with timeout
    while time.time() - start_time < timeout:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            lock_acquired = True
            break
        except BlockingIOError:
            # Lock held by another process, wait a bit
            time.sleep(0.5)

    if not lock_acquired:
        print("Hook timeout: another hook held lock for too long", file=sys.stderr)
        sys.exit(2)

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

    tests_passed = result1.returncode == 0
    checks_passed = result2.returncode == 0
    if not tests_passed or not checks_passed:
        msg_parts = []
        if not tests_passed:
            msg_parts.append("e2e-tests")
        if not checks_passed:
            msg_parts.append("checks")
        failed_sections = " and ".join(msg_parts)
        print(
            f"\n[claude-hook] Warning: {failed_sections} failed, but edits are being preserved.",
            file=sys.stderr,
        )

    # Always allow edits to persist; surface failures via stderr instead.
    sys.exit(0)

finally:
    # Release lock and cleanup
    if lock_fd:
        if lock_acquired:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()
