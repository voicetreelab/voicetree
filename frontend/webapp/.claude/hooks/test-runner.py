#!/usr/bin/env python3
"""
Test runner hook for Claude Code.
Runs tests and provides concise feedback, blocking Claude if tests fail.
"""
import json
import subprocess
import sys
import re


def run_tests():
    """Run npm tests and capture output."""
    try:
        result = subprocess.run(
            ["npm", "test", "--", "--run"],
            cwd="/Users/bobbobby/repos/VoiceTree/frontend/webapp",
            capture_output=True,
            text=True,
            timeout=90
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "Tests timed out after 90 seconds"
    except Exception as e:
        return -1, "", f"Error running tests: {e}"


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
    # Run the tests
    exit_code, stdout, stderr = run_tests()

    # Parse the output to get key information
    summary = parse_test_output(stdout, stderr)

    if exit_code == 0:
        # Tests passed - allow Claude to stop
        print("✅ All tests passed!")
        if summary:
            for line in summary:
                print(f"  {line}")
        sys.exit(0)
    else:
        # Tests failed - block Claude from stopping
        error_message = ["❌ Tests failed! Please fix the following issues:"]
        error_message.extend(f"  • {line}" for line in summary)
        error_message.append("")
        error_message.append("The tests must pass before stopping. Please review and fix the test failures.")

        # Print to stderr and exit with code 2 to block
        print("\n".join(error_message), file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()