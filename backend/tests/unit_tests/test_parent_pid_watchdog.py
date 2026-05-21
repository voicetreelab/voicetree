import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

from backend.parent_pid_watchdog import (
    start_parent_pid_watchdog,
    start_watchdog_from_env,
)


def test_rejects_invalid_pid() -> None:
    for bad in (0, -1, -100):
        with pytest.raises(ValueError):
            start_parent_pid_watchdog(bad)


def test_fires_when_is_alive_returns_false() -> None:
    fired = []

    def stub_sleep(seconds: float) -> None:
        pass

    def stub_is_alive(pid: int) -> bool:
        return False

    stop = start_parent_pid_watchdog(
        parent_pid=99999,
        on_parent_gone=lambda: fired.append(True),
        is_alive=stub_is_alive,
        sleep_fn=stub_sleep,
        poll_interval_s=0.001,
    )

    deadline = time.time() + 1.0
    while not fired and time.time() < deadline:
        time.sleep(0.01)
    assert fired == [True]
    stop.set()


def test_does_not_fire_while_parent_alive() -> None:
    fired = []
    poll_count = [0]

    def stub_sleep(seconds: float) -> None:
        pass

    def stub_is_alive(pid: int) -> bool:
        poll_count[0] += 1
        return True

    stop = start_parent_pid_watchdog(
        parent_pid=os.getpid(),
        on_parent_gone=lambda: fired.append(True),
        is_alive=stub_is_alive,
        sleep_fn=stub_sleep,
        poll_interval_s=0.001,
    )

    deadline = time.time() + 0.5
    while poll_count[0] < 50 and time.time() < deadline:
        time.sleep(0.01)
    stop.set()
    assert fired == []
    assert poll_count[0] >= 1


def test_stop_event_halts_watchdog() -> None:
    fired = []
    is_alive_calls = [0]

    def stub_sleep(seconds: float) -> None:
        pass

    def stub_is_alive(pid: int) -> bool:
        is_alive_calls[0] += 1
        return True

    stop = start_parent_pid_watchdog(
        parent_pid=os.getpid(),
        on_parent_gone=lambda: fired.append(True),
        is_alive=stub_is_alive,
        sleep_fn=stub_sleep,
        poll_interval_s=0.001,
    )
    time.sleep(0.05)
    stop.set()
    calls_at_stop = is_alive_calls[0]
    time.sleep(0.1)
    assert fired == []
    assert is_alive_calls[0] - calls_at_stop <= 1


def test_start_watchdog_from_env_returns_none_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VOICETREE_PARENT_PID", raising=False)
    assert start_watchdog_from_env() is None


def test_start_watchdog_from_env_ignores_garbage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICETREE_PARENT_PID", "not-a-number")
    assert start_watchdog_from_env() is None


def test_real_subprocess_self_exits_when_parent_dies(tmp_path: Path) -> None:
    """End-to-end: spawn a Python child that loads the watchdog and watches us; kill us-the-stand-in; expect child to exit."""
    repo_root = Path(__file__).resolve().parents[3]

    # Stand-in parent: another Python that just sleeps. We control its PID and lifetime.
    stand_in = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        # Child polls the stand-in's PID. With aggressive poll interval for the test.
        child_code = (
            "import sys; "
            f"sys.path.insert(0, {str(repo_root)!r}); "
            "from backend.parent_pid_watchdog import start_parent_pid_watchdog; "
            f"start_parent_pid_watchdog({stand_in.pid}, poll_interval_s=0.05); "
            "import time; time.sleep(10)"
        )
        child = subprocess.Popen([sys.executable, "-c", child_code])
        time.sleep(0.5)
        assert child.poll() is None, "child exited prematurely"

        stand_in.terminate()
        stand_in.wait(timeout=3)

        deadline = time.time() + 8.0
        while child.poll() is None and time.time() < deadline:
            time.sleep(0.05)

        if child.poll() is None:
            child.kill()
            child.wait(timeout=3)
            raise AssertionError("child did not self-exit after parent death")

        # SIGTERM exit status: -15 on POSIX
        assert child.returncode in (0, -signal.SIGTERM, signal.SIGTERM)
    finally:
        if stand_in.poll() is None:
            stand_in.kill()
            stand_in.wait(timeout=3)
