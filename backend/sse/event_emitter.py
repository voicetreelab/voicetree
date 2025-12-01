from enum import Enum
import asyncio
from typing import Any


class SSEEventType(Enum):
    PHASE_STARTED = "phase_started"
    PHASE_COMPLETE = "phase_complete"
    ACTION_APPLIED = "action_applied"
    AGENT_ERROR = "agent_error"
    RATE_LIMIT_ERROR = "rate_limit_error"
    WORKFLOW_COMPLETE = "workflow_complete"
    WORKFLOW_FAILED = "workflow_failed"


class SSEEventEmitter:
    def __init__(self, queue: asyncio.Queue[dict[str, Any]]):
        self.queue = queue

    async def emit(self, event_type: SSEEventType, data: dict[str, Any]) -> None:
        await self.queue.put({"event": event_type.value, "data": data})
