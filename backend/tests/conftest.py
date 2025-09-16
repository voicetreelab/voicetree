import sys
import os
import pytest
import asyncio

# Add the backend directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Set test mode to use mock embeddings
os.environ['VOICETREE_TEST_MODE'] = 'true'

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