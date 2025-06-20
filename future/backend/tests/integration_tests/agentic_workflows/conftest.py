"""
Pytest configuration for agentic workflow integration tests
Supports different test modes: local (fast) and ci (comprehensive)
All integration tests use real API calls - for mock testing, use unit tests instead.
"""

import pytest
import os


def pytest_addoption(parser):
    """Add custom command line options for test modes"""
    parser.addoption(
        "--test-mode",
        action="store",
        default=os.environ.get("PYTEST_TEST_MODE", "local"),
        choices=["local", "ci"],
        help="Test mode: local (fast), ci (comprehensive)"
    )



@pytest.fixture(scope="session")
def test_mode(request):
    """Fixture to get the current test mode"""
    try:
        mode = request.config.getoption("--test-mode")
        return mode
    except ValueError:
        # Fallback for IDE execution - check environment variable or default to local
        env_mode = os.environ.get("PYTEST_TEST_MODE", "local")
        return env_mode





@pytest.fixture(scope="session")
def chunk_count(test_mode):
    """Return appropriate chunk count based on test mode"""
    return {
        "local": 2,      # Fast: 2 chunks × 4 stages = 8 API calls (~25s)
        "ci": 5,         # Comprehensive: 5 chunks × 4 stages = 20 API calls (~60s)
    }[test_mode]


@pytest.fixture(scope="session")
def extreme_chunk_count(test_mode):
    """Return appropriate extreme chunk count based on test mode"""
    return {
        "local": 3,      # Fast: 3 chunks
        "ci": 8,         # Comprehensive: 8 chunks
    }[test_mode]








# Test markers for organizing tests
def pytest_configure(config):
    """Register custom markers"""
    config.addinivalue_line("markers", "local: Fast tests for local development")
    config.addinivalue_line("markers", "ci: Comprehensive tests for CI/CD")
    config.addinivalue_line("markers", "api: Tests that make real API calls") 