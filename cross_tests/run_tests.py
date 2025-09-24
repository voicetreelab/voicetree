#!/usr/bin/env python3
"""
Simple test runner for cross-system integration tests.
Run with: python cross_tests/run_tests.py
"""

import subprocess
import sys
import os


def main():
    """Run the cross-system integration tests."""
    # Change to VoiceTree directory
    voicetree_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(voicetree_dir)
    os.chdir(parent_dir)

    print("Running VoiceTree Frontend-Backend Integration Tests...")
    print(f"Working directory: {os.getcwd()}")

    # Try to run tests with available pytest
    test_commands = [
        ["uv", "run", "python", "-m", "pytest", "cross_tests/", "-v"],
        ["python", "-m", "pytest", "cross_tests/", "-v"],
        ["pytest", "cross_tests/", "-v"]
    ]

    for cmd in test_commands:
        try:
            print(f"Trying command: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode == 0:
                print("✅ Tests passed!")
                print(result.stdout)
                return 0
            else:
                print(f"❌ Test command failed with code {result.returncode}")
                print("STDOUT:", result.stdout)
                print("STDERR:", result.stderr)

        except FileNotFoundError:
            print(f"Command not found: {cmd[0]}")
            continue

    print("❌ Could not run tests - no valid pytest command found")
    print("Please install pytest with: uv add pytest")
    return 1


if __name__ == "__main__":
    sys.exit(main())