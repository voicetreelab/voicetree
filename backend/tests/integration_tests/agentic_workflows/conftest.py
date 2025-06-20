"""
Pytest configuration for agentic workflow tests
Supports different test modes: local, ci, and mocked
"""

import pytest
import os


def pytest_addoption(parser):
    """Add custom command line options for test modes"""
    parser.addoption(
        "--test-mode",
        action="store",
        default=os.environ.get("PYTEST_TEST_MODE", "local"),
        choices=["local", "ci", "mocked"],
        help="Test mode: local (fast), ci (comprehensive), mocked (instant)"
    )
    parser.addoption(
        "--api-calls",
        action="store_true",
        default=os.environ.get("PYTEST_ALLOW_API_CALLS", "false").lower() in ("true", "1", "yes"),
        help="Allow real API calls (default: false for safety)"
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
def allow_api_calls(request):
    """Fixture to check if real API calls are allowed"""
    try:
        cli_allow = request.config.getoption("--api-calls")
        return cli_allow
    except ValueError:
        # Fallback for IDE execution - check environment variable
        ide_allow = os.environ.get("PYTEST_ALLOW_API_CALLS", "false").lower()
        result = ide_allow in ("true", "1", "yes")
        return result


@pytest.fixture(scope="session")
def chunk_count(test_mode):
    """Return appropriate chunk count based on test mode"""
    return {
        "local": 2,      # Fast: 2 chunks × 4 stages = 8 API calls (~25s)
        "ci": 5,         # Comprehensive: 5 chunks × 4 stages = 20 API calls (~60s)  
        "mocked": 10     # Can handle many chunks since it's mocked
    }[test_mode]


@pytest.fixture(scope="session")
def extreme_chunk_count(test_mode):
    """Return appropriate extreme chunk count based on test mode"""
    return {
        "local": 3,      # Fast: 3 chunks
        "ci": 8,         # Comprehensive: 8 chunks
        "mocked": 12     # Can handle many chunks since it's mocked  
    }[test_mode]


@pytest.fixture(autouse=True)
def api_safety_check(request, allow_api_calls, test_mode):
    """Automatically check API call safety before running tests"""
    # Skip this check for mocked tests - they don't make real API calls
    if test_mode == "mocked":
        return
    
    # Skip safety check if test is not marked as @pytest.mark.api
    api_marker = request.node.get_closest_marker("api")
    if not api_marker:
        return
        
    # For real API tests, require explicit --api-calls flag or environment variable
    if not allow_api_calls and test_mode in ["local", "ci"]:
        # Check if running in IDE (PyCharm, VSCode, etc.)
        if _is_running_in_ide():
            pytest.skip(
                f"⚠️ Running in IDE without API calls enabled. "
                f"To enable real API calls in your IDE:\n"
                f"1. Set environment variable: PYTEST_ALLOW_API_CALLS=true\n"
                f"2. Set test mode (optional): PYTEST_TEST_MODE={test_mode}\n"
                f"3. Or use command line: pytest --test-mode={test_mode} --api-calls"
            )
        else:
            pytest.skip(
                f"Skipping {test_mode} test that makes real API calls. "
                f"Use --api-calls flag to enable. "
                f"Example: pytest --test-mode={test_mode} --api-calls"
            )


def _is_running_in_ide():
    """Detect if pytest is being run from an IDE"""
    # Check for common IDE environment indicators
    ide_indicators = [
        "PYCHARM_HOSTED",           # PyCharm
        "VSCODE_PID",               # VSCode
        "VSCODE_IPC_HOOK",          # VSCode
        "JETBRAINS_IDE",            # JetBrains IDEs
        "_", # PyCharm sets this
    ]
    
    # Check if any IDE-specific environment variables are set
    for indicator in ide_indicators:
        if indicator in os.environ:
            return True
    
    # Check for IDE-specific process names in command line
    try:
        import psutil
        current_process = psutil.Process()
        parent_process = current_process.parent()
        if parent_process:
            parent_name = parent_process.name().lower()
            if any(ide in parent_name for ide in ["pycharm", "code", "jetbrains", "intellij"]):
                return True
    except:
        pass
    
    return False


# Test markers for organizing tests
def pytest_configure(config):
    """Register custom markers"""
    config.addinivalue_line("markers", "local: Fast tests for local development")
    config.addinivalue_line("markers", "ci: Comprehensive tests for CI/CD")
    config.addinivalue_line("markers", "mocked: Fast mocked tests")
    config.addinivalue_line("markers", "api: Tests that make real API calls") 