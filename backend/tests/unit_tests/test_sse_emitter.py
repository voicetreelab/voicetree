import asyncio
import pytest

from backend.sse import (
    SSEEventEmitter,
    SSEEventType,
    get_emitter,
    set_emitter,
    emit_event,
)


@pytest.mark.asyncio
async def test_sse_event_emitter_emits_to_queue():
    """Test that SSEEventEmitter correctly emits events to the queue."""
    queue: asyncio.Queue[dict[str, any]] = asyncio.Queue()
    emitter = SSEEventEmitter(queue)

    test_data = {"message": "test"}
    await emitter.emit(SSEEventType.PHASE_STARTED, test_data)

    event = await queue.get()
    assert event["event"] == "phase_started"
    assert event["data"] == test_data


@pytest.mark.asyncio
async def test_context_scoped_emission():
    """Test that emit_event uses the context-scoped emitter."""
    queue: asyncio.Queue[dict[str, any]] = asyncio.Queue()
    emitter = SSEEventEmitter(queue)

    set_emitter(emitter)
    test_data = {"phase": "test_phase"}
    await emit_event(SSEEventType.PHASE_COMPLETE, test_data)

    event = await queue.get()
    assert event["event"] == "phase_complete"
    assert event["data"] == test_data


@pytest.mark.asyncio
async def test_get_emitter_returns_none_when_not_set():
    """Test that get_emitter returns None when no emitter is set in context."""
    assert get_emitter() is None


@pytest.mark.asyncio
async def test_emit_event_does_nothing_when_no_emitter():
    """Test that emit_event silently does nothing when no emitter is set."""
    # This should not raise an error
    await emit_event(SSEEventType.WORKFLOW_COMPLETE, {"result": "success"})


@pytest.mark.asyncio
async def test_all_event_types_are_emitted_correctly():
    """Test that all SSEEventType enum values emit correctly."""
    queue: asyncio.Queue[dict[str, any]] = asyncio.Queue()
    emitter = SSEEventEmitter(queue)

    event_types = [
        SSEEventType.PHASE_STARTED,
        SSEEventType.PHASE_COMPLETE,
        SSEEventType.ACTION_APPLIED,
        SSEEventType.AGENT_ERROR,
        SSEEventType.RATE_LIMIT_ERROR,
        SSEEventType.WORKFLOW_COMPLETE,
        SSEEventType.WORKFLOW_FAILED,
    ]

    for event_type in event_types:
        await emitter.emit(event_type, {"test": "data"})

    for event_type in event_types:
        event = await queue.get()
        assert event["event"] == event_type.value
