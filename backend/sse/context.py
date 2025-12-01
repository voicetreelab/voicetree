import contextvars
from typing import Optional, Any
from contextvars import Token

from backend.sse.event_emitter import SSEEventEmitter, SSEEventType

_current_emitter: contextvars.ContextVar[Optional[SSEEventEmitter]] = (
    contextvars.ContextVar("sse_emitter", default=None)
)


def get_emitter() -> Optional[SSEEventEmitter]:
    return _current_emitter.get()


def set_emitter(emitter: SSEEventEmitter) -> Token:
    return _current_emitter.set(emitter)


async def emit_event(event_type: SSEEventType, data: dict[str, Any]) -> None:
    emitter = get_emitter()
    if emitter is not None:
        await emitter.emit(event_type, data)
