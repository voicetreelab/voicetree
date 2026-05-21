import logging
import os
import signal
import threading
import time
from typing import Callable, Optional

logger = logging.getLogger(__name__)

_DEFAULT_POLL_INTERVAL_S = 2.0
_DEFAULT_FORCE_EXIT_AFTER_S = 5.0


def _default_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _default_on_parent_gone(parent_pid: int, force_exit_after_s: float) -> None:
    logger.warning(
        "parent_pid_watchdog: parent pid %d gone; sending SIGTERM to self (pid=%d)",
        parent_pid,
        os.getpid(),
    )
    os.kill(os.getpid(), signal.SIGTERM)
    time.sleep(force_exit_after_s)
    logger.error(
        "parent_pid_watchdog: SIGTERM did not exit within %.1fs; force-exiting",
        force_exit_after_s,
    )
    os._exit(0)


def start_parent_pid_watchdog(
    parent_pid: int,
    on_parent_gone: Optional[Callable[[], None]] = None,
    poll_interval_s: float = _DEFAULT_POLL_INTERVAL_S,
    force_exit_after_s: float = _DEFAULT_FORCE_EXIT_AFTER_S,
    is_alive: Callable[[int], bool] = _default_is_alive,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> threading.Event:
    """
    Spawn a daemon thread that polls `parent_pid` and triggers shutdown when it disappears.

    Returns an Event that can be set to stop the watchdog (e.g. from tests).

    The default `on_parent_gone` sends SIGTERM to the current process, waits
    `force_exit_after_s` seconds, then calls `os._exit(0)` if shutdown stalled.
    """
    if not isinstance(parent_pid, int) or parent_pid <= 0:
        raise ValueError(f"start_parent_pid_watchdog: invalid parent_pid {parent_pid!r}")

    stop_event = threading.Event()
    handler = on_parent_gone or (lambda: _default_on_parent_gone(parent_pid, force_exit_after_s))

    def _watch() -> None:
        while not stop_event.is_set():
            sleep_fn(poll_interval_s)
            if stop_event.is_set():
                return
            if not is_alive(parent_pid):
                stop_event.set()
                handler()
                return

    thread = threading.Thread(
        target=_watch,
        name=f"parent-pid-watchdog-{parent_pid}",
        daemon=True,
    )
    thread.start()
    return stop_event


def start_watchdog_from_env(env_var: str = "VOICETREE_PARENT_PID") -> Optional[threading.Event]:
    raw = os.environ.get(env_var)
    if not raw:
        return None
    try:
        parent_pid = int(raw)
    except ValueError:
        logger.warning("parent_pid_watchdog: ignoring invalid %s=%r", env_var, raw)
        return None
    if parent_pid <= 0:
        logger.warning("parent_pid_watchdog: ignoring non-positive %s=%d", env_var, parent_pid)
        return None
    return start_parent_pid_watchdog(parent_pid)
