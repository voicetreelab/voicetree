# Fix for "Event loop is closed" Error in pytest-asyncio

## Problem
When running multiple async tests together with pydantic_ai and httpx, tests fail with:
```
RuntimeError: Event loop is closed
```

This happens because:
1. pydantic_ai's GeminiModel uses httpx internally
2. httpx tries to close connections during garbage collection
3. This cleanup happens after pytest-asyncio has already closed the function-scoped event loop
4. The cleanup code fails because it's trying to use a closed loop

## Solution Applied
Added a session-scoped event loop fixture in `/backend/tests/conftest.py`:

```python
@pytest.fixture(scope="session")
def event_loop():
    """Session-scoped event loop to prevent 'Event loop is closed' errors."""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()
```

## Why Other Solutions Didn't Work
1. **Model caching**: Still had the same issue because it's about cleanup timing, not creation
2. **anyio_backend fixture**: Only configures anyio, doesn't fix the lifecycle mismatch
3. **Complex fixture management**: Too much overhead for a simple compatibility issue

## Trade-offs
- ✅ Simple 5-line fix that works immediately
- ✅ All tests pass
- ⚠️ Tests share the same event loop (reduced isolation)
- ⚠️ Potential for test pollution if tests leave tasks running

## What to Watch For
- Tests that pass individually but fail when run together
- Tests that fail only in CI/CD
- Gradually increasing test execution time
- Resource warnings about unclosed connections

## Proper Long-term Solution
When pydantic_ai or pytest-asyncio fix their compatibility issues, remove the session-scoped fixture and use the default function-scoped event loops.

## Related Files
- `/backend/tests/conftest.py` - Contains the session-scoped event loop fix
- `/backend/text_to_graph_pipeline/agentic_workflows/core/llm_integration.py` - Has model cache (kept for efficiency)