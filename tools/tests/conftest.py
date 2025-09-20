#!/usr/bin/env python3
"""
Pytest configuration for tools tests.
"""

import pytest


def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests"
    )
    config.addinivalue_line(
        "markers", "workflow: marks tests as workflow tests"
    )