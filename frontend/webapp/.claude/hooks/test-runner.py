#!/usr/bin/env python3
"""
Test runner hook for Claude Code.
Runs tests and provides concise feedback, blocking Claude if tests fail.
"""
import json
import subprocess
import sys
import re
import os
import time


def has_source_code_changes():
    """Check if there are any source code changes that would require testing."""
    try:
        # Check for unstaged changes in source files
        result = subprocess.run(
            ["git", "diff", "--name-only", "--", "*.js", "*.jsx", "*.ts", "*.tsx", "*.json", "*.html", "*.css"],
            cwd="/Users/bobbobby/repos/VoiceTree/frontend/webapp",
            capture_output=True,
            text=True
        )
        unstaged_changes = result.stdout.strip()

        # Check for staged changes in source files
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only", "--", "*.js", "*.jsx", "*.ts", "*.tsx", "*.json", "*.html", "*.css"],
            cwd="/Users/bobbobby/repos/VoiceTree/frontend/webapp",
            capture_output=True,
            text=True
        )
        staged_changes = result.stdout.strip()

        # Return True if any source code changes exist
        return bool(unstaged_changes or staged_changes)
    except Exception as e:
        # If we can't determine changes, run tests to be safe
        print(f"Warning: Could not check for changes ({e}), running tests anyway")
        return True


def run_unit_tests():
    """Run unit tests (vitest) and capture output."""
    start_time = time.time()
    try:
        result = subprocess.run(
            ["npx", "vitest", "run"],
            cwd="/Users/bobbobby/repos/VoiceTree/frontend/webapp",
            capture_output=True,
            text=True,
            timeout=90
        )
        elapsed_time = time.time() - start_time
        return result.returncode, result.stdout, result.stderr, elapsed_time
    except subprocess.TimeoutExpired:
        elapsed_time = time.time() - start_time
        return -1, "", "Unit tests timed out after 90 seconds", elapsed_time
    except Exception as e:
        elapsed_time = time.time() - start_time
        return -1, "", f"Error running unit tests: {e}", elapsed_time


def run_e2e_test():
    """Run the system e2e test and capture output."""
    start_time = time.time()
    try:
        # First build the app for electron tests
        build_result = subprocess.run(
            ["npm", "run", "build:test"],
            cwd="/Users/bobbobby/repos/VoiceTree/frontend/webapp",
            capture_output=True,
            text=True,
            timeout=30
        )

        if build_result.returncode != 0:
            elapsed_time = time.time() - start_time
            return -1, "", f"Build failed: {build_result.stderr}", elapsed_time

        # Run the specific e2e test
        result = subprocess.run(
            ["npx", "playwright", "test", "tests/e2e/full-app/electron-sys-e2e.spec.ts", "--config=playwright-electron.config.ts"],
            cwd="/Users/bobbobby/repos/VoiceTree/frontend/webapp",
            capture_output=True,
            text=True,
            timeout=120,  # Increased timeout for e2e test
            env={**os.environ, "HEADLESS_TEST": "1"}
        )
        elapsed_time = time.time() - start_time
        return result.returncode, result.stdout, result.stderr, elapsed_time
    except subprocess.TimeoutExpired:
        elapsed_time = time.time() - start_time
        return -1, "", "E2E test timed out after 120 seconds", elapsed_time
    except Exception as e:
        elapsed_time = time.time() - start_time
        return -1, "", f"Error running e2e test: {e}", elapsed_time


def parse_test_output(stdout, stderr):
    """Extract key test information from output."""
    summary = []

    # Look for test summary in output
    test_files_match = re.search(r"Test Files\s+(\d+ failed)?.*?(\d+ passed)", stdout or stderr)
    tests_match = re.search(r"Tests\s+(\d+ failed)?.*?(\d+ passed)", stdout or stderr)

    if test_files_match:
        failed = test_files_match.group(1)
        passed = test_files_match.group(2)
        summary.append(f"Test Files: {failed or '0 failed'}, {passed}")

    if tests_match:
        failed = tests_match.group(1)
        passed = tests_match.group(2)
        summary.append(f"Tests: {failed or '0 failed'}, {passed}")

    # Extract React act() warnings (common issue)
    act_warnings = re.findall(r"(An update to \w+ inside a test was not wrapped in act)", stderr)
    if act_warnings:
        unique_components = set(re.findall(r"An update to (\w+)", " ".join(act_warnings)))
        summary.append(f"React act() warnings in: {', '.join(unique_components)}")

    # Look for other errors (excluding HTML output)
    error_lines = []
    for line in stderr.split('\n'):
        if 'Error' in line and '<' not in line and '>' not in line:
            error_lines.append(line.strip())

    if error_lines[:3]:  # Show max 3 error lines
        summary.extend(error_lines[:3])

    return summary


def main():
    # Check if there are source code changes that require testing
    if not has_source_code_changes():
        print("ℹ️ No source code changes detected, skipping tests")
        sys.exit(0)

    total_time = 0
    all_passed = True

    # Run unit tests
    print("Running unit tests...")
    exit_code, stdout, stderr, elapsed_time = run_unit_tests()
    total_time += elapsed_time

    # Parse unit test output
    unit_summary = parse_test_output(stdout, stderr)

    if exit_code == 0:
        print(f"✅ Unit tests passed ({elapsed_time:.1f}s)")
        if unit_summary:
            for line in unit_summary:
                print(f"  {line}")
    else:
        all_passed = False
        print(f"❌ Unit tests failed ({elapsed_time:.1f}s)")
        for line in unit_summary:
            print(f"  • {line}")

    # Run e2e test
    print("\nRunning system e2e test...")
    e2e_exit_code, e2e_stdout, e2e_stderr, e2e_elapsed = run_e2e_test()
    total_time += e2e_elapsed

    if e2e_exit_code == 0:
        print(f"✅ E2E test passed ({e2e_elapsed:.1f}s)")
        # Extract Playwright test summary
        if "1 passed" in e2e_stdout:
            print("  1 test passed")
    else:
        all_passed = False
        print(f"❌ E2E test failed ({e2e_elapsed:.1f}s)")
        # Show relevant error info
        if "Build failed" in e2e_stderr:
            print(f"  • {e2e_stderr}")
        elif "timed out" in e2e_stderr:
            print(f"  • {e2e_stderr}")
        else:
            # Extract failure info from Playwright output
            if "failed" in e2e_stdout.lower():
                for line in e2e_stdout.split('\n'):
                    if 'failed' in line.lower() or 'error' in line.lower():
                        print(f"  • {line.strip()}")
                        break

    # Add timing warning if total tests took longer than 60 seconds
    if total_time > 60:
        print(f"\n⚠️  WARNING: All tests took {total_time:.1f} seconds (> 1 minute)")
        print("   Consider optimizing test performance or splitting tests")

    # Final summary
    print(f"\n{'='*50}")
    if all_passed:
        print(f"✅ All tests passed! Total time: {total_time:.1f}s")
        sys.exit(0)
    else:
        print(f"❌ Some tests failed! Total time: {total_time:.1f}s")
        print("\nTests must pass before stopping. Please review and fix the failures.")
        sys.exit(2)


if __name__ == "__main__":
    main()