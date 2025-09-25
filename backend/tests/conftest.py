import asyncio
import os
import sys
from pathlib import Path

import pytest

# Add the backend directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Set test mode to use mock embeddings
os.environ['VOICETREE_TEST_MODE'] = 'true'

# Ensure VOICETREE_ROOT is set - critical for integration tests
if 'VOICETREE_ROOT' not in os.environ:
    # Auto-detect project root (two levels up from this conftest.py)
    project_root = Path(__file__).parent.parent.parent.absolute()
    os.environ['VOICETREE_ROOT'] = str(project_root)

# Simple fix for "Event loop is closed" error with pydantic_ai/httpx
# TODO: This reduces test isolation. If tests start interfering with each other,
# refactor to properly manage pydantic_ai lifecycle with fixtures.
@pytest.fixture(scope="session")
def event_loop():
    """Session-scoped event loop to prevent 'Event loop is closed' errors."""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()
