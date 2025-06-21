#!/usr/bin/env python
"""Simple coverage test for VoiceTree backend."""
import subprocess
import sys
import os


def test_coverage_threshold():
    """Run unit tests with coverage and check 80% threshold."""
    # Run pytest with coverage
    cmd = [
        sys.executable, "-m", "pytest",
        "backend/tests/unit_tests",
        "--cov=backend",
        "--cov-report=term",
        "--cov-fail-under=80",
        "--cov-config=.coveragerc",
        "-k", "not test_coverage"  # Exclude this test
    ]
    
    result = subprocess.run(cmd)
    
    if result.returncode != 0:
        raise AssertionError("Coverage below 80% or tests failed")


if __name__ == "__main__":
    test_coverage_threshold()