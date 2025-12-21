#!/usr/bin/env python3
"""
Pytest configuration for tools tests.
"""

import sys
from pathlib import Path

import pytest

# Add tools and hooks directories to path
TOOLS_DIR = Path(__file__).parent.parent
HOOKS_DIR = TOOLS_DIR / "hooks"
sys.path.insert(0, str(TOOLS_DIR))
sys.path.insert(0, str(HOOKS_DIR))


def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests"
    )
    config.addinivalue_line(
        "markers", "workflow: marks tests as workflow tests"
    )